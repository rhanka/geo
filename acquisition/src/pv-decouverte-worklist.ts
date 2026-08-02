/**
 * Découverte PV strictement en lecture web pour un court lot de municipalités
 * réellement vierges. Ne lit que les pages HTML/XML et endpoints JSON: un
 * Content-Type documentaire est refusé avant lecture. Les URLs candidates sont
 * donc des entrées durables pour la capture cluster, jamais une capture locale.
 *
 * Entrées:
 *   --input=work/coverage/pv-decouverte-municipalites-vierges-....json
 *   --slugs=slug-a,slug-b  (1..8 slugs de l'univers d'entrée)
 *   --out=work/coverage/pv-decouverte-worklist-....json
 *   [--prior=work/coverage/pv-decouverte-worklist-....json]
 *
 * Les voies sont volontairement bornées et observables:
 * - page officielle MAMH + pages de navigation « PV »;
 * - endpoint JSON Municipalités-du-Québec, décrit par pv-mdq-run;
 * - flux RSS/blog Wix, décrit par pv-wix-run;
 * - une page MRC seulement lorsqu'elle est explicitement liée par le site
 *   municipal; elle doit elle-même nommer la municipalité dans le lien PV;
 * - une vidéo YouTube explicitement liée par le site municipal, seulement si sa
 *   description contient une URL documentaire et désigne la municipalité/PV.
 *
 * Aucune URL n'est devinée: toute candidate garde le texte ou le champ JSON
 * exact qui la désigne, ainsi que le rattachement à la municipalité.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyPvObservableDocument } from "./lib/pv-observable-classification.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MUNICIPAL_DIRECTORY_PATH = "packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json";
const MAX_LOCAL_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
// Un lot fini en une fenêtre de worker et s'écrit dans un artefact immuable;
// 8 reste strictement sous le plafond opérationnel de 25 municipalités et
// borne aussi un portail dont un seul endpoint peut lister beaucoup de fichiers.
const MAX_LOT_SIZE = 8;
const MAX_NAVIGATION_PAGES = 3;
const MAX_WIX_POSTS = 12;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const RESEARCH_UA = "sentropic-geo-pv-discovery/1.0 (+https://github.com/rhanka/radar-immobilier)";
const ACCEPT = "text/html,application/xhtml+xml,application/xml,text/xml,application/json,text/plain;q=0.8,*/*;q=0.1";
const PV_TEXT = /proc[eè]s[-\s]?verbaux?|\bp\.?\s?v\.?\b|s[eé]ances?\s+(?:ordinaires?|extraordinaires?|du\s+conseil)|meeting\s+minutes|\bminutes\b/i;
const NON_PV_TEXT = /avis\s+public|avis\s+de\s+motion|ordre\s+du\s+jour|\bodj\b|agenda|budget|r[eè]glement|politique|formulaire/i;
const NAV_TEXT = /proc[eè]s|verbaux?|\bp\.?\s?v\.?\b|s[eé]ance|conseil|vie[-\s]?d[eé]mocratique|d[eé]mocratie|documents?/i;
const MRC_TEXT = /\bmrc\b|municipalit[eé]\s+r[eé]gionale|r[eé]gion(?:ale)?\s+de\s+comt[eé]/i;
const DOCUMENT_URL = /\.(?:pdf|docx?|xlsx?|pptx?)(?:$|[?#])/i;
const WIX_PDF = /https?:\/\/[a-z0-9.-]+\.(?:usrfiles|wixstatic)\.com\/ugd\/[^"'\\\s<>)]+\.pdf/gi;
const YOUTUBE_URL = /(?:youtube\.com\/(?:watch\?v=|playlist\?list=)|youtu\.be\/)[^"'\s<>)]+/i;

interface Municipality {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

interface TargetArtifact {
  readonly contract: "pv-decouverte-municipalites-vierges/v1";
  readonly municipalities: readonly Municipality[];
  readonly cardinality: { readonly missing_without_candidate: number };
}

interface DirectoryArtifact {
  readonly entries: Readonly<Record<string, { readonly website?: unknown }>>;
}

type SourceKind =
  | "municipal-site-anchor"
  | "municipalites-du-quebec-json"
  | "wix-blog-feed"
  | "mrc-portal-anchor"
  | "youtube-description";

interface Candidate {
  readonly slug: string;
  readonly mrc: string | null;
  readonly candidate_url: string;
  readonly source_kind: SourceKind;
  readonly evidence: string;
  readonly retrieved_at: string;
}

interface Observation {
  readonly slug: string;
  readonly mrc: string | null;
  readonly status: "candidate" | "no_candidate" | "indeterminate";
  readonly notes: readonly string[];
}

interface PriorWorklist {
  readonly contract: "pv-decouverte-worklist/v1";
  readonly candidates: readonly Candidate[];
  readonly observations: readonly Observation[];
}

interface Anchor {
  readonly href: string;
  readonly text: string;
  readonly url: string;
}

interface TextResponse {
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly status: number | null;
  readonly text: string | null;
  readonly retrievedAt: string;
  readonly error: string | null;
}

interface ScanNode {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly path?: unknown;
  readonly items?: unknown;
}

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function insideRepo(path: string, name: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return absolute;
}

function readSmallJson<T>(path: string): T {
  const size = statSync(path).size;
  if (size > MAX_LOCAL_BYTES) throw new Error(`${path}: ${size} octets > plafond local`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&eacute;|&#233;/gi, "é")
    .replace(/&egrave;|&#232;/gi, "è")
    .replace(/&ecirc;|&#234;/gi, "ê")
    .replace(/&agrave;|&#224;/gi, "à")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function anchors(html: string, baseUrl: string): Anchor[] {
  const found = new Map<string, Anchor>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1] ?? "").trim();
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl).href;
      found.set(url, { href, text: decodeHtml(match[2] ?? ""), url });
    } catch {
      // href non URL: il ne peut pas devenir une candidate.
    }
  }
  return [...found.values()];
}

function safeTextContentType(contentType: string | null): boolean {
  if (contentType === null || !contentType.trim()) return false;
  const lower = contentType.toLowerCase();
  return lower.startsWith("text/") || lower.includes("application/json") || lower.includes("application/xml") || lower.includes("application/rss+xml");
}

async function bodyText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_TEXT_BYTES) {
    await response.body?.cancel();
    throw new Error(`texte > plafond (${declared} octets)`);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      length += next.value.length;
      if (length > MAX_TEXT_BYTES) throw new Error(`texte > plafond (${MAX_TEXT_BYTES} octets)`);
      chunks.push(next.value);
    }
  } finally {
    if (length > MAX_TEXT_BYTES) await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function diagnoseTransport(url: string, error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND/i.test(message)) return "ENOTFOUND";
  if (/ETIMEDOUT|timeout/i.test(message)) return "timeout";
  try {
    await lookup(new URL(url).hostname);
    return "fetch_failed_dns_resolves";
  } catch (cause: unknown) {
    const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "unknown";
    return `dns_${code}`;
  }
}

async function fetchText(url: string): Promise<TextResponse> {
  const request = async (userAgent: string): Promise<TextResponse> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const retrievedAt = new Date().toISOString();
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": userAgent, Accept: ACCEPT, "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.7" },
      });
      const finalUrl = response.url || url;
      if (!safeTextContentType(response.headers.get("content-type"))) {
        await response.body?.cancel();
        return { requestedUrl: url, finalUrl, status: response.status, text: null, retrievedAt, error: "refus_content_type_non_texte" };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { requestedUrl: url, finalUrl, status: response.status, text: null, retrievedAt, error: `HTTP_${response.status}` };
      }
      return { requestedUrl: url, finalUrl, status: response.status, text: await bodyText(response), retrievedAt, error: null };
    } catch (error) {
      return { requestedUrl: url, finalUrl: null, status: null, text: null, retrievedAt, error: await diagnoseTransport(url, error) };
    } finally {
      clearTimeout(timeout);
    }
  };
  const first = await request(RESEARCH_UA);
  // Un 403 ne conclut jamais à une absence: essai explicite avec UA navigateur.
  return first.status === 403 ? request(BROWSER_UA) : first;
}

function candidateFromAnchor(
  municipality: Municipality,
  anchor: Anchor,
  sourceKind: "municipal-site-anchor" | "mrc-portal-anchor",
  sourcePage: string,
  officialWebsite: string,
  retrievedAt: string,
): Candidate | null {
  if (!DOCUMENT_URL.test(anchor.url)) return null;
  const classification = classifyPvObservableDocument({
    url: anchor.url,
    titles: new Set([anchor.text]),
    selfReference: false,
  });
  if (classification.class !== "pv_probable") return null;
  return {
    slug: municipality.slug,
    mrc: municipality.mrc,
    candidate_url: anchor.url,
    source_kind: sourceKind,
    evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; page lue: ${sourcePage}; ancre verbatim: «${anchor.text}» (href: ${anchor.href}).`,
    retrieved_at: retrievedAt,
  };
}

function mdqAliases(slug: string, officialWebsite: string): string[] {
  const aliases = new Set<string>();
  try {
    const firstPath = new URL(officialWebsite).pathname.split("/").filter(Boolean)[0];
    if (firstPath) aliases.add(firstPath);
  } catch {
    // URL annuaire invalide: le caller s'en tiendra aux alias de slug vérifiés par endpoint.
  }
  const base = slug.split("--")[0] ?? slug;
  for (const value of [slug, base]) {
    aliases.add(value);
    if (value.startsWith("saint-")) aliases.add(`st-${value.slice("saint-".length)}`);
    if (value.startsWith("sainte-")) aliases.add(`ste-${value.slice("sainte-".length)}`);
  }
  return [...aliases];
}

function flattenMdqPdfs(node: ScanNode, found: Array<{ name: string; path: string }> = []): Array<{ name: string; path: string }> {
  if (node.type === "file" && typeof node.path === "string" && /\.pdf$/i.test(node.path)) {
    found.push({ name: typeof node.name === "string" ? node.name : node.path, path: node.path });
  }
  if (Array.isArray(node.items)) {
    for (const child of node.items) {
      if (child && typeof child === "object" && !Array.isArray(child)) flattenMdqPdfs(child as ScanNode, found);
    }
  }
  return found;
}

async function discoverMdq(municipality: Municipality, officialWebsite: string): Promise<{ candidates: Candidate[]; note: string }> {
  let official: URL;
  try {
    official = new URL(officialWebsite);
  } catch {
    return { candidates: [], note: "site officiel URL invalide" };
  }
  if (!/municipalites-du-quebec\.(?:ca|com)$/i.test(official.hostname.replace(/^www\./i, ""))) return { candidates: [], note: "hors portail MDQ" };
  const hosts = [...new Set([official.origin, "https://municipalites-du-quebec.ca", "https://municipalites-du-quebec.com"])];
  const candidates: Candidate[] = [];
  let sawHttp = false;
  for (const host of hosts) {
    for (const alias of mdqAliases(municipality.slug, officialWebsite)) {
      const endpoint = `${host}/${alias}/scan.procesverbaux.inc.php`;
      const response = await fetchText(endpoint);
      sawHttp ||= response.status !== null;
      if (response.status !== 200 || response.text === null) continue;
      let root: ScanNode;
      try {
        root = JSON.parse(response.text) as ScanNode;
      } catch {
        continue;
      }
      for (const file of flattenMdqPdfs(root)) {
        const candidateUrl = `${host}/${alias}/${encodeURI(file.path)}`;
        const classification = classifyPvObservableDocument({
          url: candidateUrl,
          titles: new Set([file.name]),
          selfReference: false,
        });
        if (classification.class !== "pv_probable") continue;
        candidates.push({
          slug: municipality.slug,
          mrc: municipality.mrc,
          candidate_url: candidateUrl,
          source_kind: "municipalites-du-quebec-json",
          evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; endpoint JSON lu: ${response.finalUrl ?? endpoint}; nom de fichier verbatim: «${file.name}»; chemin JSON verbatim: «${file.path}».`,
          retrieved_at: response.retrievedAt,
        });
      }
      return { candidates, note: candidates.length ? `MDQ ${candidates.length} candidat(s)` : "endpoint MDQ sans PV probable" };
    }
  }
  return { candidates: [], note: sawHttp ? "endpoint MDQ sans JSON valide" : "endpoint MDQ indéterminé" };
}

function wixFeedItems(xml: string): Array<{ title: string; link: string }> {
  const items: Array<{ title: string; link: string }> = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? "";
    const title = decodeHtml(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = decodeHtml(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    if (title && /^https?:/i.test(link)) items.push({ title, link });
  }
  return items;
}

function wixPdfUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.replace(/\\\//g, "/").replace(/&amp;/g, "&").matchAll(WIX_PDF)) urls.add(match[0]);
  return [...urls];
}

async function discoverWix(municipality: Municipality, officialWebsite: string, homeText: string | null): Promise<{ candidates: Candidate[]; note: string }> {
  if (homeText === null || !/(?:wixstatic|wixsite|wix\.com|static\.parastorage)/i.test(homeText)) return { candidates: [], note: "Wix non observé" };
  let origin: string;
  try {
    origin = new URL(officialWebsite).origin;
  } catch {
    return { candidates: [], note: "site officiel URL invalide" };
  }
  const feed = await fetchText(`${origin}/blog-feed.xml`);
  if (feed.status !== 200 || feed.text === null) return { candidates: [], note: `flux Wix ${feed.status ?? feed.error ?? "indéterminé"}` };
  const candidates: Candidate[] = [];
  const posts = wixFeedItems(feed.text).filter((post) => PV_TEXT.test(post.title) && !NON_PV_TEXT.test(post.title)).slice(0, MAX_WIX_POSTS);
  for (const post of posts) {
    const page = await fetchText(post.link);
    if (page.status !== 200 || page.text === null) continue;
    for (const candidateUrl of wixPdfUrls(page.text)) {
      if (classifyPvObservableDocument({ url: candidateUrl, titles: new Set([post.title]), selfReference: false }).class !== "pv_probable") continue;
      candidates.push({
        slug: municipality.slug,
        mrc: municipality.mrc,
        candidate_url: candidateUrl,
        source_kind: "wix-blog-feed",
        evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; RSS Wix: titre verbatim «${post.title}», lien verbatim: ${post.link}; URL candidate verbatim dans ce billet: ${candidateUrl}.`,
        retrieved_at: page.retrievedAt,
      });
    }
  }
  return { candidates, note: candidates.length ? `Wix ${candidates.length} candidat(s)` : "flux Wix sans billet PV exploitable" };
}

function jsonString(value: string): string | null {
  try {
    return JSON.parse(`"${value.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")}"`) as string;
  } catch {
    return null;
  }
}

function youtubeDescription(html: string): { title: string; description: string } | null {
  const rawTitle = /"title":"((?:\\.|[^"\\])*)"/.exec(html)?.[1];
  const rawDescription = /"shortDescription":"((?:\\.|[^"\\])*)"/.exec(html)?.[1];
  if (!rawTitle || !rawDescription) return null;
  const title = jsonString(rawTitle);
  const description = jsonString(rawDescription);
  return title === null || description === null ? null : { title, description };
}

function namePattern(name: string): RegExp {
  const tokens = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-zA-Z0-9]+/).filter((token) => token.length > 2);
  return new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]*"), "i");
}

async function discoverYoutube(
  municipality: Municipality,
  officialWebsite: string,
  sourcePage: string,
  sourceAnchors: readonly Anchor[],
): Promise<Candidate[]> {
  const video = sourceAnchors.find((anchor) => YOUTUBE_URL.test(anchor.url) && PV_TEXT.test(`${anchor.text} ${anchor.href}`));
  if (!video) return [];
  const page = await fetchText(video.url);
  if (page.status !== 200 || page.text === null) return [];
  const details = youtubeDescription(page.text);
  if (!details || !PV_TEXT.test(`${details.title} ${details.description}`) || !namePattern(municipality.name).test(`${details.title} ${details.description}`)) return [];
  const urls = new Set<string>();
  for (const match of details.description.matchAll(/https?:\/\/[^\s"'<>]+\.(?:pdf|docx?)(?:\?[^\s"'<>]*)?/gi)) urls.add(match[0]);
  return [...urls].flatMap((candidateUrl) => {
    if (classifyPvObservableDocument({ url: candidateUrl, titles: new Set([details.title, details.description]), selfReference: false }).class !== "pv_probable") return [];
    const excerpt = details.description.slice(0, 700).replace(/\s+/g, " ").trim();
    return [{
      slug: municipality.slug,
      mrc: municipality.mrc,
      candidate_url: candidateUrl,
      source_kind: "youtube-description" as const,
      evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; lien YouTube verbatim depuis ${sourcePage}: «${video.text}» (${video.href}); titre vidéo: «${details.title}»; description verbatim: «${excerpt}».`,
      retrieved_at: page.retrievedAt,
    }];
  });
}

async function discoverMunicipality(municipality: Municipality, directory: DirectoryArtifact): Promise<{ candidates: Candidate[]; observation: Observation }> {
  const officialWebsite = directory.entries[municipality.slug]?.website;
  if (typeof officialWebsite !== "string" || !officialWebsite) {
    return { candidates: [], observation: { slug: municipality.slug, mrc: municipality.mrc, status: "no_candidate", notes: ["site officiel absent de l'annuaire MAMH"] } };
  }
  const notes: string[] = [];
  const candidates: Candidate[] = [];
  const home = await fetchText(officialWebsite);
  if (home.status !== 200 || home.text === null || home.finalUrl === null) {
    return {
      candidates,
      observation: {
        slug: municipality.slug,
        mrc: municipality.mrc,
        status: home.status === null ? "indeterminate" : "no_candidate",
        notes: [`accueil ${home.status ?? home.error ?? "indéterminé"}`],
      },
    };
  }
  const homeAnchors = anchors(home.text, home.finalUrl);
  for (const anchor of homeAnchors) {
    const candidate = candidateFromAnchor(municipality, anchor, "municipal-site-anchor", home.finalUrl, officialWebsite, home.retrievedAt);
    if (candidate) candidates.push(candidate);
  }
  const wix = await discoverWix(municipality, officialWebsite, home.text);
  candidates.push(...wix.candidates);
  notes.push(wix.note);
  const mdq = await discoverMdq(municipality, officialWebsite);
  candidates.push(...mdq.candidates);
  notes.push(mdq.note);

  const navigation = homeAnchors.filter((anchor) => !DOCUMENT_URL.test(anchor.url) && NAV_TEXT.test(`${anchor.text} ${anchor.href}`)).slice(0, MAX_NAVIGATION_PAGES);
  for (const anchor of navigation) {
    const page = await fetchText(anchor.url);
    if (page.status !== 200 || page.text === null || page.finalUrl === null) continue;
    const pageAnchors = anchors(page.text, page.finalUrl);
    for (const nested of pageAnchors) {
      const candidate = candidateFromAnchor(municipality, nested, "municipal-site-anchor", page.finalUrl, officialWebsite, page.retrievedAt);
      if (candidate) candidates.push(candidate);
    }
    candidates.push(...await discoverYoutube(municipality, officialWebsite, page.finalUrl, pageAnchors));
  }

  const mrcPortal = homeAnchors.find((anchor) => !DOCUMENT_URL.test(anchor.url) && MRC_TEXT.test(`${anchor.text} ${anchor.href}`));
  if (mrcPortal) {
    const page = await fetchText(mrcPortal.url);
    if (page.status === 200 && page.text !== null && page.finalUrl !== null) {
      const municipalityName = namePattern(municipality.name);
      for (const anchor of anchors(page.text, page.finalUrl)) {
        if (!municipalityName.test(`${anchor.text} ${anchor.href}`)) continue;
        const candidate = candidateFromAnchor(municipality, anchor, "mrc-portal-anchor", page.finalUrl, officialWebsite, page.retrievedAt);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) unique.set(`${candidate.slug}\u0000${candidate.candidate_url}`, candidate);
  const result = [...unique.values()].sort((left, right) => left.candidate_url.localeCompare(right.candidate_url));
  return {
    candidates: result,
    observation: { slug: municipality.slug, mrc: municipality.mrc, status: result.length ? "candidate" : "no_candidate", notes },
  };
}

function validateCandidate(candidate: Candidate, municipalities: ReadonlySet<string>): void {
  if (!municipalities.has(candidate.slug)) throw new Error(`candidate prior hors univers: ${candidate.slug}`);
  if (!/^https?:\/\//i.test(candidate.candidate_url) || !candidate.evidence.trim()) throw new Error(`candidate prior invalide: ${candidate.slug}`);
}

async function main(): Promise<void> {
  const inputPath = insideRepo(required("input"), "input");
  const outPath = insideRepo(required("out"), "out");
  const priorPath = arg("prior");
  if (statSync(inputPath).size > MAX_LOCAL_BYTES) throw new Error("--input dépasse le plafond local");
  const input = readSmallJson<TargetArtifact>(inputPath);
  if (input.contract !== "pv-decouverte-municipalites-vierges/v1") throw new Error("--input doit être l'univers vierge PV autoritaire");
  const universe = new Map(input.municipalities.map((municipality) => [municipality.slug, municipality]));
  if (universe.size !== input.municipalities.length || universe.size !== input.cardinality.missing_without_candidate) throw new Error("univers vierge incohérent");
  const requestedSlugs = required("slugs").split(",").map((slug) => slug.trim()).filter(Boolean);
  if (requestedSlugs.length === 0 || requestedSlugs.length > MAX_LOT_SIZE || new Set(requestedSlugs).size !== requestedSlugs.length) {
    throw new Error(`--slugs doit contenir entre 1 et ${MAX_LOT_SIZE} slugs distincts`);
  }
  const selected = requestedSlugs.map((slug) => {
    const municipality = universe.get(slug);
    if (!municipality) throw new Error(`slug hors univers vierge: ${slug}`);
    return municipality;
  });
  const directory = readSmallJson<DirectoryArtifact>(resolve(ROOT, MUNICIPAL_DIRECTORY_PATH));
  const prior = priorPath === null ? null : readSmallJson<PriorWorklist>(insideRepo(priorPath, "prior"));
  if (prior !== null && prior.contract !== "pv-decouverte-worklist/v1") throw new Error("--prior doit être une worklist de découverte PV");
  const allSlugs = new Set(universe.keys());
  const candidates = new Map<string, Candidate>();
  const observations = new Map<string, Observation>();
  for (const candidate of prior?.candidates ?? []) {
    validateCandidate(candidate, allSlugs);
    candidates.set(`${candidate.slug}\u0000${candidate.candidate_url}`, candidate);
  }
  for (const observation of prior?.observations ?? []) {
    if (!allSlugs.has(observation.slug)) throw new Error(`observation prior hors univers: ${observation.slug}`);
    observations.set(observation.slug, observation);
  }

  for (const [index, municipality] of selected.entries()) {
    const found = await discoverMunicipality(municipality, directory);
    for (const candidate of found.candidates) candidates.set(`${candidate.slug}\u0000${candidate.candidate_url}`, candidate);
    observations.set(municipality.slug, found.observation);
    process.stderr.write(`[pv-decouverte] ${index + 1}/${selected.length} ${municipality.slug}: ${found.observation.status}, candidats=${found.candidates.length}\n`);
  }
  const sortedCandidates = [...candidates.values()].sort((left, right) => left.slug.localeCompare(right.slug) || left.candidate_url.localeCompare(right.candidate_url));
  const sortedObservations = [...observations.values()].sort((left, right) => left.slug.localeCompare(right.slug));
  const withCandidate = new Set(sortedCandidates.map((candidate) => candidate.slug));
  const observationsByStatus = {
    candidate: sortedObservations.filter((observation) => observation.status === "candidate").length,
    no_candidate: sortedObservations.filter((observation) => observation.status === "no_candidate").length,
    indeterminate: sortedObservations.filter((observation) => observation.status === "indeterminate").length,
  };
  const worklist = {
    contract: "pv-decouverte-worklist/v1",
    generated_at: new Date().toISOString(),
    read_only_web_discovery: true,
    no_document_bytes_read: true,
    input: { path: inputPath.slice(ROOT.length + 1), sha256: sha256File(inputPath), target_municipalities: universe.size },
    batch: { slugs: selected.map((municipality) => municipality.slug), max_lot_size: MAX_LOT_SIZE },
    coverage: {
      municipalities_with_at_least_one_discovered_candidate: withCandidate.size,
      municipalities_without_discovered_candidate: universe.size - withCandidate.size,
      municipalities_observed: sortedObservations.length,
      municipalities_not_yet_observed: universe.size - sortedObservations.length,
      observations: observationsByStatus,
    },
    candidates: sortedCandidates,
    observations: sortedObservations,
  } as const;
  writeFileSync(outPath, `${JSON.stringify(worklist, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out: outPath.slice(ROOT.length + 1), candidates: sortedCandidates.length, municipalities: withCandidate.size, observed: sortedObservations.length, universe: universe.size }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
