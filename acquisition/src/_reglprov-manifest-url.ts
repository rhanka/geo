/**
 * _reglprov-manifest-url.ts — lane P0_1 (provenance règlement). READ-ONLY.
 *
 * Imprime le `source_url` du manifest normes (registry/qc-zonage-norms/manifest.json,
 * l'AUTORITÉ — mémoire norms-manifest-is-authority) pour des slugs ARBITRAIRES.
 *
 * `_reglement-provenance-targets.ts` fait déjà cette jointure, mais SEULEMENT sur son
 * univers `zonage-enrichment.json` (served && !reglement) : les slugs que ce fichier
 * ignore — précisément ceux que `_reglprov-s3-universe-gap.ts` découvre sur S3 — n'y
 * apparaissent jamais, et leur URL source reste invisible.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-manifest-url.ts east-farnham hope-town preissac
 */
import { getBytes, s3Client } from "./lib/s3.js";

const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (slugs.length === 0) {
  console.error("usage: npx tsx acquisition/src/_reglprov-manifest-url.ts <slug> [slug...]");
  process.exit(2);
}

const s3 = s3Client();
const manifest = JSON.parse(
  (await getBytes(s3, "registry/qc-zonage-norms/manifest.json")).toString("utf8"),
) as { entries?: Array<Record<string, any>> };
const bySlug = new Map<string, Record<string, any>>();
for (const e of manifest.entries ?? []) bySlug.set(String(e.slug), e);

for (const slug of slugs) {
  const e = bySlug.get(slug);
  if (!e) {
    console.log(`${slug}\tABSENT-DU-MANIFEST`);
    continue;
  }
  const url = e.source_url ?? e.reglement_url ?? "-";
  console.log(`${slug}\t${url}\trows=${e.zone_rows ?? "-"}\tmethode=${e.methode ?? "-"}\treglement=${e.reglement ?? "-"}`);
}
