/**
 * _ud-affectation-sweep.ts — $0 read-only (lane usage_dominant). Balaye TOUTES les
 * cibles d'un shard (work/coverage/zonage-enrichment.json: served && !usage_dominant,
 * sans config committé) et n'imprime QUE les slugs dont le zonage servi porte un
 * attribut de VOCATION non vide (`affectation`, `Description`, `Usages`, `vocation`,
 * `DESCRIPTION`, `AFFECTATION`, `USAGE`, `NOM_ZONE`, `TYPE_ZONE`, `nom_zone`).
 *
 * C'est le gisement $0 le plus rentable de la lane: quand le SIG porte déjà la
 * vocation VERBATIM par feature, aucun PDF de règlement n'est nécessaire.
 * N'écrit rien.
 *
 *   npx tsx acquisition/src/_ud-affectation-sweep.ts --shard 1 --of 2
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

// ⛔ ANGLE MORT CORRIGÉ (2026-07-19): la sonde ne connaissait que `affectation`/`Description`/
// `Usages`/`vocation`/`nom_zone`/`TYPE_ZONE` et rendait donc `(vide)` sur des munis dont la vocation
// VERBATIM était bel et bien servie, sous un AUTRE nom de champ: `Dominante` (couches Altus
// `gis.altusquebec.com/.../MRC330/*_Publique/MapServer`, qui a servi saint-apollinaire 173 pol.),
// `Dominance` (couches SIGALE `*_Publique/MapServer`, qui a servi hope) et `etiquette_2`
// (couche geocentralis `evb:siadmin_pzon_99_s`, qui a servi franquelin/launay/saint-marcel).
const VOCATION_FIELDS = [
  "affectation",
  "AFFECTATION",
  "Affectation",
  "Dominante",
  "DOMINANTE",
  "dominante",
  "Dominance",
  "DOMINANCE",
  "dominance",
  "etiquette_2",
  "ETIQUETTE_2",
  "Description",
  "DESCRIPTION",
  "description",
  "Usages",
  "USAGE",
  "usage",
  "vocation",
  "VOCATION",
  "nom_zone",
  "NOM_ZONE",
  "TYPE_ZONE",
  "type_zone",
];

function arg(k: string, d?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
}

function zoneCodeOf(props: Record<string, unknown>): string | null {
  for (const name of SIG_ZONE_CODE_FIELDS) {
    const v = props[name];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function alphaPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return m ? m[0] : "(num)";
}

async function main(): Promise<void> {
  const shard = Number(arg("shard", "0"));
  const of = Number(arg("of", "1"));
  const data = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: { slug: string; served: boolean; usage_dominant: boolean }[];
  };
  const all = data.perMuni
    .filter((m) => m.served && !m.usage_dominant)
    .map((m) => m.slug)
    .sort((a, b) => a.localeCompare(b));
  const mine = all
    .filter((_, i) => i % of === shard)
    .filter((s) => !existsSync(resolve(MAP_DIR, `${s}.json`)));

  const s3 = s3Client();
  let hits = 0;
  for (const slug of mine) {
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let key: string | null = null;
    for (const k of candidates) if (await exists(s3, k)) { key = k; break; }
    if (!key) continue;
    let fc: { features?: { properties?: Record<string, unknown> }[] };
    try {
      fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    } catch {
      continue;
    }
    const byPref = new Map<string, Set<string>>();
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      const code = zoneCodeOf(p);
      if (!code) continue;
      const pref = alphaPrefix(canonZoneCodeServe(code) || code);
      for (const fld of VOCATION_FIELDS) {
        const v = p[fld];
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;
        if (!byPref.has(pref)) byPref.set(pref, new Set());
        byPref.get(pref)!.add(`${fld}=${s}`);
        break;
      }
    }
    if (!byPref.size) continue;
    hits++;
    console.log(`\n=== ${slug} (${(fc.features ?? []).length} features) ===`);
    for (const [pref, vals] of [...byPref.entries()].sort()) {
      console.log(`  [${pref}] ${[...vals].slice(0, 4).join(" | ")}`);
    }
  }
  console.log(`\n[sweep shard ${shard}/${of}: ${mine.length} cibles, ${hits} avec attribut vocation non vide]`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
