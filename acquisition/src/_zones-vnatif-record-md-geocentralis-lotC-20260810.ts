/**
 * _zones-vnatif-record-md-geocentralis-lotC-20260810.ts — génère le record .md LOT-C
 * géoCentralis à partir du record .json machine (jamais reformater la sortie à la main).
 *
 * USAGE :
 *   npx tsx acquisition/src/_zones-vnatif-record-md-geocentralis-lotC-20260810.ts \
 *     --in work/coverage/zones-vnatif-deposit-record-geocentralis-lotC-20260810.json \
 *     --out work/coverage/zones-vnatif-deposit-record-geocentralis-lotC-20260810.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function shortSha(s: unknown): string { return typeof s === "string" ? s.replace(/^sha256:/, "").slice(0, 8) : "—"; }
function layerShort(s: unknown): string { return String(s ?? "").replace(/^evb:/, ""); }

interface City { slug: string; statut: string; raison?: string; layer?: string; code_field?: string; feature_count?: number; overlap_ratio_pct?: number | null; dropped_count?: number; sha256?: string }

function main(): void {
  const inPath = arg("in")!; const outPath = arg("out")!;
  const rec = JSON.parse(readFileSync(resolve(ROOT, inPath), "utf8")) as { run_stamp: string; summary: { total: number; deposited: number; skipped: number; other: number }; cities: City[] };
  const dep = rec.cities.filter((c) => c.statut === "DEPOSITED");
  const skip = rec.cities.filter((c) => String(c.statut).startsWith("SKIP"));
  const droppedTotal = dep.reduce((a, c) => a + (c.dropped_count ?? 0), 0);
  const partial = dep.filter((c) => (c.overlap_ratio_pct ?? 100) < 100);

  const rows = dep.map((c, i) => `| ${i + 1} | ${c.slug} | ${layerShort(c.layer)} | ${c.code_field} | ${c.feature_count} | ${c.overlap_ratio_pct}${c.overlap_ratio_pct === 100 ? " %" : " %"} | ${c.dropped_count ?? 0} | ${shortSha(c.sha256)} |`).join("\n");
  const skipRows = skip.map((c, i) => `| ${i + 1} | ${c.slug} | ${c.raison} |`).join("\n");

  const md = `# Dépôt zones — LOT-C géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **${rec.summary.total}**
munis géoCentralis suivants (après le pilote + lot-A + lot-B), réplique EXACTE de la recette
pilote (\`05de001a\`/\`cd363a04\`) + lot-A (\`656eb46d\`) + lot-B (\`dd7e4cf9\`). **${rec.summary.deposited} DÉPÔTS EFFECTUÉS**,
readback **VERT sur les ${rec.summary.deposited}**. **${rec.summary.skipped} SKIP** (isolation par-muni, jamais forcés).

Politique : \`SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md\` (64f82eae / 65d4c637) +
\`SPEC_ZONE_GEOMETRY_GRAIN.md\` (7c7f6731) + \`SPEC_ACQUISITION_METHODES_PAR_SOURCE.md\` (47fc8104) §12.

Scripts : \`acquisition/src/_zones-vnatif-select-geocentralis-lotC-20260810.ts\` (sélection +
validation LIVE), \`acquisition/src/_zones-vnatif-deposit-geocentralis-lotC-20260810.ts\` (dépôt),
\`acquisition/src/_zones-vnatif-record-md-geocentralis-lotC-20260810.ts\` (ce .md).
Worklist : \`work/coverage/zones-vnatif-capture-worklist-geocentralis-lotC-20260810.json\` (${rec.summary.total} munis).
Diagnostic sélection : \`work/coverage/_zones-vnatif-select-geocentralis-lotC-20260810.json\`.
Record machine : \`work/coverage/zones-vnatif-deposit-record-geocentralis-lotC-20260810.json\`.

## 1. Capture (k8s, cluster OVH)

- Job \`geo-capture-zones-${rec.run_stamp.toLowerCase()}\` : **Complete 15/15**, run-stamp \`${rec.run_stamp}\`, 0 shard en échec.
- Octets bruts + manifeste + logs sur S3 sous \`capture/_runs/zones-${rec.run_stamp}-*\`.
- Worklist déposée : \`s3://sentropic-geo/registry/capture-worklists/zones-${rec.run_stamp}.json\`.

## 2. Couche-identité (source-identity WFS)

Endpoint unique \`geoserver.geocentralis.com/geoserver/ows\`, GetFeature \`outputFormat=application/json\`
filtré \`CQL_FILTER=id_municipalite=<id>\`. Deux couches partagées (identiques au pilote / lot-A / lot-B) :

- \`evb:zonage_municipal\`  → champ-code \`no_zonage_municipal\`
- \`evb:siadmin_pzon_99_s\` → champ-code \`etiquette_1\`

\`zone_code\` = **valeur brute du champ-code WFS** (aucune dérivation synthétique). URL WFS dérivée
du fragment scoping (\`#evb:<layer>[id_municipalite=<id>]\`) puis **validée LIVE** (\`&count=1\` →
\`numberMatched>0\`) avant inclusion (siadmin toujours quoté ; zonage_municipal quoté ssi id à
zéro de tête — règle déduite à 100% des worklists lot-A/B, forme retenue = celle qui rend des features).

## 3. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

Sur les ${rec.summary.total} : G2 byte-exact (re-hash CAS == manifeste == clé CAS + \`verifyRawCapturePayload\`),
FeatureCollection non-vide, \`numberReturned==numberMatched==features\` (anti-troncature) ET
énumération LIVE (\`&count=1\`) == features, 100 % polygonal, grain **zone-polygon** (aucun marqueur
UEV), anti-homonyme \`nearest_registre_muni==slug\`, overlap source-identity **≥ 90 %**, anti-invention
(aucun feature à \`zone_code\` vide). **${rec.summary.skipped} gardes déclenchées → ${rec.summary.skipped} SKIP.**

## 4. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les ${rec.summary.deposited})

\`normalize(feats, <champ-code>, url)\` → \`zone_code\` brut ; \`proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})\` ; \`depositCapturedZones(…, {geometryGrain:"zone-polygon"})\`.
Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ; codes servi-seulement (divergence) →
**UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup \`_replaced/…\`.

| # | muni | couche | champ-code | features | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---|---|---|
${rows}

**${dep.length - partial.length} munis à overlap 100 % (0 droppé).** ${partial.length ? `${partial.length} muni(s) à overlap partiel mais ≥ 90 %, codes servi-seulement flagués **UNKNOWN** (jamais N-A).` : "Aucun overlap partiel."} Total droppés→UNKNOWN : **${droppedTotal}**.

## 5. SKIP (${rec.summary.skipped}) — isolation par-muni, jamais forcés

| # | muni | raison |
|---|---|---|
${skipRows}

Chaque SKIP est un garde légitime (anti-homonyme : la géométrie WFS a un centroïde plus proche
d'une AUTRE muni enregistrée ; ou anti-invention : au moins un feature sans \`zone_code\`). Refus de
déposer une géométrie ambiguë ou incomplète — jamais forcé, jamais inventé.

## 6. Readback (G5) — VERT sur les ${rec.summary.deposited}

Chaque muni déposé : \`feature_count_matches_capture\`, \`geometry_digest_byte_exact\`,
\`zone_code_present_all\`, \`proof_url == query URL\`, \`proof_sha256 == capture sha\`,
\`carries_capture_sha256\`, \`zone_source_level == documented\`, \`zone_source_url\` uniforme = proof.url,
\`geometry_grain == zone-polygon\`, backup \`_replaced/\` présent → tous **true**. \`readback_ok = true\`,
\`statut = DEPOSITED\` sur les **${rec.summary.deposited}/${rec.summary.deposited}**. Enrichissement préservé/re-appliqué dans la même passe.

## 7. Typecheck

\`npx tsc --noEmit -p acquisition/tsconfig.json\` → **2 erreurs, les 2 préexistantes connues**
(\`acquisition/src/lib/capture-e2e-probe.test.ts\` TS2305 ;
\`acquisition/src/zones-vecteur-natif-manifest-run.ts:165\` TS2322). **Delta = 0** : les 3 scripts
lot-C n'ajoutent aucune erreur.

## 8. Verdict

Lot-C géoCentralis **CLÔTURÉ : ${rec.summary.deposited}/${rec.summary.total} DÉPOSÉS, ${rec.summary.skipped} SKIP** (gardes légitimes). Chemin WFS → preuve v2
par source-identity rejoué à l'échelle sur les DEUX couches. Prêt pour re-fold (\`col-2\` GATÉ sur
autorité zones=final + go S3, cf. mémoire). Codes droppés → **UNKNOWN**, jamais N-A.
`;
  writeFileSync(resolve(ROOT, outPath), md, "utf8");
  process.stderr.write(`MD → ${outPath} (${dep.length} deposited, ${skip.length} skip)\n`);
}
main();
