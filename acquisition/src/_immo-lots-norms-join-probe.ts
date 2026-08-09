/**
 * _immo-lots-norms-join-probe.ts — READ-ONLY: pourquoi `folded-normes` = 0% ?
 *
 * La chaîne du champ immo `folded-normes` sur les LOTS est :
 *   registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet   (la grille de normes)
 *     ⋈ zone_code
 *   normalized/qc-lot-zonage/<slug>.parquet                    (le lot ⋈ zone déposé)
 *     → normalized/qc-lots/qc-lots-<slug>.geojson              (le produit servi)
 *
 * Quand `lot-zone-join` rapporte `match=0%` alors que le manifest annonce un
 * `crossval.overlap > 0`, deux causes sont indiscernables depuis les rapports :
 *   (a) les codes ne se rencontrent pas (forme / millésime)  → lane normes ;
 *   (b) les codes se rencontrent, mais AUCUN LOT du cadastre ne tombe dans les
 *       zones couvertes par la grille (grille partielle = noyau urbain, cadastre
 *       clippé ailleurs) → gisement RÉEL nul, rien à réparer côté immo.
 *
 * Cette sonde tranche : elle applique `canonicalizeZoneCodeForJoin` (la MÊME
 * fonction que le join runtime) des deux côtés et compte, LOT PAR LOT, combien de
 * lots déposés portent un zone_code présent dans la grille.
 *
 * N'invente rien, n'écrit rien, ne touche pas S3 en écriture.
 *
 * Usage :
 *   npx tsx acquisition/src/_immo-lots-norms-join-probe.ts --slug baie-saint-paul
 *   npx tsx acquisition/src/_immo-lots-norms-join-probe.ts --slugs laval,amos --top 15
 */
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey } from "./lib/zonage-norms.js";

const LOT_ZONAGE = (slug: string): string => `normalized/qc-lot-zonage/${slug}.parquet`;

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function probe(slug: string, top: number): Promise<void> {
  const s3 = s3Client();

  // ── côté grille de normes (registry) ────────────────────────────────────────
  const nKey = normsKey(slug);
  if (!(await exists(s3, nKey))) {
    console.log(`${slug}\tNO-NORMS-PARQUET\t${nKey}`);
    return;
  }
  const normRows = await readParquetRowsFromBuffer(await getBytes(s3, nKey));
  const normCanon = new Set<string>();
  for (const r of normRows) {
    const c = canonicalizeZoneCodeForJoin(r["zone_code"]);
    if (c) normCanon.add(c);
  }

  // ── côté lots déposés (le join réalisé) ─────────────────────────────────────
  const lKey = LOT_ZONAGE(slug);
  if (!(await exists(s3, lKey))) {
    console.log(`${slug}\tNO-LOT-ZONAGE-PARQUET\t${lKey}`);
    return;
  }
  const lotRows = await readParquetRowsFromBuffer(await getBytes(s3, lKey));
  const byCanon = new Map<string, number>();
  let assigned = 0;
  let lotsMatched = 0;
  for (const r of lotRows) {
    const raw = r["zone_code"];
    if (raw === null || raw === undefined || !String(raw).trim()) continue;
    assigned++;
    const c = canonicalizeZoneCodeForJoin(raw);
    byCanon.set(c, (byCanon.get(c) ?? 0) + 1);
    if (normCanon.has(c)) lotsMatched++;
  }

  const lotCanon = new Set(byCanon.keys());
  const inter = [...lotCanon].filter((c) => normCanon.has(c));
  const pct = assigned ? Math.round((10000 * lotsMatched) / assigned) / 100 : 0;

  console.log(
    `${slug}\tlots=${lotRows.length} assigned=${assigned} lotsMatched=${lotsMatched} (${pct}%)\t` +
      `normCodes=${normCanon.size} lotCodes=${lotCanon.size} codesInter=${inter.length}`,
  );
  console.log(`  normes(canon) : ${[...normCanon].slice(0, top).join(", ")}${normCanon.size > top ? " …" : ""}`);
  const topLots = [...byCanon.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log(`  lots(canon,top): ${topLots.map(([c, n]) => `${c}×${n}`).join(", ")}`);
  console.log(`  ∩ codes        : ${inter.slice(0, top).join(", ") || "(vide)"}`);
  // Verdict : distingue (a) forme/millésime de (b) grille partielle hors cadastre.
  if (inter.length === 0) {
    console.log(`  VERDICT ${slug}: CODES-DISJOINTS — aucun code commun (lane normes: forme ou millésime).`);
  } else if (lotsMatched === 0) {
    console.log(`  VERDICT ${slug}: GRILLE-HORS-CADASTRE — ${inter.length} code(s) commun(s) mais 0 lot dedans.`);
  } else {
    console.log(`  VERDICT ${slug}: JOIN-REJOUABLE — ${lotsMatched} lots matchables (dépôt périmé).`);
  }
}

async function main(): Promise<void> {
  const csv = arg("slugs") ?? arg("slug") ?? "";
  const top = parseInt(arg("top") ?? "12", 10) || 12;
  const slugs = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slug <slug> | --slugs <a,b> [--top N]");
  for (const slug of slugs) {
    try {
      await probe(slug, top);
    } catch (e) {
      console.log(`${slug}\tERROR\t${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
