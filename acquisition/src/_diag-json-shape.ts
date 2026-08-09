/**
 * Décrire la FORME d'un gros JSON local (GeoJSON, dump SIG, dict) sans le déverser :
 * clés de premier niveau, type/longueur, et un échantillon de propriétés de features.
 *
 * Usage : npx tsx acquisition/src/_diag-json-shape.ts --file <f.json> [--sample 3] [--prop zone]
 */
import { readFileSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const file = arg("file");
if (!file) throw new Error("required: --file <f.json>");
const sample = Number(arg("sample", "3"));
const propFilter = arg("prop");

const j = JSON.parse(readFileSync(file, "utf8"));

function describe(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v === null) return "null";
  if (typeof v === "object") return `object{${Object.keys(v as object).slice(0, 12).join(",")}}`;
  return `${typeof v}:${String(v).slice(0, 60)}`;
}

console.log(`# top-level: ${describe(j)}`);
if (!Array.isArray(j) && typeof j === "object" && j !== null) {
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    console.log(`  ${k} -> ${describe(v)}`);
  }
}

const feats: any[] | undefined = Array.isArray(j)
  ? j
  : Array.isArray((j as any).features)
    ? (j as any).features
    : undefined;

if (feats?.length) {
  console.log(`# features: ${feats.length}`);
  for (const f of feats.slice(0, sample)) {
    const props = f?.properties ?? f;
    console.log(`  geom=${f?.geometry?.type ?? "-"} props=${JSON.stringify(props).slice(0, 600)}`);
  }
  if (propFilter) {
    const vals = new Set<string>();
    for (const f of feats) {
      const p = (f?.properties ?? f) as Record<string, unknown>;
      for (const [k, v] of Object.entries(p ?? {})) {
        if (k.toLowerCase().includes(propFilter.toLowerCase()) && v != null) vals.add(`${k}=${String(v)}`);
      }
    }
    console.log(`# valeurs distinctes contenant « ${propFilter} » : ${vals.size}`);
    console.log([...vals].slice(0, 40).join(" | "));
  }
}
