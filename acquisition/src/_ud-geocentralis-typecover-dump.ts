/**
 * _ud-geocentralis-typecover-dump.ts — $0 read-only (réseau, n'écrit rien)
 *
 * Variante de _ud-geocentralis-etiquette-dump.ts : quand `etiquette_2` est VIDE,
 * la couche geocentralis `evb:siadmin_pzon_99_s` peut malgré tout porter la
 * vocation en clair dans `type_cover` (« Residentiel », « Agriculture »,
 * « Residentiel,Communautaire »…). Ce script imprime, pour un id_municipalite
 * donné, la table etiquette_1 (= zone_code) -> type_cover, sans agrégation.
 *
 * USAGE : npx tsx acquisition/src/_ud-geocentralis-typecover-dump.ts --muni 52045
 *         [--type evb:siadmin_pzon_99_s] [--max 4000]
 */
const BASE = "https://geoserver.geocentralis.com/geoserver/ows";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const muni = arg("muni");
  const type = arg("type") ?? "evb:siadmin_pzon_99_s";
  const max = Number(arg("max") ?? 4000);
  if (!muni) throw new Error("required: --muni <id_municipalite>");

  // Les identifiants municipaux GeoCentralis sont des chaînes à cinq caractères
  // (p. ex. « 09035 ») : sans guillemets, le WFS les traite comme un nombre et
  // perd le zéro initial.
  const cql = `id_municipalite='${muni.replace(/'/g, "''")}'`;
  const url =
    `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(type)}` +
    `&outputFormat=${encodeURIComponent("application/json")}&count=${max}` +
    `&CQL_FILTER=${encodeURIComponent(cql)}&propertyName=` +
    encodeURIComponent(
      "id_municipalite,id_nom_cover,type_cover,annee,description,etiquette_1,etiquette_2,etiquette_3,etiquette_4,etiquette_5",
    );
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 geo-diagnostic" } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} :: ${txt.slice(0, 300).replace(/\s+/g, " ")}`);
  const js = JSON.parse(txt) as { features?: { properties?: Record<string, unknown> }[] };
  const feats = js.features ?? [];
  console.log(`### id_municipalite=${muni} — ${feats.length} entités`);

  const rows: { e1: string; tc: string; extra: string }[] = [];
  const byTc = new Map<string, string[]>();
  for (const f of feats) {
    const p = f.properties ?? {};
    const s = (k: string): string => (p[k] == null ? "" : String(p[k]).trim());
    const e1 = s("etiquette_1");
    const tc = s("type_cover");
    const extra = [
      `annee=${s("annee")}`,
      `desc=${s("description")}`,
      `e2=${s("etiquette_2")}`,
      `e3=${s("etiquette_3")}`,
      `e4=${s("etiquette_4")}`,
      `e5=${s("etiquette_5")}`,
      `cover=${s("id_nom_cover")}`,
    ].join(" ");
    rows.push({ e1, tc, extra });
    if (!byTc.has(tc)) byTc.set(tc, []);
    byTc.get(tc)!.push(e1);
  }
  rows.sort((a, b) => a.e1.localeCompare(b.e1));
  for (const r2 of rows) console.log(`  ${r2.e1.padEnd(12)} type_cover=${r2.tc.padEnd(34)} ${r2.extra}`);

  console.log(`\n--- regroupement par type_cover (${byTc.size} valeurs distinctes) ---`);
  for (const [tc, codes] of [...byTc.entries()].sort()) {
    console.log(`  «${tc}» n=${codes.length}: ${codes.sort().join(", ")}`);
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });

export {};
