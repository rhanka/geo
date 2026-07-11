/**
 * _boniface-geocentralis-probe.ts — diagnostic (lecture seule, réseau)
 * Sonde le WFS geocentralis (evb:zonage_municipal moderne + evb:siadmin_pzon_99_s
 * ancien) pour un ou plusieurs id_municipalite MAMH afin de savoir si une géométrie
 * de zonage MUNICIPAL vectorielle EN VIGUEUR existe pour saint-boniface (Maskinongé).
 * Repli lane [[geocentralis-zonage-municipal-lane]]. Contrôle témoin = saint-mathieu
 * (57045, servi via siadmin_pzon_99_s) pour prouver que la sonde fonctionne.
 * USAGE : npx tsx acquisition/src/_boniface-geocentralis-probe.ts <id_muni> [<id_muni> ...]
 */
const BASE = "https://geoserver.geocentralis.com/geoserver/ows";
const TYPES = ["evb:zonage_municipal", "evb:siadmin_pzon_99_s"];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["51015", "57045"];

async function hits(typeName: string, idMuni: string): Promise<string> {
  const url =
    `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(typeName)}` +
    `&resultType=hits&CQL_FILTER=${encodeURIComponent(`id_municipalite=${idMuni}`)}`;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 geo-diagnostic" } });
    const txt = await r.text();
    if (!r.ok) return `HTTP ${r.status} :: ${txt.slice(0, 120).replace(/\s+/g, " ")}`;
    const m = txt.match(/numberMatched="(\d+)"|numberOfFeatures="(\d+)"/);
    const n = m ? (m[1] ?? m[2]) : "?";
    return `numberMatched=${n}`;
  } catch (e) {
    return `FETCH-ERR ${(e as Error).message}`;
  }
}

(async () => {
  for (const id of ids) {
    console.log(`\n=== id_municipalite=${id}`);
    for (const t of TYPES) {
      console.log(`  ${t.padEnd(26)} -> ${await hits(t, id)}`);
    }
  }
})();
