/**
 * Découverte PV strictement en lecture web pour un court lot de municipalités
 * réellement vierges. Ne lit que les pages HTML/XML et endpoints JSON: un
 * Content-Type documentaire est refusé avant lecture. Les URLs candidates sont
 * donc des entrées durables pour la capture cluster, jamais une capture locale.
 *
 * Entrées:
 *   --input=work/coverage/pv-decouverte-municipalites-vierges-....json
 *     ou --municipalities=packages/qc-sources/src/geo/municipalities.qc.json
 *   --slugs=slug-a,slug-b  (1..8 slugs de l'univers choisi)
 *   --out=work/coverage/pv-decouverte-worklist-....json
 *   [--out-capture-worklist=work/coverage/pv-decouverte-...-lot-0001.json]
 *   [--source=pv-index] (tag de chaque cible de la worklist de capture; défaut
 *     `pv-index` car toute la chaîne de couverture PV clé sur `raw/pv-index/cas/`;
 *     un tag `pv-discovery` déposerait des octets orphelins invisibles à la métrique)
 *   [--max-candidates-per-municipality=0] (0 = tous)
 *   [--seed-pages=slug=https://index-officiel,...]
 *   [--seed-json=slug=https://endpoint-cms-officiel,...]
 *   [--seed-only] (ne suit pas les pages de navigation hors index fourni)
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
import { fileURLToPath, pathToFileURL } from "node:url";

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
const MAX_PV_DETAIL_PAGES = 12;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const RESEARCH_UA = "sentropic-geo-pv-discovery/1.0 (+https://github.com/rhanka/radar-immobilier)";
const ACCEPT = "text/html,application/xhtml+xml,application/xml,text/xml,application/json,text/plain;q=0.8,*/*;q=0.1";
const PV_TEXT = /proc[eè]s[-\s]?verbaux?|\bp\.?\s?v\.?\b|s[eé]ances?\s+(?:ordinaires?|extraordinaires?|du\s+conseil)|meeting\s+minutes|\bminutes\b/i;
const PV_DOCUMENT_TEXT = /proc[eè]s[-\s]?verbaux?|(?:^|[^a-z0-9])p\.?\s?v\.?(?=$|[^a-z0-9])|meeting\s+minutes|\bminutes\b/i;
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

interface MunicipalReferenceArtifact {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

type SourceKind =
  | "municipal-site-anchor"
  | "municipalites-du-quebec-json"
  | "wix-blog-feed"
  | "mrc-portal-anchor"
  | "wordpress-media-json"
  | "cms-json-table"
  | "cms-embedded-table"
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
  if (!PV_DOCUMENT_TEXT.test(`${anchor.text} ${anchor.href}`)) return null;
  if (/comit[eé]|commission|demolition|pl[ée]nier/i.test(sourcePage)) return null;
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

/** Table sérialisée dans le HTML SSR (Nuxt, CMS, etc.), sans télécharger le document. */
function discoverEmbeddedCouncilTables(
  municipality: Municipality,
  officialWebsite: string,
  sourcePage: string,
  sourcePageText: string,
  retrievedAt: string,
): Candidate[] {
  const html = sourcePageText
    .replace(/\\\\/g, "\\")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\"/g, "\"")
    .replace(/\\r\\n|\\n/g, "\n");
  const candidates: Candidate[] = [];
  if (/proc[eè]s[-\s]?verbaux?/i.test(html)) {
    for (const anchor of anchors(html, sourcePage)) {
      const direct = candidateFromAnchor(municipality, anchor, "municipal-site-anchor", sourcePage, officialWebsite, retrievedAt);
      if (direct === null) continue;
      candidates.push({
        ...direct,
        source_kind: "cms-embedded-table",
        evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; page officielle lue: ${sourcePage}; colonne verbatim «Procès-verbal» dans le tableau des séances; ancre documentaire verbatim: «${anchor.text}» (href: ${anchor.href}).`,
      });
    }
  }
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const rows = [...(table[1] ?? "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? "");
    const header = rows.find((row) => /proc[eè]s[-\s]?verbaux?/i.test(decodeHtml(row)));
    if (header === undefined) continue;
    const columns = [...header.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decodeHtml(match[1] ?? ""));
    const pvColumn = columns.findIndex((column) => /proc[eè]s[-\s]?verbaux?/i.test(column));
    if (pvColumn < 0) continue;
    for (const row of rows) {
      if (row === header) continue;
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? "");
      const cell = cells[pvColumn];
      if (cell === undefined) continue;
      const document = anchors(cell, sourcePage).find((anchor) => DOCUMENT_URL.test(anchor.url));
      if (document === undefined) continue;
      const rowText = decodeHtml(row);
      if (!rowText) continue;
      candidates.push({
        slug: municipality.slug,
        mrc: municipality.mrc,
        candidate_url: document.url,
        source_kind: "cms-embedded-table",
        evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; page officielle lue: ${sourcePage}; en-tête de tableau verbatim: «${columns[pvColumn]}»; ligne de séance verbatim: «${rowText}»; document dans cette colonne: ${document.url}.`,
        retrieved_at: retrievedAt,
      });
    }
  }
  return candidates;
}

function sameOfficialDomain(seed: string, officialWebsite: string): boolean {
  try {
    const normalized = (hostname: string): string => hostname.toLowerCase().replace(/^www\d*\./, "");
    return normalized(new URL(seed).hostname) === normalized(new URL(officialWebsite).hostname);
  } catch {
    return false;
  }
}

/**
 * Certaines pages d'index (notamment WordPress) nomment le PV mais pointent
 * d'abord vers une publication HTML. Cette seconde lecture reste textuelle :
 * elle n'accepte que les ancres documentaires réellement présentes dans la
 * publication et conserve l'intitulé de la séance qui les rattache à la ville.
 */
async function discoverPvPublication(
  municipality: Municipality,
  officialWebsite: string,
  sourcePage: string,
  publication: Anchor,
): Promise<Candidate[]> {
  if (DOCUMENT_URL.test(publication.url) || !PV_TEXT.test(`${publication.text} ${publication.href}`) || NON_PV_TEXT.test(publication.text)) {
    return [];
  }
  const response = await fetchText(publication.url);
  if (response.status !== 200 || response.text === null || response.finalUrl === null) return [];
  const candidates: Candidate[] = [];
  for (const anchor of anchors(response.text, response.finalUrl)) {
    const direct = candidateFromAnchor(municipality, anchor, "municipal-site-anchor", response.finalUrl, officialWebsite, response.retrievedAt);
    if (direct === null) continue;
    candidates.push({
      ...direct,
      evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; page d'index: ${sourcePage}; lien de séance verbatim: «${publication.text}» (href: ${publication.href}); publication lue: ${response.finalUrl}; ancre documentaire verbatim: «${anchor.text}» (href: ${anchor.href}).`,
    });
  }
  return candidates;
}

interface WordPressMedia {
  readonly source_url?: unknown;
  readonly date?: unknown;
  readonly slug?: unknown;
  readonly title?: { readonly rendered?: unknown };
  readonly caption?: { readonly rendered?: unknown };
  readonly description?: { readonly rendered?: unknown };
}

function mediaText(media: WordPressMedia): string {
  return [media.title?.rendered, media.caption?.rendered, media.description?.rendered]
    .filter((value): value is string => typeof value === "string")
    .map(decodeHtml)
    .filter(Boolean)
    .join(" | ");
}

/** Endpoint standard WordPress, seulement quand le CMS est observé sur le site officiel. */
async function discoverWordpressMedia(
  municipality: Municipality,
  officialWebsite: string,
  homeText: string,
): Promise<Candidate[]> {
  if (!/(?:wp-content|wp-includes|wp-json)/i.test(homeText)) return [];
  let origin: string;
  try {
    origin = new URL(officialWebsite).origin;
  } catch {
    return [];
  }
  const candidates: Candidate[] = [];
  for (const search of ["proces-verbal", "PV"]) {
    const endpoint = `${origin}/wp-json/wp/v2/media?search=${encodeURIComponent(search)}&per_page=20&orderby=date&order=desc`;
    const response = await fetchText(endpoint);
    if (response.status !== 200 || response.text === null) continue;
    let medias: unknown;
    try {
      medias = JSON.parse(response.text);
    } catch {
      continue;
    }
    if (!Array.isArray(medias)) continue;
    for (const raw of medias) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const media = raw as WordPressMedia;
      const candidateUrl = typeof media.source_url === "string" ? media.source_url.trim() : "";
      const text = mediaText(media);
      if (!DOCUMENT_URL.test(candidateUrl) || !PV_DOCUMENT_TEXT.test(`${text} ${candidateUrl}`) || NON_PV_TEXT.test(text)) continue;
      if (classifyPvObservableDocument({ url: candidateUrl, titles: new Set([text]), selfReference: false }).class !== "pv_probable") continue;
      const date = typeof media.date === "string" ? media.date : "date absente";
      candidates.push({
        slug: municipality.slug,
        mrc: municipality.mrc,
        candidate_url: candidateUrl,
        source_kind: "wordpress-media-json",
        evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; endpoint WordPress lu: ${response.finalUrl ?? endpoint}; titre/caption/description verbatim: «${text}»; date média verbatim: «${date}»; URL média verbatim: ${candidateUrl}.`,
        retrieved_at: response.retrievedAt,
      });
    }
  }
  return candidates;
}

/**
 * Certains CMS livrent le contenu de leur tableau de séances dans un champ
 * JSON `html`. La page officielle reste la preuve de la colonne « Procès-
 * verbal »; le JSON ne fait que matérialiser les lignes. Une URL est retenue
 * seulement comme premier document de cette colonne, jamais sur son extension.
 */
async function discoverCmsJsonTable(
  municipality: Municipality,
  officialWebsite: string,
  sourcePage: string,
  sourcePageText: string,
  endpoint: string,
): Promise<Candidate[]> {
  if (!sourcePageText || !sameOfficialDomain(sourcePage, officialWebsite)) return [];
  if (!sameOfficialDomain(endpoint, officialWebsite)) return [];
  const response = await fetchText(endpoint);
  if (response.status !== 200 || response.text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return [];
  }
  const html = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { html?: unknown }).html === "string"
    ? (parsed as { html: string }).html
    : null;
  if (html === null) return [];
  const candidates: Candidate[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1] ?? "";
    const documents = anchors(row, response.finalUrl ?? endpoint).filter((anchor) => DOCUMENT_URL.test(anchor.url));
    const candidate = documents[0];
    if (candidate === undefined) continue;
    const rowText = decodeHtml(row);
    if (!rowText) continue;
    candidates.push({
      slug: municipality.slug,
      mrc: municipality.mrc,
      candidate_url: candidate.url,
      source_kind: "cms-json-table",
      evidence: `Annuaire MAMH (site officiel): ${officialWebsite}; page officielle lue: ${sourcePage}, tableau avec colonne verbatim «Procès-verbal»; endpoint JSON CMS lu: ${response.finalUrl ?? endpoint}; ligne de séance verbatim: «${rowText}»; premier document de la colonne Procès-verbal: ${candidate.url}.`,
      retrieved_at: response.retrievedAt,
    });
  }
  return candidates;
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

async function discoverMunicipality(
  municipality: Municipality,
  directory: DirectoryArtifact,
  seedPages: readonly string[],
  seedJson: readonly string[],
  followNavigation: boolean,
): Promise<{ candidates: Candidate[]; observation: Observation }> {
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
  candidates.push(...await discoverWordpressMedia(municipality, officialWebsite, home.text));
  for (const publication of homeAnchors.filter((anchor) => PV_TEXT.test(`${anchor.text} ${anchor.href}`)).slice(0, MAX_PV_DETAIL_PAGES)) {
    candidates.push(...await discoverPvPublication(municipality, officialWebsite, home.finalUrl, publication));
  }
  const wix = await discoverWix(municipality, officialWebsite, home.text);
  candidates.push(...wix.candidates);
  notes.push(wix.note);
  const mdq = await discoverMdq(municipality, officialWebsite);
  candidates.push(...mdq.candidates);
  notes.push(mdq.note);

  for (const seed of seedPages) {
    if (!sameOfficialDomain(seed, officialWebsite)) {
      notes.push(`index seed rejeté (domaine non officiel): ${seed}`);
      continue;
    }
    const page = await fetchText(seed);
    if (page.status !== 200 || page.text === null || page.finalUrl === null) {
      notes.push(`index seed ${seed}: ${page.status ?? page.error ?? "indéterminé"}`);
      continue;
    }
    const pageAnchors = anchors(page.text, page.finalUrl);
    const embeddedCandidates = discoverEmbeddedCouncilTables(municipality, officialWebsite, page.finalUrl, page.text, page.retrievedAt);
    candidates.push(...embeddedCandidates);
    notes.push(`tables CMS SSR lues: ${page.finalUrl}; candidats=${embeddedCandidates.length}`);
    for (const anchor of pageAnchors) {
      const candidate = candidateFromAnchor(municipality, anchor, "municipal-site-anchor", page.finalUrl, officialWebsite, page.retrievedAt);
      if (candidate) candidates.push(candidate);
    }
    for (const publication of pageAnchors.filter((anchor) => PV_TEXT.test(`${anchor.text} ${anchor.href}`)).slice(0, MAX_PV_DETAIL_PAGES)) {
      candidates.push(...await discoverPvPublication(municipality, officialWebsite, page.finalUrl, publication));
    }
    for (const endpoint of seedJson) {
      const cmsCandidates = await discoverCmsJsonTable(municipality, officialWebsite, page.finalUrl, page.text, endpoint);
      candidates.push(...cmsCandidates);
      notes.push(`endpoint JSON CMS lu: ${endpoint}; candidats=${cmsCandidates.length}`);
    }
    notes.push(`index seed lu: ${page.finalUrl}`);
  }

  const navigation = followNavigation
    ? homeAnchors.filter((anchor) => !DOCUMENT_URL.test(anchor.url) && NAV_TEXT.test(`${anchor.text} ${anchor.href}`)).slice(0, MAX_NAVIGATION_PAGES)
    : [];
  for (const anchor of navigation) {
    const page = await fetchText(anchor.url);
    if (page.status !== 200 || page.text === null || page.finalUrl === null) continue;
    const pageAnchors = anchors(page.text, page.finalUrl);
    for (const nested of pageAnchors) {
      const candidate = candidateFromAnchor(municipality, nested, "municipal-site-anchor", page.finalUrl, officialWebsite, page.retrievedAt);
      if (candidate) candidates.push(candidate);
    }
    for (const publication of pageAnchors.filter((nested) => PV_TEXT.test(`${nested.text} ${nested.href}`)).slice(0, MAX_PV_DETAIL_PAGES)) {
      candidates.push(...await discoverPvPublication(municipality, officialWebsite, page.finalUrl, publication));
    }
    candidates.push(...await discoverYoutube(municipality, officialWebsite, page.finalUrl, pageAnchors));
  }

  const mrcPortal = followNavigation ? homeAnchors.find((anchor) => !DOCUMENT_URL.test(anchor.url) && MRC_TEXT.test(`${anchor.text} ${anchor.href}`)) : undefined;
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

function seedUrls(raw: string | null, selectedSlugs: ReadonlySet<string>, optionName: string): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  if (raw === null || !raw.trim()) return result;
  for (const value of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = value.indexOf("=");
    if (separator < 1) throw new Error(`--${optionName} invalide: ${value}`);
    const slug = value.slice(0, separator);
    const page = value.slice(separator + 1);
    if (!selectedSlugs.has(slug) || !/^https?:\/\//i.test(page)) throw new Error(`--${optionName} hors lot ou URL invalide: ${value}`);
    const pages = result.get(slug) ?? [];
    pages.push(page);
    result.set(slug, pages);
  }
  return result;
}

export const DEFAULT_CAPTURE_SOURCE = "pv-index";

export interface CaptureTarget {
  readonly slug: string;
  readonly source: string;
  readonly urls: readonly string[];
}

/**
 * Regroupe les candidates par municipalité en cibles de capture cluster.
 * `source` étiquette chaque cible : toute la chaîne de couverture PV clé sur
 * `raw/pv-index/cas/`, donc le défaut opérationnel est `pv-index`. Un tag
 * `pv-discovery` déposerait des octets orphelins invisibles à la métrique.
 */
export function buildCaptureTargets(
  candidates: readonly { readonly slug: string; readonly candidate_url: string }[],
  source: string,
  maxCandidatesPerMunicipality: number,
): CaptureTarget[] {
  const bySlug = new Map<string, string[]>();
  for (const candidate of candidates) {
    const current = bySlug.get(candidate.slug) ?? [];
    if (maxCandidatesPerMunicipality === 0 || current.length < maxCandidatesPerMunicipality) current.push(candidate.candidate_url);
    bySlug.set(candidate.slug, current);
  }
  return [...bySlug.entries()]
    .map(([slug, urls]) => ({ slug, source, urls }))
    .filter((target) => target.urls.length > 0)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

async function main(): Promise<void> {
  const outPath = insideRepo(required("out"), "out");
  const rawInputPath = arg("input");
  const rawMunicipalitiesPath = arg("municipalities");
  if ((rawInputPath === null) === (rawMunicipalitiesPath === null)) {
    throw new Error("un seul de --input ou --municipalities est requis");
  }
  const inputPath = rawInputPath === null ? null : insideRepo(rawInputPath, "input");
  const municipalitiesPath = rawMunicipalitiesPath === null ? null : insideRepo(rawMunicipalitiesPath, "municipalities");
  const outCaptureWorklist = arg("out-capture-worklist");
  const captureWorklistPath = outCaptureWorklist === null ? null : insideRepo(outCaptureWorklist, "out-capture-worklist");
  const captureSource = arg("source") ?? DEFAULT_CAPTURE_SOURCE;
  if (!captureSource.trim()) throw new Error("--source ne doit pas être vide");
  const maxCandidatesRaw = arg("max-candidates-per-municipality") ?? "0";
  const maxCandidatesPerMunicipality = Number(maxCandidatesRaw);
  if (!Number.isInteger(maxCandidatesPerMunicipality) || maxCandidatesPerMunicipality < 0) {
    throw new Error("--max-candidates-per-municipality doit être un entier >= 0");
  }
  const priorPath = arg("prior");
  let universe: Map<string, Municipality>;
  let universeSource: { path: string; sha256: `sha256:${string}`; target_municipalities: number; kind: "missing-universe" | "municipal-reference" };
  if (inputPath !== null) {
    if (statSync(inputPath).size > MAX_LOCAL_BYTES) throw new Error("--input dépasse le plafond local");
    const input = readSmallJson<TargetArtifact>(inputPath);
    if (input.contract !== "pv-decouverte-municipalites-vierges/v1") throw new Error("--input doit être l'univers vierge PV autoritaire");
    universe = new Map(input.municipalities.map((municipality) => [municipality.slug, municipality]));
    if (universe.size !== input.municipalities.length || universe.size !== input.cardinality.missing_without_candidate) throw new Error("univers vierge incohérent");
    universeSource = {
      path: inputPath.slice(ROOT.length + 1),
      sha256: sha256File(inputPath),
      target_municipalities: universe.size,
      kind: "missing-universe",
    };
  } else {
    const municipalities = readSmallJson<MunicipalReferenceArtifact[]>(municipalitiesPath!);
    if (!Array.isArray(municipalities)) throw new Error("--municipalities doit être un tableau municipal");
    universe = new Map(municipalities.map((municipality) => [municipality.slug, municipality]));
    if (universe.size !== municipalities.length || [...universe.values()].some((municipality) => !municipality.slug || !municipality.name)) {
      throw new Error("référentiel municipal incohérent");
    }
    universeSource = {
      path: municipalitiesPath!.slice(ROOT.length + 1),
      sha256: sha256File(municipalitiesPath!),
      target_municipalities: universe.size,
      kind: "municipal-reference",
    };
  }
  const requestedSlugs = required("slugs").split(",").map((slug) => slug.trim()).filter(Boolean);
  if (requestedSlugs.length === 0 || requestedSlugs.length > MAX_LOT_SIZE || new Set(requestedSlugs).size !== requestedSlugs.length) {
    throw new Error(`--slugs doit contenir entre 1 et ${MAX_LOT_SIZE} slugs distincts`);
  }
  const selected = requestedSlugs.map((slug) => {
    const municipality = universe.get(slug);
    if (!municipality) throw new Error(`slug hors univers vierge: ${slug}`);
    return municipality;
  });
  const selectedSlugs = new Set(selected.map((municipality) => municipality.slug));
  const seeds = seedUrls(arg("seed-pages"), selectedSlugs, "seed-pages");
  const jsonSeeds = seedUrls(arg("seed-json"), selectedSlugs, "seed-json");
  const followNavigation = !process.argv.includes("--seed-only");
  const directory = readSmallJson<DirectoryArtifact>(resolve(ROOT, MUNICIPAL_DIRECTORY_PATH));
  const prior = priorPath === null ? null : readSmallJson<PriorWorklist>(insideRepo(priorPath, "prior"));
  if (prior !== null && prior.contract !== "pv-decouverte-worklist/v1") throw new Error("--prior doit être une worklist de découverte PV");
  const allSlugs = new Set(universe.keys());
  const candidates = new Map<string, Candidate>();
  const observations = new Map<string, Observation>();
  for (const candidate of prior?.candidates ?? []) {
    validateCandidate(candidate, allSlugs);
    if (selectedSlugs.has(candidate.slug)) continue;
    candidates.set(`${candidate.slug}\u0000${candidate.candidate_url}`, candidate);
  }
  for (const observation of prior?.observations ?? []) {
    if (!allSlugs.has(observation.slug)) throw new Error(`observation prior hors univers: ${observation.slug}`);
    if (selectedSlugs.has(observation.slug)) continue;
    observations.set(observation.slug, observation);
  }

  for (const [index, municipality] of selected.entries()) {
    const found = await discoverMunicipality(
      municipality,
      directory,
      seeds.get(municipality.slug) ?? [],
      jsonSeeds.get(municipality.slug) ?? [],
      followNavigation,
    );
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
    input: universeSource,
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
  let captureTargets = 0;
  if (captureWorklistPath !== null) {
    const targets = buildCaptureTargets(sortedCandidates, captureSource, maxCandidatesPerMunicipality);
    writeFileSync(captureWorklistPath, `${JSON.stringify(targets, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    captureTargets = targets.length;
  }
  process.stdout.write(`${JSON.stringify({ out: outPath.slice(ROOT.length + 1), candidates: sortedCandidates.length, municipalities: withCandidate.size, observed: sortedObservations.length, universe: universe.size, capture_worklist: captureWorklistPath?.slice(ROOT.length + 1) ?? null, capture_targets: captureTargets }, null, 2)}\n`);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
