/**
 * Enquête bornée sur un échantillon de municipalités sans candidat.
 *
 * Les seuls appels HTTP passent par `capturedFetch`. Le run utilise un store
 * mémoire et `store:false`: aucun octet n'est écrit sous raw/ ou capture/_runs/.
 * L'enquête suit uniquement les liens visibles dans la page officielle du
 * répertoire MAMH, au plus deux hops et huit URL par municipalité.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import {
  capturedFetch,
  capturedText,
  type CapturedFetchResult,
} from "../../packages/qc-sources/src/capture/capturedFetch.js";
import {
  CaptureRun,
  type CaptureObjectStore,
} from "../../packages/qc-sources/src/capture/capture-run.js";

const MAX_LOCAL_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_HTTP_BYTES = 5 * 1024 * 1024;
const SAMPLE_SIZE = 30;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const ACCEPT = "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8";
const HTML_MARKERS = /<(?:!doctype\s+html|html\b|head\b|body\b|script\b|main\b)/i;
const SOFT_404_MARKERS = /(?:page|page|document)\s+(?:not found|introuvable)|erreur\s+404|404\s*[-:]\s*(?:not found|introuvable)/i;
const PV_MARKERS = /proc[eè]s[- ]verbal|\bpv\b|s[eé]ance|conseil municipal|minutes|meeting minutes/i;
const NAV_MARKERS = /proc[eè]s|verbal|\bpv\b|s[eé]ance|conseil|vie[- ]d[eé]mocratique|d[eé]mocratie|publication|document|administration|minutes/i;
const MRC_MARKERS = /\bmrc\b|municipalit[eé]s?[- ]r[eé]gionale|r[eé]gion(?:ale)?\s+de\s+comt[eé]/i;
const NON_DOCUMENT_ASSET = /\.(?:mp3|mp4|m4a|wav|webm|mov|avi|mkv|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?)(?:$|[?#])/i;

interface SampleMunicipality {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

interface ListArtifact {
  readonly contract: string;
  readonly sources: Record<string, unknown>;
  readonly cardinality: Record<string, unknown>;
  readonly municipalities: readonly SampleMunicipality[];
}

interface DirectoryEntry {
  readonly website?: unknown;
  readonly name?: unknown;
  readonly mrc?: unknown;
}

interface DirectoryArtifact {
  readonly generatedAt: string;
  readonly stats: Record<string, unknown>;
  readonly entries: Record<string, DirectoryEntry>;
}

interface Anchor {
  readonly href: string;
  readonly text: string;
  readonly url: string;
  readonly score: number;
}

interface CaptureEvidence {
  readonly requested_url: string;
  readonly final_url: string | null;
  readonly status: number | null;
  readonly error: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly body_kind: "html" | "pdf" | "text" | "json" | "binary" | "no_body";
  readonly body_designates_pv: boolean;
  readonly body_designates_mrc: boolean;
  readonly link_count: number;
}

interface Observation {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
  readonly directory_website: string | null;
  readonly site_status: "directory_absent" | "reachable" | "http_error" | "transport_error";
  readonly category: "a_site_pv_pdf" | "b_portal_js_antibot" | "c_mrc_pv" | "d_no_site_identifiable" | "e_site_no_pv" | "f_autre";
  readonly cause: string;
  readonly homepage: CaptureEvidence | null;
  readonly followed_links: readonly CaptureEvidence[];
  readonly pv_evidence: readonly CaptureEvidence[];
  readonly transport_diagnosis: string | null;
}

class MemoryStore implements CaptureObjectStore {
  readonly objects = new Map<string, Uint8Array | string>();

  async head(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    this.objects.set(key, body);
  }
}

function readSmallJson<T>(path: string): T {
  const size = statSync(path).size;
  if (size > MAX_LOCAL_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hash32(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
}

function sample<T>(values: readonly T[], seed: string, count: number): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = hash32(`${seed}:${index}`) % (index + 1);
    [output[index], output[swap]] = [output[swap]!, output[index]!];
  }
  return output.slice(0, count);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&eacute;|&#233;/gi, "é")
    .replace(/&egrave;|&#232;/gi, "è")
    .replace(/&ecirc;|&#234;/gi, "ê")
    .replace(/&agrave;|&#224;/gi, "à")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyKind(bytes: Uint8Array | null): CaptureEvidence["body_kind"] {
  if (bytes === null || bytes.length === 0) return "no_body";
  const prefix = new TextDecoder("ascii", { fatal: false }).decode(bytes.subarray(0, 1024));
  const trimmed = prefix.trimStart();
  if (prefix.startsWith("%PDF-")) return "pdf";
  if (HTML_MARKERS.test(prefix)) return "html";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(prefix.slice(0, Math.min(prefix.length, 256)))) return "text";
  return "binary";
}

function htmlAnchors(body: string, baseUrl: string): Anchor[] {
  const anchors: Anchor[] = [];
  const expression = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(expression)) {
    const href = decodeHtml(match[1] ?? "").trim();
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const text = decodeHtml(match[2] ?? "");
    const haystack = `${href} ${text}`;
    const score = PV_MARKERS.test(haystack) ? 3 : NAV_MARKERS.test(haystack) ? 1 : 0;
    if (score > 0) anchors.push({ href, text, url, score });
  }
  return [...new Map(anchors.map((anchor) => [anchor.url, anchor])).values()]
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
}

function isNonDocumentAsset(anchor: Anchor): boolean {
  try {
    return NON_DOCUMENT_ASSET.test(new URL(anchor.url).pathname);
  } catch {
    return false;
  }
}

function lineError(result: CapturedFetchResult): string | null {
  return result.line.error ?? null;
}

function evidence(
  result: CapturedFetchResult,
  body: string | null,
  bodyAnchors: readonly Anchor[],
  context = "",
): CaptureEvidence {
  const bytes = result.bytes;
  const kind = bodyKind(bytes);
  const visible = body ?? "";
  const designatesPv = kind === "pdf"
    ? PV_MARKERS.test(context)
    : PV_MARKERS.test(visible);
  const designatesMrc = MRC_MARKERS.test(context) || MRC_MARKERS.test(visible) || MRC_MARKERS.test(result.line.final_url ?? "");
  return {
    requested_url: result.line.url,
    final_url: result.line.final_url,
    status: result.line.http_status,
    error: lineError(result),
    bytes: result.line.bytes,
    sha256: result.line.sha256,
    body_kind: kind,
    body_designates_pv: designatesPv,
    body_designates_mrc: designatesMrc,
    link_count: bodyAnchors.length,
  };
}

async function capture(
  run: CaptureRun,
  url: string,
  slug: string,
  attempt: number,
): Promise<{ result: CapturedFetchResult; body: string | null; anchors: Anchor[] }> {
  const result = await capturedFetch(
    url,
    { headers: { accept: ACCEPT, "accept-language": "fr-CA,fr;q=0.9,en;q=0.7" } },
    {
      run,
      source: "pv-discovery-survey",
      slugs: [slug],
      attempt,
      timeoutMs: 7_000,
      maxBytes: MAX_HTTP_BYTES,
      store: false,
      retainBody: true,
    },
  );
  if (!result.ok || result.bytes === null) return { result, body: null, anchors: [] };
  const kind = bodyKind(result.bytes);
  const body = kind === "html" || kind === "text" || kind === "json" ? capturedText(result) : null;
  return { result, body, anchors: body === null ? [] : htmlAnchors(body, result.line.final_url ?? url) };
}

function isTransportError(result: CapturedFetchResult): boolean {
  return result.response === null && result.line.error !== null;
}

async function diagnoseTransport(url: string, error: string): Promise<string> {
  const lower = error.toLowerCase();
  if (lower.includes("timeout")) return "timeout";
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "url_invalide";
  }
  try {
    await lookup(hostname);
    return "fetch_failed_dns_resolves";
  } catch (cause: unknown) {
    const code = cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "unknown";
    if (code === "ENOTFOUND") return "ENOTFOUND_dns";
    if (code === "EAI_AGAIN") return "DNS_EAI_AGAIN";
    return `dns_lookup_${code}`;
  }
}

function classify(
  directoryWebsite: string | null,
  homepage: CaptureEvidence | null,
  followed: readonly CaptureEvidence[],
  pvEvidence: readonly CaptureEvidence[],
  transportDiagnosis: string | null,
): { category: Observation["category"]; cause: string; siteStatus: Observation["site_status"]; diagnosis: string | null } {
  if (directoryWebsite === null) {
    return { category: "d_no_site_identifiable", cause: "aucune URL municipale dans le répertoire MAMH; aucune URL candidate dans le corpus", siteStatus: "directory_absent", diagnosis: null };
  }
  if (homepage === null) {
    return { category: "d_no_site_identifiable", cause: "URL MAMH absente du test", siteStatus: "directory_absent", diagnosis: null };
  }
  if (homepage.status === 403) {
    return { category: "b_portal_js_antibot", cause: "403 persistant malgré UA navigateur", siteStatus: "http_error", diagnosis: "HTTP_403_persiste_apres_essai_navigateur" };
  }
  if (homepage.status === null && homepage.error) {
    return { category: "d_no_site_identifiable", cause: "URL MAMH non joignable", siteStatus: "transport_error", diagnosis: transportDiagnosis ?? "transport_non_http" };
  }
  if (homepage.status !== null && homepage.status >= 400) {
    return { category: "d_no_site_identifiable", cause: `URL MAMH HTTP ${homepage.status}; octets non désignants`, siteStatus: "http_error", diagnosis: `HTTP_${homepage.status}` };
  }
  if (homepage.body_kind !== "html") {
    return { category: "f_autre", cause: `URL MAMH répond en ${homepage.body_kind}; pas une page municipale HTML`, siteStatus: "reachable", diagnosis: null };
  }
  if (pvEvidence.some((item) => item.body_kind === "pdf" && item.body_designates_pv && item.body_designates_mrc)) {
    return { category: "c_mrc_pv", cause: "PV accessible en PDF depuis un hôte/page MRC", siteStatus: "reachable", diagnosis: null };
  }
  if (pvEvidence.some((item) => item.body_kind === "pdf" && item.body_designates_pv)) {
    return { category: "a_site_pv_pdf", cause: "octets PDF (%PDF-) lus depuis un lien PV de la page municipale", siteStatus: "reachable", diagnosis: null };
  }
  if (homepage.body_designates_pv && followed.some((item) => item.body_kind === "html" && item.body_designates_pv)) {
    return { category: "b_portal_js_antibot", cause: "page PV HTML/portail désignée, sans PDF lisible dans la fenêtre d'enquête", siteStatus: "reachable", diagnosis: "html_pv_portal" };
  }
  const scriptHeavy = homepage.body_kind === "html" && followed.length === 0;
  if (scriptHeavy && !homepage.body_designates_pv) {
    return { category: "b_portal_js_antibot", cause: "page HTML dominée par scripts sans lien PV désignant une ressource", siteStatus: "reachable", diagnosis: "portal_js_suspect" };
  }
  if (followed.length > 0 || homepage.body_designates_pv) {
    return { category: "e_site_no_pv", cause: "site accessible et pages de navigation ouvertes, aucune ressource PV désignée par des octets", siteStatus: "reachable", diagnosis: null };
  }
  return { category: "e_site_no_pv", cause: "site municipal accessible; aucun lien/page PV trouvé dans les octets ouverts", siteStatus: "reachable", diagnosis: null };
}

async function inspectMunicipality(
  run: CaptureRun,
  municipality: SampleMunicipality,
  directoryWebsite: string | null,
): Promise<Observation> {
  if (directoryWebsite === null) {
    const result = {
      slug: municipality.slug,
      name: municipality.name,
      mrc: municipality.mrc,
      directory_website: null,
      site_status: "directory_absent" as const,
      category: "d_no_site_identifiable" as const,
      cause: "aucune URL municipale dans le répertoire MAMH; aucune URL candidate dans le corpus",
      homepage: null,
      followed_links: [],
      pv_evidence: [],
      transport_diagnosis: null,
    };
    return result;
  }

  let homepageCaptured = await capture(run, directoryWebsite, municipality.slug, 1);
  // Le premier essai emploie déjà un UA navigateur. Un second essai explicite
  // évite de transformer un 403 transitoire en absence.
  if (homepageCaptured.result.line.http_status === 403) {
    homepageCaptured = await capture(run, directoryWebsite, municipality.slug, 2);
  }
  const homepage = evidence(homepageCaptured.result, homepageCaptured.body, homepageCaptured.anchors);
  const transportDiagnosis = homepage.status === null && homepage.error !== null
    ? await diagnoseTransport(directoryWebsite, homepage.error)
    : null;
  // Garde-fou d’octets: les médias/assets statiques ne sont pas des preuves PV;
  // on ne les ouvre pas, et on ne déduit rien de leur extension.
  const links = homepageCaptured.anchors
    .filter((anchor) => anchor.url !== directoryWebsite && !isNonDocumentAsset(anchor))
    .slice(0, 3);
  const followed: CaptureEvidence[] = [];
  const pvEvidence: CaptureEvidence[] = [];
  for (let index = 0; index < links.length; index += 1) {
    const item = await capture(run, links[index]!.url, municipality.slug, index + 2);
    const itemEvidence = evidence(item.result, item.body, item.anchors, `${links[index]!.text} ${links[index]!.href}`);
    followed.push(itemEvidence);
    if (itemEvidence.body_kind === "pdf" && itemEvidence.body_designates_pv) pvEvidence.push(itemEvidence);
    if (item.body !== null) {
      for (const nested of item.anchors.filter((anchor) => anchor.score >= 3 && !isNonDocumentAsset(anchor)).slice(0, 1)) {
        const nestedItem = await capture(run, nested.url, municipality.slug, followed.length + 2);
        const nestedEvidence = evidence(nestedItem.result, nestedItem.body, nestedItem.anchors, `${nested.text} ${nested.href}`);
        followed.push(nestedEvidence);
        if (nestedEvidence.body_kind === "pdf" && nestedEvidence.body_designates_pv) pvEvidence.push(nestedEvidence);
      }
    }
    if (pvEvidence.length > 0) break;
  }
  const result = classify(directoryWebsite, homepage, followed, pvEvidence, transportDiagnosis);
  return {
    slug: municipality.slug,
    name: municipality.name,
    mrc: municipality.mrc,
    directory_website: directoryWebsite,
    site_status: result.siteStatus,
    category: result.category,
    cause: result.cause,
    homepage,
    followed_links: followed,
    pv_evidence: pvEvidence,
    transport_diagnosis: result.diagnosis,
  };
}

async function main(): Promise<void> {
  const listPath = arg("list") ?? "work/coverage/pv-decouverte-municipalites-vierges-20260730T005234Z.json";
  const out = arg("out");
  if (!out) throw new Error("--out=... est requis");
  const seed = arg("seed") ?? "pv-decouverte-20260730T005234Z";
  const list = readSmallJson<ListArtifact>(listPath);
  const directory = readSmallJson<DirectoryArtifact>("packages/qc-sources/src/geo/qc-municipal-directory.json");
  if (list.municipalities.length < SAMPLE_SIZE) throw new Error("liste trop courte pour l'échantillon");
  const selected = sample(list.municipalities, seed, SAMPLE_SIZE);
  const memoryStore = new MemoryStore();
  const run = new CaptureRun({
    runId: `pv-discovery-survey-${seed.replace(/[^a-zA-Z0-9-]/g, "-")}`,
    lane: "pv",
    store: memoryStore,
    userAgent: BROWSER_UA,
    execution: "local",
    flushEvery: 1,
    echo: null,
  });
  const observations: Observation[] = [];
  for (let offset = 0; offset < selected.length; offset += 5) {
    const batch = selected.slice(offset, offset + 5);
    const batchObservations = await Promise.all(batch.map((municipality) => {
      const entry = directory.entries[municipality.slug];
      const website = typeof entry?.website === "string" && entry.website.trim() ? entry.website.trim() : null;
      return inspectMunicipality(run, municipality, website);
    }));
    observations.push(...batchObservations);
  }
  await run.finish(0);

  const counts = Object.fromEntries(
    ["a_site_pv_pdf", "b_portal_js_antibot", "c_mrc_pv", "d_no_site_identifiable", "e_site_no_pv", "f_autre"]
      .map((category) => [category, observations.filter((observation) => observation.category === category).length]),
  );
  const countOf = (categories: readonly Observation["category"][]) => categories.reduce(
    (total, category) => total + (counts[category] ?? 0),
    0,
  );
  const body = {
    contract: "pv-decouverte-enquete-echantillon/v1",
    generated_at: new Date().toISOString(),
    read_only_data_side: true,
    list_artifact: listPath,
    directory_source: {
      path: "packages/qc-sources/src/geo/qc-municipal-directory.json",
      generated_at: directory.generatedAt,
      stats: directory.stats,
    },
    capture: {
      chokepoint: "packages/qc-sources/src/capture/capturedFetch.ts",
      run_id: run.runId,
      store: "memory",
      store_false: true,
      raw_writes: 0,
      capture_run_writes: 0,
      max_http_bytes: MAX_HTTP_BYTES,
      browser_user_agent: true,
      no_naked_fetch: true,
    },
    sample: {
      frame_size: list.municipalities.length,
      sample_size: observations.length,
      random_seed: seed,
      selection_method: "Fisher-Yates pseudo-aléatoire dérivé de SHA-256; jamais les 30 premières lignes",
      slugs: selected.map((municipality) => municipality.slug),
    },
    partition: {
      categories: counts,
      sum: Object.values(counts).reduce((total, count) => total + count, 0),
      closed: Object.keys(counts).length === 6 && Object.values(counts).reduce((total, count) => total + count, 0) === observations.length,
      labels: {
        a_site_pv_pdf: "site municipal existant avec PV en PDF",
        b_portal_js_antibot: "site existant mais portail JS/SPA/anti-bot ou page PV non lisible comme ressource",
        c_mrc_pv: "PV accessible par une ressource MRC",
        d_no_site_identifiable: "aucun site municipal identifiable dans le répertoire et les octets testés",
        e_site_no_pv: "site existant sans PV en ligne dans la fenêtre d'enquête",
        f_autre: "autre cause explicitement documentée par observation.cause",
      },
    },
    reachability: {
      site_reachable: {
        categories: ["a_site_pv_pdf", "b_portal_js_antibot", "c_mrc_pv", "e_site_no_pv"],
        count: countOf(["a_site_pv_pdf", "b_portal_js_antibot", "c_mrc_pv", "e_site_no_pv"]),
        denominator: observations.length,
      },
      pv_proven_by_opened_bytes: {
        categories: ["a_site_pv_pdf", "c_mrc_pv"],
        count: countOf(["a_site_pv_pdf", "c_mrc_pv"]),
        denominator: observations.length,
      },
      pv_potentially_reachable_with_portal_follow_up: {
        categories: ["a_site_pv_pdf", "b_portal_js_antibot", "c_mrc_pv"],
        count: countOf(["a_site_pv_pdf", "b_portal_js_antibot", "c_mrc_pv"]),
        denominator: observations.length,
      },
    },
    observations,
    extrapolation: {
      applies_to: list.municipalities.length,
      statement: "Les proportions ne sont qu'une extrapolation descriptive de n=30 tirées au hasard; elle peut être fausse si l'échantillon ne représente pas les MRC, tailles, hébergeurs ou sites absents.",
      reachable_definition: "a_site_pv_pdf + b_portal_js_antibot + c_mrc_pv + e_site_no_pv",
    },
  };
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out, sample: observations.length, counts }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
