/**
 * _zones-col2-reacq-precount-20260816.ts — SONDE READ-ONLY pré-capture pour la
 * ré-acquisition col-2 de beaupre + mille-isles (triage 2c741540).
 *
 * NE CAPTE PAS, N'ÉCRIT RIEN sur S3. Interroge UNIQUEMENT les FeatureServer publics
 * pour CONFIRMER, AVANT la capture cluster (mandatoire, CLAUDE.md) :
 *   1. la métadonnée de couche (geometryType, champ code-zone, srs native, maxRecordCount) ;
 *   2. le returnCountOnly avec le MÊME `where` que la worklist (attendu 78 / 66) ;
 *   3. qu'une requête `f=geojson&outSR=4326` rend bien du WGS84 lon/lat plausible QC
 *      (bbox d'un échantillon) — garde-fou reprojection MTM7→4326 (beaupre) et
 *      3857→4326 (mille-isles) côté serveur, avant d'engager un run de capture.
 *
 * USAGE : npx tsx acquisition/src/_zones-col2-reacq-precount-20260816.ts
 */

interface Probe { slug: string; layer: string; where: string; codeField: string; expected: number }

const PROBES: Probe[] = [
  {
    slug: "beaupre",
    layer: "https://services6.arcgis.com/osUKB2jztkflrQhx/arcgis/rest/services/Zonage/FeatureServer/17",
    where: "1=1",
    codeField: "ZONE_",
    expected: 78,
  },
  {
    slug: "mille-isles",
    layer: "https://services9.arcgis.com/iZcAwIV2GibwcZLe/arcgis/rest/services/Zonage/FeatureServer/0",
    where: "co_mun=76030",
    codeField: "zone",
    expected: 66,
  },
];

async function getJson(url: string, timeoutMs = 40_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-precount-probe/1", accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}

async function main(): Promise<void> {
  for (const p of PROBES) {
    process.stdout.write(`\n=== ${p.slug} ===\n`);
    // (1) couche
    try {
      const meta = await getJson(`${p.layer}?f=json`) as {
        name?: string; geometryType?: string; maxRecordCount?: number;
        fields?: Array<{ name: string; type: string }>;
        extent?: { spatialReference?: { wkid?: number; latestWkid?: number; wkt?: string } };
      };
      const field = meta.fields?.find((f) => f.name === p.codeField || f.name.toLowerCase() === p.codeField.toLowerCase());
      const sr = meta.extent?.spatialReference;
      process.stdout.write(`layer name=${meta.name} geometryType=${meta.geometryType} maxRecordCount=${meta.maxRecordCount}\n`);
      process.stdout.write(`code_field ${p.codeField}: type=${field?.type ?? "ABSENT"} (resolved=${field?.name ?? "none"})\n`);
      process.stdout.write(`native SR: wkid=${sr?.wkid ?? "-"} latestWkid=${sr?.latestWkid ?? "-"} wkt=${sr?.wkt ? "present" : "absent"}\n`);
      // co_mun field type (mille-isles) — décide du quotage du where
      const comun = meta.fields?.find((f) => f.name.toLowerCase() === "co_mun");
      if (comun) process.stdout.write(`co_mun field: type=${comun.type} (numeric→where sans quotes ; string→with quotes)\n`);
    } catch (e) { process.stdout.write(`layer meta ERROR: ${(e as Error).message}\n`); }
    // (2) returnCountOnly (MÊME where)
    try {
      const cnt = await getJson(`${p.layer}/query?where=${encodeURIComponent(p.where)}&returnCountOnly=true&f=json`) as { count?: number; error?: unknown };
      if (cnt.error) process.stdout.write(`count ERROR: ${JSON.stringify(cnt.error).slice(0, 160)}\n`);
      else process.stdout.write(`returnCountOnly(where=${p.where}) = ${cnt.count} (attendu ${p.expected}) ${cnt.count === p.expected ? "OK" : "≠ ATTENDU"}\n`);
    } catch (e) { process.stdout.write(`count ERROR: ${(e as Error).message}\n`); }
    // (3) échantillon f=geojson&outSR=4326 → bbox WGS84 plausible
    try {
      const gj = await getJson(`${p.layer}/query?where=${encodeURIComponent(p.where)}&outFields=${encodeURIComponent(p.codeField)}&outSR=4326&resultRecordCount=3&f=geojson`) as {
        type?: string; features?: Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }>; error?: unknown;
      };
      if (gj.error) { process.stdout.write(`sample ERROR: ${JSON.stringify(gj.error).slice(0, 160)}\n`); }
      else {
        const feats = gj.features ?? [];
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const f of feats) for (const [x, y] of positions(f.geometry?.coordinates)) {
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
        const wgs84Plausible = minx > -180 && maxx < 180 && miny > -90 && maxy < 90 && minx < -60 && minx > -85 && miny > 40 && miny < 55;
        process.stdout.write(`sample f=geojson&outSR=4326: type=${gj.type} n=${feats.length} bbox=[${minx.toFixed(4)},${miny.toFixed(4)},${maxx.toFixed(4)},${maxy.toFixed(4)}] WGS84_QC_plausible=${wgs84Plausible}\n`);
        process.stdout.write(`sample codes: ${JSON.stringify(feats.slice(0, 3).map((f) => f.properties?.[p.codeField] ?? f.properties?.[p.codeField.toLowerCase()]))}\n`);
      }
    } catch (e) { process.stdout.write(`sample ERROR: ${(e as Error).message}\n`); }
  }
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
