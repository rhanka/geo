/**
 * _dump-sig-props — $0 read-only diagnostic. Print the RAW property keys + a few
 * sample values of the served SIG zonage geojson for a muni.
 *
 * POURQUOI : `_dump-sig-codes` ne montre que le champ CANON retenu. Quand l'overlap
 * grille⋈SIG est 0, deux causes INDISCERNABLES sans voir les propriétés brutes :
 *   (a) le pipeline a retenu le MAUVAIS champ (un autre champ porte le vrai code)
 *       → réparable côté zones (canon-serve), le dépôt normes est récupérable ;
 *   (b) le SIG ne porte réellement QUE ce schéma de codes (numéros nus, affectations)
 *       → mismatch GÉNUINE, aucun recode possible sans inventer.
 * Distinguer les deux évite d'abandonner un dépôt récupérable ET d'inventer un pont.
 *
 * Écrit RIEN ; lit le geojson servi tel quel.
 *
 *   npx tsx acquisition/src/_dump-sig-props.ts --slug palmarolle [--samples 3]
 */
import { getBytes, s3Client } from "./lib/s3.js";
import { resolveGridKey } from "./lib/zonage-norms.js";

function arg(k: string, def = ""): string {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const slug = arg("slug").trim();
  const samples = Number(arg("samples", "3"));
  if (!slug) throw new Error("required: --slug <slug>");
  const s3 = s3Client();
  const key = await resolveGridKey(s3, slug);
  if (!key) {
    console.log(`slug=${slug} gridKey=NONE`);
    return;
  }
  const raw = await getBytes(s3, key);
  const fc = JSON.parse(Buffer.from(raw).toString("utf8")) as {
    features?: Array<{ properties?: Record<string, unknown> }>;
  };
  const feats = fc.features ?? [];
  console.log(`slug=${slug} key=${key} features=${feats.length}`);
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  console.log(`propertyKeys(${keys.size}): ${JSON.stringify([...keys])}`);
  for (const k of keys) {
    const vals = new Set<string>();
    for (const f of feats) {
      const v = f.properties?.[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") vals.add(String(v));
      if (vals.size > 60) break;
    }
    const show = [...vals].slice(0, samples);
    console.log(`  ${k}: distinct≈${vals.size > 60 ? "60+" : vals.size} e.g. ${JSON.stringify(show)}`);
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
