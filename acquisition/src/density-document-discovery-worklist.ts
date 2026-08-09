/**
 * Materialise one immutable 12-slug worklist for the B' density-document search.
 *
 * No municipal request is made here. The only remote reads are the already
 * acquired source bytes on S3, whose SHA-256 is needed to enforce "ANOTHER
 * document" even when a mirror changes the URL.
 *
 * Usage (one short lot at a time):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/density-document-discovery-worklist.ts --lot 1
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DENSITY_DISCOVERY_CONTRACT,
  parseDensityDiscoveryBaseline,
  parseDensityDiscoveryWorklist,
  sha256Hex,
  stableDensityDiscoveryLots,
  type DensityDiscoveryTarget,
  type DensityDiscoveryWorklist,
} from "../../packages/qc-sources/src/sources/density-document-discovery.js";
import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BASELINE = resolve(
  ROOT,
  "work/coverage/densite-deja-acquise-non-pliee-20260728T035716Z.json",
);
const DEFAULT_DIRECTORY = resolve(
  ROOT,
  "packages/qc-sources/src/geo/qc-municipal-directory.json",
);
const LOTS = 5;

interface DirectoryEntry {
  slug?: unknown;
  name?: unknown;
  mamhCode?: unknown;
  website?: unknown;
}

interface DirectoryFile {
  entries?: Record<string, DirectoryEntry>;
}

export interface PreviousSource {
  key: string;
  sha256: string;
}

interface WorklistProgress {
  contract: "density-document-discovery-worklist-progress/v1";
  baselineSha256: string;
  lot: number;
  previousSources: Record<string, PreviousSource | null>;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} doit être un entier positif`);
  return value;
}

function insideRepo(path: string, label: string): string {
  const resolved = resolve(path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`${label} doit rester dans le dépôt`);
  return resolved;
}

function sourceUrl(value: string | null): string | null {
  if (!value || /^(?:https?:\/\/)?non-disponible$/i.test(value.trim())) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function buildDensityDiscoveryWorklist(
  baselineRaw: string,
  directoryRaw: string,
  lotNumber: number,
  previousSources: ReadonlyMap<string, PreviousSource | null>,
  baselineKey = "work/coverage/densite-deja-acquise-non-pliee-20260728T035716Z.json",
): DensityDiscoveryWorklist {
  if (!Number.isInteger(lotNumber) || lotNumber < 1 || lotNumber > LOTS) {
    throw new Error(`lot invalide: ${lotNumber} (attendu 1..${LOTS})`);
  }
  const rows = parseDensityDiscoveryBaseline(JSON.parse(baselineRaw));
  const lots = stableDensityDiscoveryLots(rows);
  const directory = JSON.parse(directoryRaw) as DirectoryFile;
  if (!directory.entries || typeof directory.entries !== "object") {
    throw new Error("annuaire municipal invalide: entries requis");
  }
  const rowsForLot = lots[lotNumber - 1] ?? [];
  const targets: DensityDiscoveryTarget[] = rowsForLot.map((row) => {
    const entry = directory.entries?.[row.slug];
    if (
      !entry
      || typeof entry.name !== "string"
      || typeof entry.mamhCode !== "string"
      || typeof entry.website !== "string"
    ) {
      throw new Error(`${row.slug}: identité MAMH incomplète`);
    }
    const previous = previousSources.get(row.slug) ?? null;
    return {
      slug: row.slug,
      name: entry.name,
      mamhCode: entry.mamhCode,
      website: entry.website,
      excludedSourceUrl: sourceUrl(row.manifest_source_url),
      excludedSourceSha256: previous?.sha256 ?? null,
      excludedSourceStorageKey: previous?.key ?? null,
      baselineSnapshot: row.manifest_snapshot,
    };
  });
  return parseDensityDiscoveryWorklist({
    contract: DENSITY_DISCOVERY_CONTRACT,
    baselineKey,
    baselineSha256: sha256Hex(baselineRaw),
    lot: lotNumber,
    lots: lots.length,
    targets,
  });
}

const PREVIOUS_EXTENSIONS = ["pdf", "xlsx", "xls", "ods"] as const;

async function previousSource(slug: string): Promise<PreviousSource | null> {
  const s3 = s3Client();
  for (const extension of PREVIOUS_EXTENSIONS) {
    const key = `sources/qc-zonage-grilles/${slug}.${extension}`;
    if (!(await exists(s3, key))) continue;
    const bytes = await getBytes(s3, key);
    return { key, sha256: sha256Hex(bytes) };
  }
  // Historical norms acquisition predates durable capture for most cities.
  // When the exact staged `grille.pdf` still survives, retain ONLY its digest
  // in the immutable worklist so a byte-identical mirror cannot be mistaken for
  // "another document". The discovery runner never opens this local path.
  const local = resolve(ROOT, "work", "zonage-norms", slug, "grille.pdf");
  if (existsSync(local)) {
    return {
      key: `local-source-sha-only:work/zonage-norms/${slug}/grille.pdf`,
      sha256: sha256Hex(readFileSync(local)),
    };
  }
  return null;
}

function loadProgress(path: string, baselineSha256: string, lot: number): WorklistProgress {
  if (!existsSync(path)) {
    return {
      contract: "density-document-discovery-worklist-progress/v1",
      baselineSha256,
      lot,
      previousSources: {},
    };
  }
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<WorklistProgress>;
  if (
    value.contract !== "density-document-discovery-worklist-progress/v1"
    || value.baselineSha256 !== baselineSha256
    || value.lot !== lot
    || !value.previousSources
    || typeof value.previousSources !== "object"
  ) {
    throw new Error(`checkpoint incompatible: ${path}`);
  }
  return value as WorklistProgress;
}

function writeProgress(path: string, progress: WorklistProgress): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`);
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const lot = positiveInteger("lot", option(argv, "lot"));
  if (lot > LOTS) throw new Error(`--lot doit être dans 1..${LOTS}`);
  const baselinePath = insideRepo(option(argv, "baseline") ?? DEFAULT_BASELINE, "--baseline");
  const directoryPath = insideRepo(option(argv, "directory") ?? DEFAULT_DIRECTORY, "--directory");
  if (!existsSync(baselinePath) || !existsSync(directoryPath)) throw new Error("baseline ou annuaire absent");
  const outPath = insideRepo(
    option(argv, "out")
      ?? resolve(ROOT, `acquisition/config/density-document-discovery-20260728-lot-${String(lot).padStart(2, "0")}.json`),
    "--out",
  );
  if (existsSync(outPath)) throw new Error(`refus d'écraser la worklist immuable: ${outPath}`);

  const baselineRaw = readFileSync(baselinePath, "utf8");
  const baselineSha256 = sha256Hex(baselineRaw);
  const rows = stableDensityDiscoveryLots(parseDensityDiscoveryBaseline(JSON.parse(baselineRaw)))[lot - 1] ?? [];
  const progressPath = insideRepo(
    option(argv, "progress")
      ?? resolve(
        ROOT,
        `work/coverage/.density-document-discovery-worklist-progress-${baselineSha256.slice(0, 16)}-lot-${String(lot).padStart(2, "0")}.json`,
      ),
    "--progress",
  );
  const progress = loadProgress(progressPath, baselineSha256, lot);
  const previousSources = new Map<string, PreviousSource | null>(
    Object.entries(progress.previousSources),
  );
  for (const row of rows) {
    let previous = previousSources.get(row.slug);
    if (previous === undefined) {
      previous = await previousSource(row.slug);
      previousSources.set(row.slug, previous);
      progress.previousSources[row.slug] = previous;
      writeProgress(progressPath, progress);
    }
    process.stderr.write(
      `[density-worklist] ${row.slug} précédent=${previous ? `s3://${previous.key} sha256:${previous.sha256}` : "SHA INDISPONIBLE"}\n`,
    );
  }
  const worklist = buildDensityDiscoveryWorklist(
    baselineRaw,
    readFileSync(directoryPath, "utf8"),
    lot,
    previousSources,
  );
  writeFileSync(outPath, `${JSON.stringify(worklist, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    out: outPath.replace(`${ROOT}/`, ""),
    lot,
    targets: worklist.targets.length,
    baseline_sha256: worklist.baselineSha256,
    previous_sha_available: worklist.targets.filter((target) => target.excludedSourceSha256 !== null).length,
    progress: progressPath.replace(`${ROOT}/`, ""),
  })}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
