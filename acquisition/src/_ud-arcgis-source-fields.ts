/**
 * _ud-arcgis-source-fields — $0 (lane usage_dominant). Interroge la COUCHE ARCGIS
 * SOURCE d'un slug (celle nommée dans la provenance du geojson servi) avec
 * outFields=* pour voir si elle porte un champ de VOCATION que la normalisation a
 * jeté (cas mesurés: `Dominante` Altus, `affectation` MRC, `Description`).
 * `_usage-dom-attr-probe.ts` lit le geojson SERVI et est donc aveugle à ces champs.
 *
 *   npx tsx acquisition/src/_ud-arcgis-source-fields.ts --url "https://www.goazimut.com/.../MapServer/157"
 *   npx tsx acquisition/src/_ud-arcgis-source-fields.ts --url <url> --field Dominante   (valeurs distinctes)
 */
function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UA = { "User-Agent": "Mozilla/5.0" };

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) {
    console.log(`  HTTP ${res.status} ${url}`);
    return null;
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.log(`  réponse non-JSON (${text.length}o)`);
    return null;
  }
}

async function main(): Promise<void> {
  const base = (arg("url") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("usage: --url <url couche ArcGIS (…/MapServer/<n>)>");
  const meta = await getJson(`${base}?f=json`);
  if (meta) {
    console.log(`# couche: ${String(meta.name ?? "?")}  (type=${String(meta.type ?? "?")})`);
    const fields = (meta.fields ?? []) as { name?: string; alias?: string; type?: string }[];
    for (const f of fields) console.log(`  ${f.name} | ${f.alias ?? ""} | ${f.type ?? ""}`);
  }
  const q =
    `${base}/query?where=${encodeURIComponent("1=1")}&outFields=*&returnGeometry=false` +
    `&resultRecordCount=${arg("n") ?? "8"}&f=json`;
  const rows = await getJson(q);
  const feats = (rows?.features ?? []) as { attributes?: Record<string, unknown> }[];
  console.log(`# échantillon: ${feats.length} entités`);
  const only = arg("field");
  if (only) {
    const seen = new Map<string, number>();
    for (const f of feats) {
      const v = String(f.attributes?.[only] ?? "(vide)");
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    for (const [v, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${JSON.stringify(v)} n=${n}`);
    return;
  }
  for (const f of feats) console.log(`  ${JSON.stringify(f.attributes ?? {})}`);
}

await main();
