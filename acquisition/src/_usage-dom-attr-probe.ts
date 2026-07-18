/**
 * _usage-dom-attr-probe — $0 read-only. Beaucoup de couches SIG municipales
 * (ArcGIS/MRC) portent, EN PLUS du zone_code, un attribut VERBATIM d'affectation /
 * vocation / dominance qui EST la « fonction dominante » de la zone (cf. précédent
 * saint-michel-de-bellechasse: attribut `affectation`). Cet attribut est une SOURCE
 * ANTI-INVENTION directe (pas la matrice des usages permis).
 *
 * Pour chaque slug, l'outil lit le polygone servi (S3), et pour CHAQUE préfixe alpha
 * du zone_code il imprime, pour une liste de champs candidats (affectation, vocation,
 * dominance, designation, usage, typ*, aff*), la/les valeur(s) distinctes observées.
 * Ainsi on voit d'un coup si « HA -> Habitation », « A -> Agricole », etc. sont
 * lisibles VERBATIM sur la feature. N'écrit rien.
 *
 *   npx tsx acquisition/src/_usage-dom-attr-probe.ts --slugs honfleur,cloridorme
 *   npx tsx acquisition/src/_usage-dom-attr-probe.ts --slugs honfleur --all-fields
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
type S3 = ReturnType<typeof s3Client>;

/** Champs candidats à porter la fonction dominante VERBATIM (case-insensible, substring). */
const AFFECT_HINTS = [
  "affect", "vocation", "dominan", "design", "usage", "fonction", "categ",
  "typ", "aff_", "nom_zone", "descr", "libel", "grand", "classe",
];

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function zoneCodeOf(props: Record<string, unknown>): string | null {
  for (const name of SIG_ZONE_CODE_FIELDS) {
    const v = props[name];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function alphaPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return m ? m[0] : "(num)";
}

async function keyFor(s3: S3, slug: string): Promise<string | null> {
  for (const k of [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ]) {
    if (await exists(s3, k)) return k;
  }
  return null;
}

async function probe(s3: S3, slug: string, allFields: boolean): Promise<void> {
  const key = await keyFor(s3, slug);
  if (!key) { console.log(`\n### ${slug} — NON servi`); return; }
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
    features?: { properties?: Record<string, unknown> }[];
  };
  const feats = fc.features ?? [];
  // Repère les champs candidats présents (non vides quelque part).
  const allKeys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
  const cand = [...allKeys].filter((k) =>
    allFields ? true : AFFECT_HINTS.some((h) => k.toLowerCase().includes(h)),
  ).filter((k) => !SIG_ZONE_CODE_FIELDS.includes(k as never));
  console.log(`\n### ${slug} — features=${feats.length}`);
  console.log(`  champs candidats affectation: ${cand.length ? cand.join(", ") : "(aucun)"}`);
  if (!cand.length) return;
  // Par préfixe, valeurs distinctes de chaque champ candidat.
  const byPref = new Map<string, Map<string, Set<string>>>();
  for (const f of feats) {
    const props = f.properties ?? {};
    const code = zoneCodeOf(props);
    if (!code) continue;
    const pref = alphaPrefix(canonZoneCodeServe(code) || code);
    let m = byPref.get(pref);
    if (!m) { m = new Map(); byPref.set(pref, m); }
    for (const c of cand) {
      const v = props[c];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      let s = m.get(c);
      if (!s) { s = new Set(); m.set(c, s); }
      if (s.size < 4) s.add(String(v).trim());
    }
  }
  for (const [pref, m] of [...byPref.entries()].sort()) {
    const parts = [...m.entries()].map(([c, s]) => `${c}=[${[...s].join(" | ")}]`);
    console.log(`  ${pref.padEnd(6)} ${parts.join("  ") || "(aucune valeur candidate)"}`);
  }
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) { console.error("pass --slugs a,b"); process.exit(2); }
  const allFields = process.argv.includes("--all-fields");
  const s3 = s3Client();
  for (const slug of slugs) {
    try { await probe(s3, slug, allFields); } catch (e) { console.log(`\n### ${slug} — ERR ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
