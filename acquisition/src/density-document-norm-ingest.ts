/**
 * Verify and additively deposit density norms from the two legally reviewed NEW
 * documents discovered by the closed 56-city campaign.
 *
 * Reads only captured CAS bytes. Native parsers and merge rules live in tested
 * libraries. The default is a report-only dry run; --deposit additionally
 * requires --legal-reviewed, creates a one-time backup, writes the parquet,
 * verifies its round trip, and stores the ingest report on object storage.
 */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  parseSaintDominiqueDensityDocument,
  parseStonehamDensityDocument,
  type DensityNormParseResult,
} from "../../packages/qc-sources/src/sources/density-document-norm-parser.js";
import {
  mergeDensityNormRows,
  type DensityNormPatch,
} from "./lib/density-document-deposit.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  copyObject,
  exists,
  getBytes,
  putBytes,
  s3Client,
} from "./lib/s3.js";
import {
  canonZone,
  normsKey,
  resolveGridKey,
  sigZoneCodesFromGeojsonRaw,
  writeNormsParquet,
} from "./lib/zonage-norms.js";

interface Candidate {
  url?: unknown;
  retrievedAt?: unknown;
  sha256?: unknown;
  storageKey?: unknown;
  disposition?: unknown;
  normValueHits?: unknown[];
}

interface DiscoveryRow {
  slug?: unknown;
  website?: unknown;
  candidates?: Candidate[];
}

interface DiscoveryReport {
  scopeCount?: unknown;
  baselineSha256?: unknown;
  rows?: DiscoveryRow[];
}

interface Profile {
  sourceUrl: string;
  sourceSha256: string;
  sourceHost: string;
  legalDate: string;
  legalDateEvidence: string;
  reglement: string;
  parse: (text: string) => DensityNormParseResult;
}

const METHOD = "native-text/density-document-verbatim";
const PROFILES: Record<string, Profile> = {
  "saint-dominique": {
    sourceUrl: "https://www.st-dominique.ca/fichiersUpload/fichiers/20260601132149-2017-324-annexe-b-grilles-des-usages.pdf",
    sourceSha256: "sha256:d3114a0c03c013b9dd39382bbdc97b20cfad72fc62e952d5398670b634ac5f71",
    sourceHost: "www.st-dominique.ca",
    legalDate: "2026-06-01",
    legalDateEvidence: "URL municipale verbatim: /20260601132149-2017-324-annexe-b-grilles-des-usages.pdf",
    reglement: "ZONAGE 2017-324 - ANNEXE B",
    parse: parseSaintDominiqueDensityDocument,
  },
  "stoneham-et-tewkesbury": {
    sourceUrl: "https://www.villestoneham.com/storage/app/media/ma-municipalite/affaires-municipales/reglements-municipaux/urbanisme/09-591_grille-des-specifications-codif-adm-maj-juillet-2026.pdf",
    sourceSha256: "sha256:81e2d8ea8b028451aaeef128242e16b883287bba2f5ee757bfb779681de4ab84",
    sourceHost: "www.villestoneham.com",
    legalDate: "2026-07",
    legalDateEvidence: "URL municipale verbatim: 09-591_grille-des-specifications-codif-adm-maj-juillet-2026.pdf",
    reglement: "Règlement de zonage numéro 09-591 — Annexe 2, version intégrée",
    parse: parseStonehamDensityDocument,
  },
};

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checkpoint(path: string, report: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = option(argv, "slug");
  const reportPath = option(argv, "report")
    ?? "../work/coverage/density-document-discovery-report-20260728.json";
  const output = option(argv, "output")
    ?? `../work/coverage/density-document-norm-ingest-${slug ?? "missing"}.json`;
  const deposit = argv.includes("--deposit");
  const legalReviewed = argv.includes("--legal-reviewed");
  if (!slug || !PROFILES[slug]) {
    throw new Error(`--slug requis parmi: ${Object.keys(PROFILES).join(", ")}`);
  }
  if (deposit && !legalReviewed) {
    throw new Error("--deposit exige --legal-reviewed");
  }
  const profile = PROFILES[slug]!;
  const discovery = JSON.parse(readFileSync(reportPath, "utf8")) as DiscoveryReport;
  if (discovery.scopeCount !== 56 || !Array.isArray(discovery.rows)) {
    throw new Error("rapport de découverte hors périmètre ou incomplet");
  }
  const row = discovery.rows.find((item) => item.slug === slug);
  if (!row || !Array.isArray(row.candidates)) throw new Error(`${slug}: ligne de découverte absente`);
  const candidate = row.candidates.find((item) => item.url === profile.sourceUrl);
  if (
    !candidate
    || candidate.sha256 !== profile.sourceSha256
    || typeof candidate.storageKey !== "string"
    || typeof candidate.retrievedAt !== "string"
    || candidate.disposition !== "candidate_review_required"
    || !Array.isArray(candidate.normValueHits)
    || candidate.normValueHits.length === 0
  ) {
    throw new Error(`${slug}: candidat exact, capturé et porteur de valeurs absent`);
  }
  if (new URL(profile.sourceUrl).hostname !== profile.sourceHost) {
    throw new Error(`${slug}: propriétaire de source inattendu`);
  }

  const s3 = s3Client();
  const bytes = await getBytes(s3, candidate.storageKey);
  if (digest(bytes) !== profile.sourceSha256) throw new Error(`${slug}: CAS SHA mismatch`);
  const native = extractNativeDocumentText(bytes);
  if (native.text === null) throw new Error(`${slug}: parseur natif bloqué: ${String(native.blocker)}`);
  const parsed = profile.parse(native.text);
  if (!parsed.documentAnchored || parsed.projectExcluded || parsed.norms.length === 0) {
    throw new Error(`${slug}: document non ancré, projet, ou sans norme publiable`);
  }

  const gridResolved = await resolveGridKey(s3, slug);
  if (!gridResolved) throw new Error(`${slug}: grille SIG absente`);
  const sigRaw = sigZoneCodesFromGeojsonRaw(
    (await getBytes(s3, gridResolved)).toString("utf8"),
  );
  const sigByCanon = new Map<string, string>();
  for (const code of sigRaw) {
    const key = canonZone(code);
    const previous = sigByCanon.get(key);
    if (previous !== undefined && previous !== code) {
      throw new Error(`${slug}: collision canonique SIG ${previous} <> ${code}`);
    }
    sigByCanon.set(key, code);
  }
  const snapshot = candidate.retrievedAt.slice(0, 10);
  const missingInSig: string[] = [];
  const patches: DensityNormPatch[] = [];
  for (const norm of parsed.norms) {
    const sigCode = sigByCanon.get(canonZone(norm.zoneCode));
    if (!sigCode) {
      missingInSig.push(norm.zoneCode);
      continue;
    }
    patches.push({
      ...norm,
      zoneCode: sigCode,
      sourceUrl: profile.sourceUrl,
      method: METHOD,
      snapshot,
    });
  }
  if (patches.length === 0) throw new Error(`${slug}: aucune norme ne recoupe le SIG`);

  const key = normsKey(slug);
  const existingBytes = await getBytes(s3, key);
  const existingRows = await readParquetRowsFromBuffer(existingBytes);
  const merged = mergeDensityNormRows(existingRows, patches);
  const ingestReport = {
    contract: "density-document-norm-ingest/v1",
    generatedAt: new Date().toISOString(),
    slug,
    deposited: false,
    source: {
      url: profile.sourceUrl,
      sha256: profile.sourceSha256,
      storageKey: candidate.storageKey,
      retrievedAt: candidate.retrievedAt,
      ownerHost: profile.sourceHost,
      reglement: profile.reglement,
      legalDate: profile.legalDate,
      legalDateEvidence: profile.legalDateEvidence,
    },
    parser: {
      family: parsed.family,
      documentAnchored: parsed.documentAnchored,
      projectExcluded: parsed.projectExcluded,
      extracted: parsed.norms.length,
      refusals: parsed.refusals,
    },
    crossValidation: {
      sigKey: gridResolved,
      sigCodes: sigRaw.size,
      matchedNorms: patches.length,
      missingInSig,
    },
    merge: {
      existingRows: existingRows.length,
      outputRows: merged.rows.length,
      inserted: merged.inserted,
      enriched: merged.enriched,
      unchanged: merged.unchanged,
    },
    norms: patches.map((patch) => ({
      zoneCode: patch.zoneCode,
      value: patch.value,
      unit: patch.unit,
      raw: patch.raw,
      proof: patch.proof,
      page: patch.page,
    })),
    output: {
      key,
      backupKey: `${key}.pre-density-document-20260728`,
    },
  };

  if (deposit) {
    const backupKey = ingestReport.output.backupKey;
    if (!(await exists(s3, backupKey))) await copyObject(s3, key, backupKey);
    const parquet = await writeNormsParquet(merged.rows);
    await putBytes(s3, key, parquet, "application/octet-stream");
    const check = await readParquetRowsFromBuffer(await getBytes(s3, key));
    for (const patch of patches) {
      const verified = check.find((item) => canonZone(String(item["zone_code"] ?? "")) === canonZone(patch.zoneCode));
      if (
        !verified
        || verified["densite_value"] !== patch.value
        || verified["densite_unit"] !== patch.unit
        || verified["densite_raw"] !== patch.raw
        || verified["densite_source_url"] !== patch.sourceUrl
      ) {
        throw new Error(`${slug}: vérification parquet échouée pour ${patch.zoneCode}`);
      }
    }
    ingestReport.deposited = true;
    await putBytes(
      s3,
      `reports/normes-density-document/${slug}-20260728.json`,
      `${JSON.stringify(ingestReport, null, 2)}\n`,
      "application/json",
    );
  }
  checkpoint(output, ingestReport);
  process.stdout.write(`${JSON.stringify({
    slug,
    deposited: ingestReport.deposited,
    source: profile.sourceUrl,
    parsed: parsed.norms.length,
    matched: patches.length,
    inserted: merged.inserted,
    enriched: merged.enriched,
    refusals: parsed.refusals.length,
    output,
  })}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
