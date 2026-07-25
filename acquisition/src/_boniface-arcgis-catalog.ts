/**
 * _boniface-arcgis-catalog.ts — diagnostic (lecture seule, réseau)
 * Énumère le catalogue REST ArcGIS Server du MRC Maskinongé (racine + dossiers) pour
 * savoir si un service de ZONAGE municipal est accessible anonymement (le dossier
 * 'Zonage' est réputé token-protégé ; l'app ExB publique ne référence que la matrice
 * cadastrale). But: écarter/valider la dernière lane vecteur pour saint-boniface.
 * USAGE : npx tsx acquisition/src/_boniface-arcgis-catalog.ts [<servicesRoot>]
 */
const base = (process.argv[2] ?? "https://carto2.mrc-maskinonge.qc.ca/server/rest/services").replace(/\/$/, "");
const ZON = /zon|urban|regl|affect|pz/i;

async function j(u: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const r = await fetch(`${u}?f=json`, { headers: { "user-agent": "Mozilla/5.0 geo-diagnostic" } });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) {
    return { ok: false, status: -1, body: `FETCH-ERR ${(e as Error).message}` };
  }
}

(async () => {
  const root = await j(base);
  console.log(`ROOT status=${root.status}`);
  let cfg: any;
  try { cfg = JSON.parse(root.body); } catch { console.log(root.body.slice(0, 300)); return; }
  const folders: string[] = cfg.folders ?? [];
  const svcs: any[] = cfg.services ?? [];
  console.log(`root services: ${svcs.map((s) => `${s.name}/${s.type}`).join(", ").slice(0, 400)}`);
  console.log(`folders(${folders.length}): ${folders.join(", ")}`);
  const zf = folders.filter((f) => ZON.test(f));
  const scan = zf.length ? zf : folders;
  for (const f of scan) {
    const fr = await j(`${base}/${f}`);
    let fc: any;
    try { fc = JSON.parse(fr.body); } catch { console.log(`== ${f} status=${fr.status} ${fr.body.slice(0, 140).replace(/\s+/g, " ")}`); continue; }
    const names = (fc.services ?? []).map((s: any) => `${s.name}/${s.type}`);
    const flag = names.some((n: string) => ZON.test(n)) ? "  <== ZONAGE?" : "";
    console.log(`== ${f} status=${fr.status} services: ${names.join(", ").slice(0, 400)}${flag}`);
  }
})();

export {};
