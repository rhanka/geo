/**
 * Cadrage ciblé de la succession GoAzimut, sans aucun dépôt servi.
 *
 * Lit les 186 URL déclaratives immo, capture au chokepoint le fournisseur et
 * les sites officiels d'un échantillon inter-MRC de dix municipalités, puis
 * suit au plus quatre liens SIG plausibles par municipalité. Les corps sont
 * lus pour classifier des octets (jamais le seul HTTP/content-type).
 *
 * Usage (racine du dépôt) :
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 * npx tsx acquisition/src/_goazimut-successeur-probe.ts --stamp 20260729T000000Z
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { capturedFetch, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import { capturedRobotsFetch } from "./capture-worklist-run.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANDIDATES = "work/coverage/immo-url-candidates-20260729T044827Z.json";
const DIRECTORY = "packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json";
const MUNICIPALITIES = "packages/geo-sources-americas/src/ca-qc/municipalities/municipalities.qc.json";
// 26 = 15 pages d'amorce + deux viewers GOnet + au plus un portail par ville : très sous le
// cliquet 65, sans rouvrir une mesure exhaustive déjà menée ailleurs.
const MAX_TOTAL_TARGETS = 26;
const MAX_LINKS_PER_CITY = 1;
const MAX_BODY_BYTES = 1_048_576;

const SAMPLE_SLUGS = [
  "albanel",
  "baie-saint-paul",
  "chandler",
  "bromont",
  "saint-thomas",
  "papineauville",
  "saint-pascal",
  "sainte-anne-des-monts",
  "saint-prosper",
  "waterloo",
] as const;

type Candidate = { city_slug: string; url: string };
type DirectoryEntry = { slug: string; name: string; mamhCode: string; website: string | null };
type Municipality = { slug: string; mrc: string | null };
type Target = { kind: "fournisseur" | "site-municipal" | "lien-sig"; slug: string | null; url: string; parent_url: string | null };
type ByteClass = "html" | "json-geometry" | "json-non-geometry" | "text" | "binary" | "no-bytes";
type Platform = "arcgis" | "geocentralis" | "jmap" | "igo" | "gonet" | "wordpress" | "none";

interface Probe {
  target: Target;
  manifest: { run_id: string; line_index: number; storage_key: string | null; sha256: string | null };
  http_status: number | null;
  redirect_chain: readonly string[];
  response_url: string | null;
  bytes: number | null;
  byte_class: ByteClass;
  platforms: readonly Platform[];
  octet_evidence: readonly string[];
  relevant_links: readonly { url: string; text: string; score: number }[];
  error: string | null;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item === undefined ? null : item.slice(prefix.length);
}

function withinRepo(path: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return resolved;
}

function stamp(): string {
  const value = option("stamp");
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) throw new Error("--stamp YYYYMMDDTHHMMSSZ requis");
  return value;
}

function decode(bytes: Uint8Array | null): string {
  if (bytes === null) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function byteClass(bytes: Uint8Array | null): ByteClass {
  if (bytes === null) return "no-bytes";
  const text = decode(bytes).trim();
  if (/^<!doctype html|^<html[\s>]|<head[\s>]|<body[\s>]/i.test(text)) return "html";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as { type?: unknown; features?: unknown };
      if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features) && parsed.features.some((f) => f?.geometry !== null && typeof f?.geometry === "object")) return "json-geometry";
      return "json-non-geometry";
    } catch {
      return "text";
    }
  }
  const printable = [...bytes.subarray(0, Math.min(bytes.length, 4096))].filter((byte) => byte >= 9 && byte <= 126).length;
  return printable / Math.max(1, Math.min(bytes.length, 4096)) > 0.85 ? "text" : "binary";
}

function platforms(text: string): Platform[] {
  const out: Platform[] = [];
  if (/arcgis|mapserver|featureserver|esri/i.test(text)) out.push("arcgis");
  if (/geocentralis/i.test(text)) out.push("geocentralis");
  if (/\bjmap\b|kheops/i.test(text)) out.push("jmap");
  if (/\bigo\b|igo2/i.test(text)) out.push("igo");
  if (/goazimut|gonet|pg solutions/i.test(text)) out.push("gonet");
  if (/wp-content|wp-includes|wordpress/i.test(text)) out.push("wordpress");
  return out.length === 0 ? ["none"] : out;
}

function evidence(text: string): string[] {
  const terms = /goazimut|gonet|pg solutions|geocentralis|arcgis|mapserver|featureserver|jmap|kheops|\bigo\b|wordpress|wp-content/gi;
  const found = new Set<string>();
  for (const match of text.matchAll(terms)) {
    const start = Math.max(0, (match.index ?? 0) - 80);
    const end = Math.min(text.length, (match.index ?? 0) + 180);
    found.add(text.slice(start, end).replace(/\s+/g, " ").trim());
    if (found.size >= 8) break;
  }
  return [...found];
}

function links(body: string, base: string): { url: string; text: string; score: number }[] {
  const out = new Map<string, { url: string; text: string; score: number }>();
  for (const match of body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const raw = match[1]!.trim();
    let url: URL;
    try { url = new URL(raw, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const text = match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const searchable = `${text} ${url.href}`;
    let score = 0;
    if (/carto|carte|sig|g[ée]omati|zonage|urbanisme|donn[ée]es|map|arcgis|jmap|igo|geocentralis/i.test(searchable)) score += 10;
    if (/arcgis|jmap|igo|geocentralis|carto|map/i.test(url.hostname + url.pathname)) score += 5;
    if (/\.pdf(?:$|\?)/i.test(url.href)) score -= 8;
    if (score <= 0) continue;
    const current = out.get(url.href);
    if (!current || score > current.score) out.set(url.href, { url: url.href, text, score });
  }
  return [...out.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, MAX_LINKS_PER_CITY);
}

async function capture(target: Target, run: ReturnType<typeof openCaptureRun>, robots: RobotsCache): Promise<Probe> {
  const result = await capturedFetch(target.url, {
    method: "GET",
    headers: { "user-agent": run.userAgent, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
  }, {
    run,
    source: target.kind === "fournisseur" ? "goazimut-successor-supplier" : "goazimut-successor-municipal",
    slugs: target.slug === null ? [] : [target.slug],
    robots,
    retainBody: true,
    maxBytes: MAX_BODY_BYTES,
    timeoutMs: null,
  });
  const body = decode(result.bytes);
  const finalUrl = result.response?.url ?? null;
  return {
    target,
    manifest: { run_id: result.line.run_id, line_index: run.manifestLines().indexOf(result.line), storage_key: result.line.storage_key, sha256: result.line.sha256 },
    http_status: result.line.http_status,
    redirect_chain: result.line.redirect_chain,
    response_url: finalUrl,
    bytes: result.line.bytes,
    byte_class: byteClass(result.bytes),
    platforms: platforms(body),
    octet_evidence: evidence(body),
    relevant_links: finalUrl === null ? [] : links(body, finalUrl),
    error: result.line.error,
  };
}

function currentPortal(probes: readonly Probe[]): Probe | undefined {
  return probes.find((probe) => {
    if (probe.http_status !== 200 || probe.byte_class === "no-bytes") return false;
    if (/\/GOnet6\//i.test(probe.response_url ?? "")) return true;
    return probe.platforms.some((p) => p === "arcgis" || p === "geocentralis" || p === "jmap" || p === "igo");
  });
}

function renderMarkdown(report: { generated_at: string; cities: readonly { city_slug: string }[]; sample: readonly { city_slug: string; name: string; mrc: string | null; official_site: string | null; portals: readonly Probe[] }[]; supplier: readonly Probe[] }): string {
  const identified = report.sample.filter((row) => currentPortal(row.portals) !== undefined).length;
  const lines = [
    "# GoAzimut — enquête successeur",
    "",
    `Généré le ${report.generated_at}. Portée : 186 URL / ${report.cities.length} municipalités, échantillon inter-MRC de 10.`,
    "",
    "Les captures sont toutes passées par le chokepoint, avec UA navigateur. Les classifications ouvrent les octets ; un HTTP 200 seul n'est jamais une preuve de géométrie.",
    "",
    "## Fournisseur",
    "",
    ...report.supplier.map((probe) => `- ${probe.target.url} → ${probe.response_url ?? "sans réponse"}; octets=${probe.byte_class}; plateformes=${probe.platforms.join(", ")}; preuve=${probe.octet_evidence[0] ?? probe.error ?? "aucune"}`),
    "",
    "## Échantillon SIG actuel",
    "",
    `Portail SIG actuel identifié par des octets : ${identified}/10. « Non identifié » signifie seulement que cette passe bornée n'a pas trouvé de portail, pas qu'il n'existe pas.`,
    "",
    "| Municipalité | MRC | URL officielle | Portail / forme observée |",
    "|---|---|---|---|",
    ...report.sample.map((row) => {
      const portal = currentPortal(row.portals);
      return `| ${row.name} | ${row.mrc ?? "—"} | ${row.official_site ?? "—"} | ${portal ? `${portal.response_url ?? portal.target.url} (${portal.byte_class}; ${portal.platforms.join(", ")})` : "non identifié dans la passe"} |`;
    }),
    "",
    "## Décision",
    "",
    "Aucun re-stampage, aucune écriture servie. Les anciennes URL ArcGIS GoAzimut restent des pistes mortes ; la relance doit être par municipalité/MRC, uniquement là où un portail actuel fournit des octets exploitables. Wayback, s'il était utilisé, serait explicitement une preuve historique d'une autre nature, pas la preuve de ce qui est servi aujourd'hui.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const runStamp = stamp();
  const jsonPath = withinRepo(`work/coverage/goazimut-successeur-${runStamp}.json`);
  const mdPath = withinRepo(`work/coverage/goazimut-successeur-${runStamp}.md`);
  if (existsSync(jsonPath) || existsSync(mdPath)) throw new Error("refus d'écraser un rapport existant");

  const candidates = JSON.parse(readFileSync(withinRepo(CANDIDATES), "utf8")) as { urls: Candidate[] };
  const all = candidates.urls.filter((row) => new URL(row.url).hostname.toLowerCase() === "www.goazimut.com");
  const cities = [...new Map(all.map((row) => [row.city_slug, row])).values()].sort((a, b) => a.city_slug.localeCompare(b.city_slug, "fr"));
  if (all.length !== 186 || cities.length !== 186) throw new Error(`univers GoAzimut inattendu: url=${all.length} villes=${cities.length}`);

  const directory = JSON.parse(readFileSync(withinRepo(DIRECTORY), "utf8")) as { entries: Record<string, DirectoryEntry> };
  const municipalities = JSON.parse(readFileSync(withinRepo(MUNICIPALITIES), "utf8")) as Municipality[];
  const municipalityBySlug = new Map(municipalities.map((row) => [row.slug, row]));
  const samples = SAMPLE_SLUGS.map((slug) => {
    const entry = directory.entries[slug];
    if (!entry?.website) throw new Error(`site officiel absent: ${slug}`);
    return { slug, name: entry.name, mrc: municipalityBySlug.get(slug)?.mrc ?? null, official_site: entry.website };
  });

  const run = openCaptureRun({ lane: "zones", runId: `zones-${runStamp}-goazimut-successor`, userAgent: CAPTURE_USER_AGENT, flushEvery: 1 });
  const robots = new RobotsCache({ userAgent: run.userAgent, fetchImpl: capturedRobotsFetch(run), log: (message) => run.log(message) });
  let exitCode = 0;
  try {
    const supplierTargets: Target[] = [
      { kind: "fournisseur", slug: null, url: "https://www.goazimut.com/", parent_url: null },
      { kind: "fournisseur", slug: null, url: "https://www2.goazimut.com/", parent_url: null },
      { kind: "fournisseur", slug: null, url: "https://www2.goazimut.com/gonet/", parent_url: "https://www2.goazimut.com/" },
      { kind: "fournisseur", slug: null, url: "https://www2.goazimut.com/2025/01/27/gonet-continuera-de-fonctionner-normalement/", parent_url: "https://www2.goazimut.com/" },
      { kind: "fournisseur", slug: null, url: "https://www2.goazimut.com/2024/10/31/pg-solutions-inc-acquiert-groupe-de-geomatique-azimut-inc/", parent_url: "https://www2.goazimut.com/" },
    ];
    const supplier = [] as Probe[];
    for (const target of supplierTargets) supplier.push(await capture(target, run, robots));

    const homes = [] as Probe[];
    for (const row of samples) homes.push(await capture({ kind: "site-municipal", slug: row.slug, url: row.official_site, parent_url: null }, run, robots));

    const knownCurrentViewers: Target[] = [
      { kind: "lien-sig", slug: "albanel", url: "https://www.goazimut.com/GOnet6/index.html?m=92030&pl=1", parent_url: "https://albanel.ca/" },
      { kind: "lien-sig", slug: "sainte-anne-des-monts", url: "https://www.goazimut.com/GOnet6/index.html?m=04037&pl=1", parent_url: "https://villesadm.net/urbanisme-inspection-en-batiment/" },
    ];
    const remaining = MAX_TOTAL_TARGETS - supplier.length - homes.length - knownCurrentViewers.length;
    const followups = homes.flatMap((home) => home.relevant_links.map((link) => ({ kind: "lien-sig" as const, slug: home.target.slug, url: link.url, parent_url: home.target.url }))).slice(0, remaining);
    const portalProbes = [] as Probe[];
    for (const target of knownCurrentViewers) portalProbes.push(await capture(target, run, robots));
    for (const target of followups) portalProbes.push(await capture(target, run, robots));

    const report = {
      contract: "goazimut-successeur-enquete/v1",
      generated_at: new Date().toISOString(),
      constraints: {
        served_writes: false,
        restampage: false,
        capture_chokepoint: true,
        user_agent: run.userAgent,
        maximum_targets: MAX_TOTAL_TARGETS,
        executed_targets: supplier.length + homes.length + portalProbes.length,
        source_candidate_file: CANDIDATES,
      },
      scope: { goazimut_urls: all.length, municipalities: cities.length, cities: cities.map((row) => ({ city_slug: row.city_slug, old_url: row.url })) },
      supplier,
      prior_committed_evidence: {
        path: "work/coverage/served-zonage-proof-url-survival-20260728T120011Z.json",
        fact: "149 rows whose served_url contains goazimut are classified 404 from captured octets; this report does not re-measure them.",
      },
      sample: samples.map((row) => ({
        city_slug: row.slug,
        name: row.name,
        mrc: row.mrc,
        official_site: row.official_site,
        home: homes.find((probe) => probe.target.slug === row.slug) ?? null,
        portals: portalProbes.filter((probe) => probe.target.slug === row.slug),
      })),
      run: { run_id: run.runId, manifest_key: run.keys.manifest },
      interpretation_rule: "A portal may be identified from HTML/JSON octets and its platform signatures. Geometry is identified only by a JSON FeatureCollection that actually contains geometries; neither HTTP 200 nor content-type alone is geometry evidence.",
    };
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    writeFileSync(mdPath, renderMarkdown({
      generated_at: report.generated_at,
      cities: report.scope.cities,
      sample: report.sample,
      supplier: report.supplier,
    }), { flag: "wx" });
    run.log(`[goazimut-successor] report=${jsonPath} targets=${report.constraints.executed_targets}`);
  } catch (error) {
    exitCode = 1;
    run.log(`[goazimut-successor] fatal ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await run.finish(exitCode);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
