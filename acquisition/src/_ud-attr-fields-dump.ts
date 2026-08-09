/**
 * _ud-attr-fields-dump — dump des valeurs distinctes de TOUS les champs (ou d'une liste) d'une
 * collection `qc-zonage-<slug>` SERVIE.
 *
 * Raison d'être : les sondes de la lane `usage_dominant` (`_ud-affectation-dump`,
 * `_usage-dom-attr-probe`) interrogent une liste de noms de champs (« hint-fields »). Or un export
 * SHAPEFILE tronque les noms à 10 caractères — `Affectation` devient `Affectatio`, `Description`
 * devient `Descriptio` — et certaines couches nomment la vocation `Vocation`, `Dominante`,
 * `Categorie`, `Zonage_abr`… Une sonde à hint-fields rend alors « (vide) » alors que la légende
 * est là. Ce dump n'a PAS de hint-fields : il montre tout, pour trancher à $0.
 *
 * usage:
 *   npx tsx acquisition/src/_ud-attr-fields-dump.ts --slug <slug> [--fields a,b,c] [--top N]
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = arg("slug");
if (!slug) {
  console.error("usage: --slug <slug> [--fields a,b,c] [--top N]");
  process.exit(1);
}
const fields = (arg("fields") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const top = Number(arg("top") ?? 14);

const keys = [
  `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`,
  `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
];

const s3 = s3Client();
let features: any[] | null = null;
for (const key of keys) {
  if (!(await exists(s3, key))) continue;
  const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  if (Array.isArray(parsed?.features) && parsed.features.length > 0) {
    console.log(`# clé ${key} — ${parsed.features.length} entités`);
    features = parsed.features;
    break;
  }
  console.log(`# clé ${key} — 0 entité (couche VIDE)`);
}
if (!features) {
  console.log("# aucune clé servie ne porte d'entité");
  process.exit(0);
}

const props = features.map((f) => f?.properties ?? {});
const names = fields.length ? fields : [...new Set(props.flatMap((p) => Object.keys(p)))];
for (const name of names) {
  const counts = new Map<string, number>();
  for (const p of props) {
    const raw = p[name];
    const v = raw === undefined || raw === null || raw === "" ? "(vide)" : String(raw);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const vide = counts.get("(vide)") ?? 0;
  console.log(`\n## ${name}  (${counts.size} valeurs distinctes, ${vide} vides)`);
  for (const [v, n] of rows.slice(0, top)) console.log(`   ${String(n).padStart(4)}  ${v.slice(0, 120)}`);
  if (rows.length > top) console.log(`   … ${rows.length - top} autres`);
}
