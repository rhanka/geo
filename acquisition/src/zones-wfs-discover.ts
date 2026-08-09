/**
 * zones-wfs-discover.ts — DISCOVERY (sans Chromium, sans Mistral) d'instances
 * GeoServer/WFS servant du zonage municipal, AU-DELÀ de Geocentralis.
 *
 * POURQUOI :
 *   `zones-wfs-run.ts` moissonne UN GeoServer connu (défaut: Geocentralis,
 *   `evb:zonage_municipal`, 67 villes). Pour étendre la famille il faut TROUVER
 *   d'autres endpoints GeoServer (vendeurs JMap-server, ESRI-via-WFS, consultants
 *   GIS) dont une couche zonage est exposée en WFS standard. Ce tool sonde les
 *   villes `zones=to-research`, extrait toute base GeoServer/WFS référencée
 *   (contenu de page + sous-domaines `geo./carte./cartes./sig./gis./carto.`),
 *   dédoublonne les hôtes, puis fait GetCapabilities pour LISTER les couches et
 *   FLAGGER celles qui ressemblent à du zonage (+ DescribeFeatureType du meilleur
 *   candidat pour identifier le champ zone_code et un champ muni).
 *
 * Lecture seule, AUCUN dépôt. La moisson reste à `zones-wfs-run.ts`.
 *
 * USAGE :
 *   npx tsx src/zones-wfs-discover.ts --slugs a,b,c [--out f.json] [--conc 16]
 *   npx tsx src/zones-wfs-discover.ts --slugs-file path [--no-subdomains]
 *   npx tsx src/zones-wfs-discover.ts --caps-only https://host/geoserver/ows
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 12_000;
const SUB_TIMEOUT = 6_000;
const CAPS_TIMEOUT = 20_000;

// Connu / déjà moissonné → on l'ignore comme "nouveau".
const KNOWN_HOSTS = [/geoserver\.geocentralis\.com/i];

// Marqueurs d'URL GeoServer / WFS (haute confiance) dans le contenu d'une page.
const GS_URL_RE = /https?:\/\/[a-z0-9.\-]+(?::\d+)?\/[^\s"'<>)]*?(?:geoserver|service=wfs|request=getcapabilities|\/ows\b|\/wfs\b)[^\s"'<>)]*/gi;
// Liens carto/urbanisme à suivre (1 hop) — même esprit que zones-platform-probe.
const CARTO_LINK_RE = /carte|g[ée]oportail|cartograph|zonage|urbanis|interactiv|matrice|\bsig\b|g[ée]omati|services?[-_]en[-_]ligne/i;
// Sous-domaines GIS courants. (geoserver/wfs/donnees ajoutés : un GeoServer dédié
// vit souvent sous geoserver.<domaine> ou wfs.<domaine>, angle non couvert par la
// passe précédente.)
const SUB_PREFIXES = ["geo", "carte", "cartes", "sig", "gis", "carto", "map", "maps", "geomatique", "geoserver", "wfs", "donnees", "ows"];
// Une couche "zonage" plausible (nom OU titre).
const ZONE_LAYER_RE = /zonage|zoning|affectation|urbanis|\bgrille\b|plan.?urb|reglement.*zon/i;
const AFFECT_LAYER_RE = /affectation|agricole|cptaq|zone\s*verte|milieux?.humide|inondation|contrainte|risque/i;
const ZONE_FIELD_RE = /^(zone_?code|zonage|zoning|zone|num_?zone|no_?zone|code_?zone|codezonage|no_?zonage|no_?zonage_?municipal|zonage_?id|zonagemunicipalid|regzone|etiquette_?\d*|[eé]tiquette_?\d*|identifiant)$/i;
const FIELD_EXCLUDE_RE = /objectid|^fid$|globalid|shape|superfic|^area$|longueur|length|perimet|date|^modif$|matricule|adresse|propri[eé]t|code_?postal|municipalit|id_?municip|code_?mun|mamh|cadastre|no_?lot|\blot\b/i;
const MUNI_FIELD_RE = /^(id_?municipalite|code_?mun|mun_?code|id_?muni|municipalit|sdr|geocode_?mun|no_?muni|cod[_]?mun)$/i;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url: string, timeoutMs = TIMEOUT): Promise<{ ok: boolean; ct: string; body: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xml,*/*" } });
    const ct = r.headers.get("content-type") ?? "";
    if (!r.ok) return { ok: false, ct, body: "" };
    const buf = await r.arrayBuffer();
    return { ok: true, ct, body: Buffer.from(buf).toString("utf8").slice(0, 1_200_000) };
  } catch { return null; } finally { clearTimeout(t); }
}

/** Absolute href/src/data-* targets + bare URLs, cross-host allowed. */
export function extractUrls(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /(?:href|src|action|data-src|data-url|data-href|value|content)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").replace(/&amp;/g, "&");
    if (!raw || raw.startsWith("data:") || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    try { out.add(new URL(raw, base).href); } catch { /* skip */ }
  }
  for (const u of html.match(/https?:\/\/[a-z0-9.\-]+\.[a-z]{2,}[^\s"'<>)]*/gi) ?? []) out.add(u.replace(/&amp;/g, "&"));
  return [...out];
}

/** Pull GeoServer/WFS URLs from raw text (page body, JSON config, inline JS). */
export function extractGeoserverUrls(text: string): string[] {
  const out = new Set<string>();
  for (const u of text.match(GS_URL_RE) ?? []) out.add(u.replace(/&amp;/g, "&"));
  return [...out];
}

/** Normalize any GeoServer/WFS URL to a stable GetCapabilities-capable base. */
export function geoserverBase(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname;
  // .../geoserver[/workspace]/ows|wfs  → keep up to /geoserver then /ows
  const gi = path.toLowerCase().indexOf("/geoserver");
  if (gi >= 0) {
    // keep an optional workspace segment between /geoserver and /ows|/wfs for vhost installs
    const after = path.slice(gi);
    const m = after.match(/^\/geoserver(\/[A-Za-z0-9_\-]+)?\/(?:ows|wfs|wms)\b/i);
    if (m) return `${u.origin}${path.slice(0, gi)}/geoserver${m[1] ?? ""}/ows`;
    return `${u.origin}${path.slice(0, gi)}/geoserver/ows`;
  }
  // bare /ows or /wfs (non-/geoserver install, e.g. mapserver/qgis-server)
  const m2 = path.match(/^(.*)\/(ows|wfs)\b/i);
  if (m2) return `${u.origin}${m2[1]}/ows`;
  return null;
}

export function isKnownHost(base: string): boolean {
  return KNOWN_HOSTS.some((re) => re.test(base));
}

function baseDomain(host: string): string { return host.replace(/^www\./i, ""); }

interface SlugHit { slug: string; site: string | null; bases: string[]; subHits: string[]; status: string; }

async function discoverSlug(slug: string, probeSubdomains: boolean): Promise<SlugHit> {
  const site = websiteForSlug(slug) ?? null;
  if (!site) return { slug, site: null, bases: [], subHits: [], status: "no-site" };
  let host: string;
  try { host = new URL(site).host; } catch { return { slug, site, bases: [], subHits: [], status: "bad-site" }; }

  const bases = new Set<string>();
  const subHits: string[] = [];

  const home = await fetchText(site);
  if (!home || !home.ok) {
    // even if home fails, still try subdomains
    if (probeSubdomains) await probeSubs(host, bases, subHits);
    return { slug, site, bases: [...bases], subHits, status: bases.size ? "geoserver-found" : (home ? "fetch-fail" : "fetch-fail") };
  }

  // direct geoserver refs in home
  for (const gu of extractGeoserverUrls(home.body)) { const b = geoserverBase(gu); if (b) bases.add(b); }

  // follow carto/urbanisme sublinks (1 hop, same+cross host)
  const urls = extractUrls(home.body, site);
  const cartoLinks = urls.filter((u) => CARTO_LINK_RE.test(u)).slice(0, 6);
  for (const link of cartoLinks) {
    const t = await fetchText(link);
    if (t && t.ok) for (const gu of extractGeoserverUrls(t.body)) { const b = geoserverBase(gu); if (b) bases.add(b); }
  }

  if (probeSubdomains) await probeSubs(host, bases, subHits);

  return { slug, site, bases: [...bases], subHits, status: bases.size ? "geoserver-found" : "none" };
}

/** Speculative GeoServer probing of GIS subdomains (GetCapabilities path). */
async function probeSubs(host: string, bases: Set<string>, subHits: string[]): Promise<void> {
  const bd = baseDomain(host);
  const root = bd.replace(/^[a-z0-9-]+\./i, "");
  const hosts = new Set<string>();
  for (const p of SUB_PREFIXES) { hosts.add(`${p}.${bd}`); if (root !== bd && root.includes(".")) hosts.add(`${p}.${root}`); }
  // Try several WFS capability paths: /geoserver/ows (GeoServer), bare /ows and
  // /wfs (mapserver/qgis-server or a vhosted geoserver.<domain> root).
  const CAP_PATHS = ["/geoserver/ows", "/ows", "/wfs", "/geoserver/wfs"];
  await Promise.all([...hosts].map(async (h) => {
    for (const p of CAP_PATHS) {
      const cap = `https://${h}${p}?service=WFS&version=2.0.0&request=GetCapabilities`;
      const r = await fetchText(cap, SUB_TIMEOUT);
      if (r && r.ok && /WFS_Capabilities|FeatureTypeList|wfs:WFS_Capabilities/i.test(r.body)) {
        const b = geoserverBase(cap); if (b) { bases.add(b); subHits.push(`https://${h}${p}`); }
        break; // first working path wins for this host
      }
    }
  }));
}

// ── GetCapabilities + DescribeFeatureType (phase 2) ───────────────────────────
export interface LayerInfo { name: string; title: string; zoneish: boolean }
export interface CapsInfo {
  base: string; reachable: boolean; layerCount: number;
  layers: LayerInfo[]; zoneLayers: LayerInfo[]; sampleLayers: string[]; error?: string;
}

export function parseFeatureTypes(xml: string): LayerInfo[] {
  const layers: LayerInfo[] = [];
  // tolerate namespaced tags (wfs:FeatureType, Name, Title)
  const ftRe = /<(?:\w+:)?FeatureType\b[\s\S]*?<\/(?:\w+:)?FeatureType>/gi;
  let m: RegExpExecArray | null;
  while ((m = ftRe.exec(xml))) {
    const block = m[0];
    const name = (block.match(/<(?:\w+:)?Name>\s*([^<]+?)\s*<\/(?:\w+:)?Name>/i)?.[1] ?? "").trim();
    const title = (block.match(/<(?:\w+:)?Title>\s*([^<]+?)\s*<\/(?:\w+:)?Title>/i)?.[1] ?? "").trim();
    const kw = (block.match(/<(?:\w+:)?Keywords?>[\s\S]*?<\/(?:\w+:)?Keywords?>/i)?.[0] ?? "");
    if (!name) continue;
    const hay = `${name} ${title} ${kw}`;
    layers.push({ name, title, zoneish: ZONE_LAYER_RE.test(hay) });
  }
  return layers;
}

async function getCapabilities(base: string): Promise<CapsInfo> {
  const url = `${base}?service=WFS&version=2.0.0&request=GetCapabilities`;
  const r = await fetchText(url, CAPS_TIMEOUT);
  if (!r || !r.ok || !/WFS_Capabilities|FeatureTypeList/i.test(r.body)) {
    // retry 1.1.0 (some old servers)
    const r2 = await fetchText(`${base}?service=WFS&version=1.1.0&request=GetCapabilities`, CAPS_TIMEOUT);
    if (!r2 || !r2.ok || !/WFS_Capabilities|FeatureTypeList/i.test(r2.body)) {
      return { base, reachable: false, layerCount: 0, layers: [], zoneLayers: [], sampleLayers: [], error: r ? `http/no-caps` : "unreachable" };
    }
    const layers2 = parseFeatureTypes(r2.body);
    return { base, reachable: true, layerCount: layers2.length, layers: layers2, zoneLayers: layers2.filter((l) => l.zoneish), sampleLayers: layers2.slice(0, 12).map((l) => l.name) };
  }
  const layers = parseFeatureTypes(r.body);
  return { base, reachable: true, layerCount: layers.length, layers, zoneLayers: layers.filter((l) => l.zoneish), sampleLayers: layers.slice(0, 12).map((l) => l.name) };
}

export async function describeFeatureType(base: string, layer: string): Promise<{ fields: { name: string; type: string }[]; raw: string } | null> {
  const url = `${base}?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layer)}`;
  const r = await fetchText(url, CAPS_TIMEOUT);
  if (!r || !r.ok) return null;
  const fields: { name: string; type: string }[] = [];
  const re = /<(?:\w+:)?element\b[^>]*\bname="([^"]+)"[^>]*\btype="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.body))) fields.push({ name: m[1]!, type: m[2]! });
  return { fields, raw: r.body.slice(0, 4000) };
}

async function pool<T, R>(items: T[], conc: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]!, i); } }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

interface DeepLayerCandidate {
  name: string;
  title: string;
  zoneish: boolean;
  affectationish: boolean;
  zoneFields: string[];
  muniFields: string[];
  fields: string[];
}

function classifyDeepLayer(layer: LayerInfo, fields: { name: string; type: string }[]): DeepLayerCandidate {
  const hay = `${layer.name} ${layer.title}`;
  const zoneFields = fields
    .map((f) => f.name)
    .filter((name) => ZONE_FIELD_RE.test(name) && !FIELD_EXCLUDE_RE.test(name));
  const muniFields = fields.map((f) => f.name).filter((name) => MUNI_FIELD_RE.test(name));
  return {
    name: layer.name,
    title: layer.title,
    zoneish: layer.zoneish,
    affectationish: AFFECT_LAYER_RE.test(hay),
    zoneFields,
    muniFields,
    fields: fields.map((f) => `${f.name}:${f.type}`),
  };
}

async function deepCapabilities(baseRaw: string, out: string | undefined, maxLayers: number): Promise<void> {
  const base = geoserverBase(baseRaw) ?? baseRaw;
  const caps = await getCapabilities(base);
  const candidates: DeepLayerCandidate[] = [];
  const rejected: DeepLayerCandidate[] = [];
  if (caps.reachable) {
    const layers = caps.layers.slice(0, maxLayers);
    let done = 0;
    for (const layer of layers) {
      const d = await describeFeatureType(base, layer.name);
      done++;
      if (!d) continue;
      const c = classifyDeepLayer(layer, d.fields);
      if (c.zoneFields.length > 0 && !c.affectationish) candidates.push(c);
      else if (c.zoneish || c.zoneFields.length > 0) rejected.push(c);
      if (done % 50 === 0) console.error(`[deep-caps] described ${done}/${layers.length}`);
      await sleep(120);
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    base,
    reachable: caps.reachable,
    layerCount: caps.layerCount,
    describedLayers: caps.reachable ? Math.min(caps.layers.length, maxLayers) : 0,
    candidateCount: candidates.length,
    candidates,
    rejectedZoneish: rejected,
    error: caps.error,
  };
  const path = out ?? resolve(HERE, "../../work/delegation-mass/zones-wfs-deep-caps.json");
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.error(`[deep-caps] candidates=${candidates.length} rejectedZoneish=${rejected.length} → ${path}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);

  // deep-caps mode: describe every layer in a known catalog and surface harvest candidates.
  const deepCaps = get("deep-caps");
  if (deepCaps) {
    await deepCapabilities(deepCaps, get("out"), Number(get("max-layers") ?? 5000));
    return;
  }

  // caps-only mode: just GetCapabilities + describe zone layers of an explicit base
  const capsOnly = get("caps-only");
  if (capsOnly) {
    const caps = await getCapabilities(geoserverBase(capsOnly) ?? capsOnly);
    console.error(JSON.stringify(caps, null, 2));
    for (const zl of caps.zoneLayers) {
      const d = await describeFeatureType(caps.base, zl.name);
      console.error(`\n=== DescribeFeatureType ${zl.name} ===`);
      console.error(d ? d.fields.map((f) => `${f.name}:${f.type}`).join("\n") : "(describe failed)");
    }
    return;
  }

  let slugs = (get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const file = get("slugs-file");
  if (file) slugs = readFileSync(file, "utf8").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("usage: --slugs a,b | --slugs-file path [--conc N] [--no-subdomains] [--out f]"); process.exit(2); }
  const conc = Number(get("conc") ?? 16);
  const probeSubdomains = !has("no-subdomains");

  console.error(`[discover] ${slugs.length} slugs conc=${conc} subdomains=${probeSubdomains}`);
  let done = 0;
  const hits = await pool(slugs, conc, async (slug) => {
    const r = await discoverSlug(slug, probeSubdomains);
    done++;
    if (r.bases.length) console.error(`[${done}/${slugs.length}] GEOSERVER ${slug} :: ${r.bases.join(" | ")}`);
    else if (done % 25 === 0) console.error(`  ...${done}/${slugs.length}`);
    return r;
  });

  // aggregate distinct bases → referencing slugs
  const byBase = new Map<string, { slugs: string[]; known: boolean }>();
  for (const h of hits) for (const b of h.bases) {
    const e = byBase.get(b) ?? { slugs: [], known: isKnownHost(b) };
    e.slugs.push(h.slug); byBase.set(b, e);
  }
  const newBases = [...byBase.entries()].filter(([, e]) => !e.known);
  console.error(`\n=== ${byBase.size} distinct GeoServer base(s); ${newBases.length} NEW (non-known) ===`);

  // phase 2: GetCapabilities + describe for each NEW base
  const capsResults: Array<CapsInfo & { slugs: string[]; describes: Record<string, string[]> }> = [];
  for (const [base, e] of newBases) {
    console.error(`\n[caps] ${base}  (refs: ${e.slugs.join(",")})`);
    const caps = await getCapabilities(base);
    const describes: Record<string, string[]> = {};
    if (caps.reachable) {
      console.error(`  reachable: ${caps.layerCount} layers; zoneish=${caps.zoneLayers.length} [${caps.zoneLayers.map((l) => l.name).join(", ")}]`);
      for (const zl of caps.zoneLayers.slice(0, 4)) {
        const d = await describeFeatureType(base, zl.name);
        if (d) { describes[zl.name] = d.fields.map((f) => `${f.name}:${f.type}`); console.error(`  fields[${zl.name}]: ${describes[zl.name]!.join(", ")}`); }
        await sleep(150);
      }
    } else console.error(`  unreachable: ${caps.error}`);
    capsResults.push({ ...caps, slugs: e.slugs, describes });
  }

  const byStatus: Record<string, number> = {};
  for (const h of hits) byStatus[h.status] = (byStatus[h.status] ?? 0) + 1;
  const report = {
    generatedAt: new Date().toISOString(), count: hits.length, byStatus,
    knownBases: [...byBase.entries()].filter(([, e]) => e.known).map(([b, e]) => ({ base: b, slugs: e.slugs })),
    newBases: capsResults,
    perSlugHits: hits.filter((h) => h.bases.length),
  };
  const out = get("out") ?? resolve(HERE, "../../work/delegation-mass/zones-wfs-discover.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== byStatus ${JSON.stringify(byStatus)}`);
  console.error(`rapport → ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
