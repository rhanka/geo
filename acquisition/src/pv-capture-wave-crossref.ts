/**
 * pv-capture-wave-crossref.ts — pont LECTURE SEULE entre une vague de capture
 * cluster et la relecture visuelle.
 *
 * Après une vague `k8s-capture-run.ts` (octets déposés en CAS + manifestes
 * `capture/_runs/<run-id>/manifest.jsonl`), ce runner RÉSOUT les run_id de chaque
 * run-stamp (comme `capture-run-resolve.ts`), relit chaque manifeste et GROUPE les
 * clés CAS durables PAR MUNICIPALITÉ, en émettant un fichier de cibles au contrat
 * `pv-non-indexe-sur-non-couvertes/v1` — exactement ce que consomme
 * `pv-lecture-visuelle-non-couvertes-lot.ts` pour télécharger + SHA-vérifier avant
 * lecture visuelle directe.
 *
 * Le join est TRIVIAL et sans invention : chaque ligne de manifeste porte déjà
 * `slugs` (les municipalités servies par ce fetch) ET `storage_key` (la clé CAS).
 * On n'invente donc aucune correspondance url→CAS.
 *
 * ANTI-INVENTION :
 *   - on ignore toute ligne sans octets durables (`storage_key`/`sha256` null),
 *     toute URL `redacted` (non re-téléchargeable, non preuve v2),
 *   - on ignore toute ligne dont `slugs.length !== 1` (sonde de découverte ou
 *     fetch multi-slug : la municipalité servie est ambiguë),
 *   - une clé CAS vue sous PLUSIEURS slugs (octets identiques entre villes) est
 *     retirée et listée dans `ambiguous_cas_keys` : on ne l'attribue à personne.
 *   - `outcome: "NON_INDEXED_OTHER"` est un simple TAG DE SÉLECTION (jamais un
 *     jugement) : ces CAS sont fraîchement captés, non encore relus.
 *
 * LECTURE SEULE. N'écrit que le fichier de cibles local (aucun PUT S3).
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-capture-wave-crossref.ts \
 *     --lane pv \
 *     --run-stamps 20260809T142500Z,20260809T142501Z,20260809T142502Z,20260809T143000Z,20260809T143001Z,20260809T143002Z \
 *     --out work/coverage/pv-capture-wave-crossref-20260809.json
 */
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CAPTURE_RUNS_PREFIX,
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { runIdsFromManifestKeys } from "./_capture-e2e-probe.js";

// Préfixe S3 déterministe des manifestes d'un run (== captureRetrievalPrefix de
// lib/capture-image-pin) : `capture/_runs/<lane>-<stamp>-`. Dérivé ici de la
// primitive CAPTURE_RUNS_PREFIX (lib capture) pour rester indépendant de
// l'outillage capture-image-pin/capture-run-resolve non encore mergé sur main.
function captureRetrievalPrefix(lane: string, runStamp: string): string {
  return `${CAPTURE_RUNS_PREFIX}${lane}-${runStamp}-`;
}

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.[a-z0-9]+$/u;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/u;
const RUN_STAMP_RE = /^[0-9]{8}T[0-9]{6}Z$/u;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

interface RunSummary {
  run_id: string;
  manifest: boolean;
  manifest_lines: number;
  durable_cas: number;
}

async function main(): Promise<void> {
  const lane = arg("lane") ?? "pv";
  const out = arg("out");
  const stamps = (arg("run-stamps") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!out) throw new Error("--out <work/coverage/....json> est requis");
  if (stamps.length === 0) throw new Error("--run-stamps <a,b,c> est requis");
  for (const stamp of stamps) {
    if (!RUN_STAMP_RE.test(stamp)) throw new Error(`--run-stamps: stamp invalide ${stamp} (attendu YYYYMMDDTHHMMSSZ)`);
  }
  const outPath = resolve(ROOT, out);
  if (!outPath.startsWith(`${COVERAGE}/`) || !outPath.endsWith(".json")) {
    throw new Error("--out doit être un JSON sous work/coverage");
  }
  if (existsSync(outPath)) throw new Error(`artefact déjà présent: ${outPath}`);
  assertS3RunEnvironment();

  const s3 = s3Client();
  const casBySlug = new Map<string, Set<string>>();
  const slugByKey = new Map<string, string>();
  const ambiguous = new Set<string>();
  const runs: RunSummary[] = [];

  for (const stamp of stamps) {
    const prefix = captureRetrievalPrefix(lane, stamp);
    const keys = (await listObjectEntries(s3, prefix)).map((entry) => entry.key);
    const runIds = runIdsFromManifestKeys(keys, `${lane}-${stamp}-`);
    const keySet = new Set(keys);
    for (const runId of runIds) {
      const runKeys = captureRunKeys(runId);
      if (!keySet.has(runKeys.manifest)) {
        runs.push({ run_id: runId, manifest: false, manifest_lines: 0, durable_cas: 0 });
        continue;
      }
      const lines = parseManifestJsonl((await getBytes(s3, runKeys.manifest)).toString("utf8"));
      let durable = 0;
      for (const line of lines) {
        if (line.redacted) continue;
        if (line.storage_key === null || line.sha256 === null) continue;
        if (!CAS_KEY.test(line.storage_key)) continue;
        if (line.slugs.length !== 1) continue;
        const slug = line.slugs[0]!;
        if (!SLUG_RE.test(slug)) continue;
        const prior = slugByKey.get(line.storage_key);
        if (prior !== undefined && prior !== slug) {
          ambiguous.add(line.storage_key);
          continue;
        }
        slugByKey.set(line.storage_key, slug);
        let set = casBySlug.get(slug);
        if (set === undefined) {
          set = new Set<string>();
          casBySlug.set(slug, set);
        }
        set.add(line.storage_key);
        durable++;
      }
      runs.push({ run_id: runId, manifest: true, manifest_lines: lines.length, durable_cas: durable });
    }
  }

  // Retire les clés ambiguës (mêmes octets pour plusieurs villes) : anti-invention.
  for (const key of ambiguous) {
    const slug = slugByKey.get(key);
    if (slug !== undefined) casBySlug.get(slug)?.delete(key);
  }

  const municipalities = [...casBySlug.entries()]
    .filter(([, keys]) => keys.size > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([slug, keys]) => ({
      slug,
      non_indexed_documents: [...keys].sort().map((storage_key) => ({
        storage_key,
        outcome: "NON_INDEXED_OTHER",
        source: "pv-index",
      })),
    }));

  const totalCas = municipalities.reduce((sum, m) => sum + m.non_indexed_documents.length, 0);
  const report = {
    contract: "pv-non-indexe-sur-non-couvertes/v1",
    _generator: "pv-capture-wave-crossref.ts",
    _note:
      "CAS fraîchement captés (cluster) groupés par municipalité, non encore " +
      "indexés. Join = manifest.slugs × storage_key (aucune invention). " +
      "outcome=NON_INDEXED_OTHER = tag de sélection, jamais un jugement. Lignes " +
      "redacted / sans octets / multi-slug / ambiguës exclues. Hand-off vers " +
      "pv-lecture-visuelle-non-couvertes-lot.ts pour download+SHA puis lecture visuelle.",
    generated_at: new Date().toISOString(),
    read_only: true,
    lane,
    run_stamps: stamps,
    runs,
    ambiguous_cas_keys: [...ambiguous].sort(),
    total_municipalities: municipalities.length,
    total_cas_keys: totalCas,
    municipalities,
  };

  const temporary = `${outPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporary, outPath);
  process.stdout.write(
    `${JSON.stringify(
      {
        output: outPath.slice(ROOT.length + 1),
        municipalities: municipalities.length,
        total_cas_keys: totalCas,
        ambiguous: ambiguous.size,
        runs_with_manifest: runs.filter((r) => r.manifest).length,
        runs_total: runs.length,
        per_slug: municipalities.map((m) => ({ slug: m.slug, cas: m.non_indexed_documents.length })),
      },
      null,
      2,
    )}\n`,
  );
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
