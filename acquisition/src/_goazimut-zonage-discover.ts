/**
 * _goazimut-zonage-discover.ts — READ-ONLY ArcGIS-REST discovery for a goAzimut /
 * GOnet muni. No writes. Finds the FULL-TERRITORY zonage MapServer layer behind the
 * GOnet6 viewer by enumerating the real ArcGIS catalog (anti-invention: every code
 * printed is read verbatim from the live service, never fabricated).
 *
 * goAzimut service pattern (observed):
 *   https://www.goazimut.com/gis109-<NN>/arcgis/rest/services/<MRC>/<municode>_<Muni>[_public]/MapServer/<layer>
 *
 * Steps:
 *   1. sweep gis109-01..gis109-<max> ArcGIS roots, collect folders/services;
 *   2. keep folders/services whose name matches the muni (--municode / --name);
 *   3. in each match, enumerate MapServer layers; for polygon layers whose name
 *      looks like zoning, query a page of features and dump the candidate
 *      zone-code fields + distinct sample values + total feature count + bbox.
 *
 * Usage:
 *   npx tsx acquisition/src/_goazimut-zonage-discover.ts --municode 46058 \
 *       --name "sutton|brome|missisquoi" [--max-shard 30] [--layer <serviceUrl>]
 */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function getJson(url: string, timeoutMs = 15_000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/json,*/*" } });
    if (!r.ok) return null;
    const txt = await r.text();
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function pool<T, R>(items: T[], conc: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

interface ServiceRef {
  shard: string;
  root: string;
  folder: string;
  name: string; // service name (may include folder path)
  type: string;
  url: string;
}

/** Recursively list services under an ArcGIS folder (one level of folders). */
async function listServices(root: string): Promise<{ folders: string[]; services: ServiceRef[] } | null> {
  const j = await getJson(`${root}?f=json`);
  if (!j || (!Array.isArray(j.services) && !Array.isArray(j.folders))) return null;
  const shard = root.match(/gis\d+-\d+/)?.[0] ?? "";
  const services: ServiceRef[] = (j.services ?? []).map((s: any) => ({
    shard,
    root,
    folder: "",
    name: String(s.name ?? ""),
    type: String(s.type ?? ""),
    url: `${root.replace(/\/$/, "")}/${String(s.name).split("/").pop()}/${s.type}`,
  }));
  return { folders: (j.folders ?? []).map(String), services };
}

async function enumerateLayer(serviceUrl: string, nameHint: string): Promise<void> {
  console.log(`\n--- MapServer: ${serviceUrl}`);
  const meta = await getJson(`${serviceUrl}?f=json`);
  if (!meta) {
    console.log(`    (illisible)`);
    return;
  }
  const layers: any[] = meta.layers ?? [];
  console.log(`    service="${meta.mapName ?? meta.documentInfo?.Title ?? ""}" layers=${layers.length}`);
  const ZONE_RE = /zon(age|e)|affect|urban|r[eè]glement/i;
  for (const ly of layers) {
    const isPoly = /Polygon/i.test(String(ly.geometryType ?? "")) || ly.geometryType === undefined;
    const looksZone = ZONE_RE.test(String(ly.name ?? ""));
    if (!looksZone) continue;
    const lurl = `${serviceUrl}/${ly.id}`;
    const lmeta = await getJson(`${lurl}?f=json`);
    const gtype = lmeta?.geometryType ?? ly.geometryType ?? "?";
    const fields: string[] = (lmeta?.fields ?? []).map((f: any) => String(f.name));
    // total count
    const cnt = await getJson(`${lurl}/query?where=1%3D1&returnCountOnly=true&f=json`);
    const total = cnt?.count ?? "?";
    console.log(`    [layer ${ly.id}] name="${ly.name}" geom=${gtype} count=${total} poly=${isPoly}`);
    console.log(`        fields: ${fields.join(", ")}`);
    // sample distinct code-ish values from likely fields
    const codeFields = fields.filter((f) =>
      /^(zon|no_?zon|code_?zon|zone|zonage|classe|usage|affect|grille|design)/i.test(f),
    );
    for (const f of codeFields.slice(0, 6)) {
      const q = await getJson(
        `${lurl}/query?where=1%3D1&outFields=${encodeURIComponent(f)}&returnDistinctValues=true&returnGeometry=false&f=json&resultRecordCount=60`,
      );
      const vals = (q?.features ?? [])
        .map((ft: any) => ft.attributes?.[f])
        .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "");
      const distinct = [...new Set(vals.map((v: any) => String(v).trim()))];
      console.log(`        · field "${f}" distinctSample(${distinct.length})=[${distinct.slice(0, 30).join(" | ")}]`);
    }
  }
}

async function main(): Promise<void> {
  const municode = arg("municode") ?? "";
  const nameRe = new RegExp(arg("name") ?? municode, "i");
  const maxShard = Number(arg("max-shard") ?? 30);
  const directLayer = arg("layer");
  const dumpShard = arg("dump");
  const dumpFolder = arg("folder");
  const scanUrl = arg("scan");
  const tryConfigs = arg("try-configs");
  const servlet = arg("servlet");
  const probeMuni = arg("probe-muni"); // municode, e.g. 46058

  if (probeMuni) {
    const code = probeMuni;
    const muniName = arg("muni-name") ?? "";
    const mrcName = arg("mrc-name") ?? "";
    const folder = `${code.slice(0, 3)}_${mrcName}`;
    const svcNames = [`${code}_${muniName}`, `${code}_${muniName}_public`];
    const maxN = Number(arg("max-shard") ?? 30);
    console.log(`[probe-muni] folder="${folder}" svc=[${svcNames.join(", ")}] shards=1..${maxN}`);
    const bases: string[] = [];
    for (let i = 1; i <= maxN; i++) {
      const shard = `gis109-${String(i).padStart(2, "0")}`;
      for (const svc of svcNames) {
        bases.push(`https://www.goazimut.com/${shard}/arcgis/rest/services/${folder}/${svc}/MapServer`);
      }
    }
    const hits: string[] = [];
    await pool(bases, 12, async (base) => {
      const j = await getJson(`${base}?f=json`, 12_000);
      if (j && (Array.isArray(j.layers) || j.mapName !== undefined || j.serviceDescription !== undefined)) {
        console.log(`  HIT ${base}  layers=${(j.layers ?? []).length} mapName="${j.mapName ?? ""}"`);
        hits.push(base);
      }
    });
    console.log(`[probe-muni] ${hits.length} MapServer hit(s)`);
    for (const h of hits) await enumerateLayer(h, code);
    return;
  }

  if (servlet) {
    const code = servlet;
    const bases = [
      "https://www.goazimut.com/GOnet6-servlet/GOnet6-servlet",
      "https://www.goazimut.com/GOnet6/GOnet6-servlet",
      "https://www.goazimut.com/gonet6-servlet/GOnet6-servlet",
    ];
    const cmds = [
      `Cmd=validateVersion&city=${code}`,
      `Cmd=validateVersion&city=${code}&version=public`,
      `Cmd=getConfig&city=${code}`,
      `Cmd=getProfile&city=${code}`,
      `Cmd=publicLogin&city=${code}`,
      `Cmd=getCity&city=${code}`,
    ];
    for (const b of bases) {
      for (const c of cmds) {
        const url = `${b}?${c}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15_000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/json,*/*" } }).catch(() => null);
        clearTimeout(t);
        if (!r) {
          console.log(`[servlet] ${url} -> no-response`);
          continue;
        }
        const body = await r.text().catch(() => "");
        const svc = new Set<string>();
        for (const m of body.match(/https?:\/\/[a-z0-9.\-]+\/[^"\\\s]*?(?:MapServer|FeatureServer)(?:\/\d+)?/gi) ?? []) svc.add(m);
        for (const m of body.match(/gis\d+-\d+\/arcgis\/rest\/services\/[^"\\\s]+/gi) ?? []) svc.add(m);
        console.log(`[servlet] ${url} -> ${r.status} bytes=${body.length} services=${svc.size}`);
        for (const s of svc) console.log(`    SVC ${s}`);
        // if it returned JSON with a service list, dump service/zonage hints
        if (body.length > 0 && /zonage|serviceName|layerZone|idService|arcgis/i.test(body)) {
          for (const m of (body.match(/"(?:serviceName|layerZone|url|serviceUrl|zonage|idService|serviceDefault)"\s*:\s*"?[^",}]{0,120}/gi) ?? []).slice(0, 20))
            console.log(`      hint ${m.replace(/\s+/g, " ")}`);
        }
      }
    }
    return;
  }

  if (scanUrl) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const r = await fetch(scanUrl, { signal: ctrl.signal, headers: { "user-agent": UA } }).catch(() => null);
    clearTimeout(t);
    if (!r || !r.ok) {
      console.log(`[scan] ${scanUrl} -> ${r ? r.status : "no-response"}`);
      return;
    }
    const body = await r.text();
    console.log(`[scan] ${scanUrl} bytes=${body.length}`);
    const grep = arg("grep");
    if (grep) {
      const cap = Number(arg("cap") ?? 40);
      const re = new RegExp(grep, "gi");
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      let n = 0;
      while ((m = re.exec(body)) !== null && n < cap) {
        const win = arg("match-only") !== undefined ? m[0] : body.slice(Math.max(0, m.index - 90), m.index + 130);
        const key = win.replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  «${key}»`);
        n++;
      }
      console.log(`[grep] ${n} unique window(s) for /${grep}/`);
      return;
    }
    const urls = new Set<string>();
    for (const m of body.match(/https?:\/\/[a-z0-9.\-]+[^\s"'`<>)]*/gi) ?? []) urls.add(m);
    const cfg = new Set<string>();
    for (const m of body.match(/["'`][^"'`]*(?:config|service|arcgis|gis109|MapServer|FeatureServer|proxy|\.json)[^"'`]*["'`]/gi) ?? [])
      cfg.add(m.replace(/["'`]/g, ""));
    console.log(`--- absolute URLs (${urls.size}) ---`);
    for (const u of [...urls].sort().slice(0, 40)) console.log(`  ${u}`);
    console.log(`--- config/service-ish string literals (${cfg.size}) ---`);
    for (const c of [...cfg].sort().slice(0, 60)) console.log(`  ${c}`);
    return;
  }

  if (tryConfigs) {
    const code = tryConfigs;
    const base = "https://www.goazimut.com/GOnet6";
    const candidates = [
      `${base}/config/config_${code}.json`,
      `${base}/config/${code}.json`,
      `${base}/config/C${code}.json`,
      `${base}/config/ville_${code}.json`,
      `${base}/config/villes/${code}.json`,
      `${base}/config/${code}/config.json`,
      `${base}/config/map_${code}.json`,
      `${base}/config/${code}/${code}.json`,
      `${base}/rest/config?m=${code}`,
      `${base}/rest/villes/${code}`,
      `${base}/api/config/${code}`,
      `${base}/api/ville/${code}`,
    ];
    for (const url of candidates) {
      const j = await getJson(url, 12_000);
      if (j) {
        const txt = JSON.stringify(j);
        const svc = new Set<string>();
        for (const m of txt.match(/https?:\/\/[a-z0-9.\-]+\/[^"\\]*?(?:MapServer|FeatureServer)(?:\/\d+)?/gi) ?? []) svc.add(m);
        console.log(`[config] HIT ${url}  services=${svc.size}`);
        for (const s of svc) console.log(`    ${s}`);
      } else {
        console.log(`[config] miss ${url}`);
      }
    }
    return;
  }

  if (directLayer) {
    await enumerateLayer(directLayer, municode);
    return;
  }

  if (dumpFolder) {
    const sub = await listServices(dumpFolder);
    console.log(`[folder] ${dumpFolder} -> ${sub ? `folders=${sub.folders.length} services=${sub.services.length}` : "null"}`);
    for (const f of sub?.folders ?? []) console.log(`  FOLDER ${f}`);
    for (const s of sub?.services ?? []) console.log(`  SVC ${s.name} (${s.type})`);
    return;
  }

  if (dumpShard) {
    const root = `https://www.goazimut.com/gis109-${dumpShard.padStart(2, "0")}/arcgis/rest/services`;
    const top = await listServices(root);
    console.log(`[dump] ${root} -> ${top ? `folders=${top.folders.length} services=${top.services.length}` : "NULL (unreachable/listing-off)"}`);
    for (const f of top?.folders ?? []) console.log(`  FOLDER ${f}`);
    for (const s of (top?.services ?? []).slice(0, 40)) console.log(`  SVC ${s.name} (${s.type})`);
    return;
  }

  const shards = Array.from({ length: maxShard }, (_, i) => `gis109-${String(i + 1).padStart(2, "0")}`);
  console.log(`[discover] sweeping ${shards.length} shards for muni="${nameRe}" municode=${municode}`);
  const matches: ServiceRef[] = [];
  await pool(shards, 10, async (shard) => {
    const root = `https://www.goazimut.com/${shard}/arcgis/rest/services`;
    const top = await listServices(root);
    if (!top) return;
    // top-level services matching muni
    for (const s of top.services) {
      if (nameRe.test(s.name) || (municode && s.name.includes(municode))) matches.push(s);
    }
    // matching folders → descend
    const foldersToOpen = top.folders.filter((f) => nameRe.test(f) || (municode && f.includes(municode.slice(0, 2))));
    for (const folder of foldersToOpen) {
      const sub = await listServices(`${root}/${folder}`);
      if (!sub) continue;
      for (const s of sub.services) {
        const full = `${folder}/${s.name.split("/").pop()}`;
        if (nameRe.test(full) || (municode && full.includes(municode))) {
          matches.push({ ...s, folder, url: `${root}/${folder}/${s.name.split("/").pop()}/${s.type}` });
        }
      }
      console.log(`  ${shard} folder="${folder}" services=${sub.services.length}`);
    }
  });

  console.log(`\n[discover] ${matches.length} service(s) matched muni`);
  const seen = new Set<string>();
  for (const m of matches) {
    if (seen.has(m.url)) continue;
    seen.add(m.url);
    console.log(`  MATCH shard=${m.shard} folder="${m.folder}" name="${m.name}" type=${m.type}\n    url=${m.url}`);
  }
  // enumerate MapServer matches for zonage layers
  for (const m of matches) {
    if (m.type !== "MapServer" && m.type !== "FeatureServer") continue;
    await enumerateLayer(m.url, municode);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});

export {};
