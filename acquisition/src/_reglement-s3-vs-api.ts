/**
 * _reglement-s3-vs-api.ts — lane P0_1, READ-ONLY, $0.
 *
 * Tranche le désaccord entre les deux « preuves » de la lane :
 *  - S3 (`normalized/ca-qc-zonage/…`) = ce que le fold a réellement écrit ;
 *  - geo-api (`/collections/qc-zonage-<slug>/items`) = ce que la fiche lot immo voit.
 *
 * `fold --dry-run` disant `cellsChanged=0` prouve que S3 porte déjà les 4 champs,
 * mais l'API peut servir une version CACHÉE (geo-api-collection-cache) : dans ce cas
 * le fold est invisible côté produit. Cette sonde affiche les DEUX côte à côte, et
 * teste aussi la clé plate ET la clé sous-dossier (fold-double-key-s3-serving).
 *
 * Usage: npx tsx src/_reglement-s3-vs-api.ts <slug> [<slug> ...]
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const API = "https://api.geo.sent-tech.ca/collections";

type Props = Record<string, unknown>;

async function s3Side(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<Array<{ key: string; n: number; num: unknown; mill: unknown }>> {
  const keys = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const out: Array<{ key: string; n: number; num: unknown; mill: unknown }> = [];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
      features?: Array<{ properties?: Props }>;
    };
    const p = fc.features?.[0]?.properties ?? {};
    out.push({
      key,
      n: fc.features?.length ?? 0,
      num: p["reglement_numero"] ?? null,
      mill: p["reglement_millesime"] ?? null,
    });
  }
  return out;
}

async function apiSide(slug: string): Promise<string> {
  try {
    const r = await fetch(`${API}/qc-zonage-${slug}/items?limit=1`);
    if (!r.ok) return `HTTP ${r.status}`;
    const j = (await r.json()) as { features?: Array<{ properties?: Props }> };
    const p = j.features?.[0]?.properties ?? {};
    return `num=${p["reglement_numero"] ?? "∅"} mill=${p["reglement_millesime"] ?? "∅"}`;
  } catch (e) {
    return `ERR ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  const s3 = s3Client();
  let agree = 0;
  let s3OnlyCount = 0;
  for (const slug of slugs) {
    const sides = await s3Side(s3, slug);
    const api = await apiSide(slug);
    const s3Num = sides.find((x) => x.num)?.num ?? null;
    console.log(`\n### ${slug}`);
    for (const x of sides) console.log(`    S3  ${x.key}  n=${x.n} num=${x.num ?? "∅"} mill=${x.mill ?? "∅"}`);
    if (!sides.length) console.log("    S3  (aucune clé)");
    console.log(`    API ${api}`);
    if (s3Num && !api.includes(String(s3Num))) {
      s3OnlyCount++;
      console.log(`    ⛔ DIVERGENCE: S3 porte ${s3Num}, l'API ne le sert pas`);
    } else if (s3Num) {
      agree++;
    }
  }
  console.log(`\nSUMMARY n=${slugs.length} accord=${agree} divergenceS3seul=${s3OnlyCount}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
