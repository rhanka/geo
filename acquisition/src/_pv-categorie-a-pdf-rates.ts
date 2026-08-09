/**
 * Mesure bornée des faux négatifs / faux positifs de la découverte PV.
 *
 * Cette sonde ne modifie aucun crawler et ne dépose aucun octet : toutes les
 * requêtes passent par capturedFetch, avec un store mémoire. Les PDF sont lus
 * depuis les octets retenus en mémoire et passés à pdftotext sur stdin.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

import {
  capturedFetch,
  capturedText,
  type CapturedFetchResult,
} from "../../packages/qc-sources/src/capture/capturedFetch.js";
import {
  CaptureRun,
  type CaptureObjectStore,
} from "../../packages/qc-sources/src/capture/capture-run.js";
import { SAINT_BENJAMIN_PV_CONFIG } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_HTTP_BYTES = 5 * 1024 * 1024;
const CONTROL_COUNT = 10;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const ACCEPT = "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8";
const HTML_MARKERS = /<(?:!doctype\s+html|html\b|head\b|body\b|script\b|main\b)/i;
const PV_MARKERS = /proc[eè]s[- ]verbaux?|proc[eè]s[- ]verbal|\bpv\b|s[eé]ance|conseil municipal|minutes|meeting minutes/i;
const DISCOVERY_CONTEXT = /proc[eèé]s.verbal|s[eéè]ance|conseil\s+municipal|ordre.du.jour/i;
const DISCOVERY_HREF = /proc[eèé]s.verbaux?|s[eé]ances|conseil|ordres?-du-jour/i;
const NON_DOCUMENT_ASSET = /\.(?:mp3|mp4|m4a|wav|webm|mov|avi|mkv|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?)(?:$|[?#])/i;
const DOCUMENT_HINT = /\.pdf(?:$|[?#])|\/files?\/|\/documents?\/|download|fichier|media|proc[eè]s|\bpv\b|s[eé]ance|ordre|calendrier/i;
const PREVIEW_DIR = "/tmp/pv-categorie-a-pdf-rates-previews";

interface Store extends CaptureObjectStore {
  readonly objects: Map<string, Uint8Array | string>;
}

interface Anchor {
  readonly url: string;
  readonly text: string;
  readonly href: string;
}

interface EvidenceRef {
  readonly requested_url: string;
  readonly final_url: string | null;
  readonly status: number | null;
  readonly error: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly body_kind: "html" | "pdf" | "text" | "json" | "binary" | "no_body";
}

interface PdfEvidence extends EvidenceRef {
  readonly pdf_magic: boolean;
  readonly pdftotext_ok: boolean;
  readonly text_chars: number;
  readonly text_markers: readonly string[];
  readonly text_head: string;
  readonly body_designates_pv: boolean;
  readonly visual_preview_path: string | null;
  readonly visual_review: { readonly performed: boolean; readonly verdict: string; readonly basis: string } | null;
}

interface SurveyReport {
  readonly observations: readonly {
    readonly slug: string;
    readonly name: string;
    readonly mrc: string | null;
    readonly directory_website: string | null;
    readonly category: string;
    readonly homepage: EvidenceRef | null;
    readonly followed_links: readonly EvidenceRef[];
    readonly pv_evidence: readonly EvidenceRef[];
  }[];
}

interface ListReport {
  readonly municipalities: readonly { readonly slug: string; readonly name: string; readonly mrc: string | null }[];
}

interface CoverageMatrix {
  readonly cities: Record<string, { readonly pv?: Record<string, unknown> }>;
}

class MemoryStore implements Store {
  readonly objects = new Map<string, Uint8Array | string>();

  async head(key: string): Promise<boolean> { return this.objects.has(key); }
  async put(key: string, body: Uint8Array | string): Promise<void> { this.objects.set(key, body); }
}

function readSmallJson<T>(path: string): T {
  const size = statSync(path).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${path}: lecture > 5 MiB refusée`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyKind(bytes: Uint8Array | null): EvidenceRef["body_kind"] {
  if (bytes === null || bytes.length === 0) return "no_body";
  const prefix = new TextDecoder("ascii", { fatal: false }).decode(bytes.subarray(0, 1024));
  const trimmed = prefix.trimStart();
  if (prefix.startsWith("%PDF-")) return "pdf";
  if (HTML_MARKERS.test(prefix)) return "html";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(prefix.slice(0, Math.min(prefix.length, 256)))) return "text";
  return "binary";
}

function anchors(html: string, baseUrl: string): Anchor[] {
  const values: Anchor[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1] ?? "").trim();
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url: string;
    try { url = new URL(href, baseUrl).toString(); } catch { continue; }
    values.push({ href, url, text: decodeHtml(match[2] ?? "") });
  }
  return [...new Map(values.map((value) => [value.url, value])).values()];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function runPdfText(bytes: Uint8Array): { ok: boolean; text: string } {
  try {
    const text = execFileSync("pdftotext", ["-", "-"], {
      input: Buffer.from(bytes),
      maxBuffer: MAX_HTTP_BYTES,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, text: normalizeText(text) };
  } catch {
    return { ok: false, text: "" };
  }
}

function renderPdfPreview(bytes: Uint8Array, slug: string): string | null {
  const previewPath = `${PREVIEW_DIR}/${slug}.png`;
  try {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    execFileSync("pdftoppm", ["-png", "-r", "120", "-f", "1", "-singlefile", "-", previewPath.slice(0, -4)], {
      input: Buffer.from(bytes),
      stdio: ["pipe", "ignore", "pipe"],
    });
    return previewPath;
  } catch {
    return null;
  }
}

const VISUAL_REVIEWED_PDFS: Record<string, { readonly verdict: string; readonly basis: string }> = {
  "saint-benjamin": {
    verdict: "not_pv",
    basis: "premiere_page_lue: AVIS PUBLIC et CALENDRIER 2026 DES SEANCES ORDINAIRES DU CONSEIL MUNICIPAL",
  },
};

function semanticPdfDesignation(text: string): boolean {
  const head = text.slice(0, 1800);
  const opening = text.slice(0, 500);
  if (/^\s*(?:ordre\s+du\s+jour|avis\s+public|calendrier)/i.test(opening)) return false;
  return /^\s*[^.]{0,180}proc[eè]s[- ]verbal(?:\s+de|\s+du|\s+de la)?/i.test(opening)
    || /^\s*[^.]{0,180}(?:meeting\s+minutes|minutes\s+of\s+(?:the\s+)?(?:council|meeting))/i.test(opening)
    || (/proc[eè]s[- ]verbal(?:\s+de|\s+du|\s+de la)?/i.test(head) && !/ordre\s+du\s+jour|calendrier\s+20\d{2}/i.test(opening));
}

function pdfEvidence(result: CapturedFetchResult, context: string, slug: string): PdfEvidence {
  const bytes = result.bytes;
  const textResult = bytes !== null && bodyKind(bytes) === "pdf" ? runPdfText(bytes) : { ok: false, text: "" };
  const text = textResult.text;
  const visualReview = text.length === 0 && VISUAL_REVIEWED_PDFS[slug]
    ? { performed: true, ...VISUAL_REVIEWED_PDFS[slug] }
    : null;
  const textMarkers = [
    ...( /proc[eè]s[- ]verbaux?/i.test(text) ? ["proces-verbaux"] : []),
    ...( /s[eé]ance.{0,80}conseil|conseil.{0,80}s[eé]ance/i.test(text) ? ["seance-conseil"] : []),
    ...( /conseil municipal/i.test(text) ? ["conseil-municipal"] : []),
    ...( /minutes.{0,80}(council|meeting)|meeting.{0,80}minutes/i.test(text) ? ["meeting-minutes"] : []),
  ];
  return {
    requested_url: result.line.url,
    final_url: result.line.final_url,
    status: result.line.http_status,
    error: result.line.error,
    bytes: result.line.bytes,
    sha256: result.line.sha256,
    body_kind: bodyKind(bytes),
    pdf_magic: bytes !== null && new TextDecoder("ascii").decode(bytes.subarray(0, 5)) === "%PDF-",
    pdftotext_ok: textResult.ok,
    text_chars: text.length,
    text_markers: textMarkers,
    text_head: text.slice(0, 1000),
    body_designates_pv: visualReview?.verdict === "pv" ? true : textResult.ok ? semanticPdfDesignation(text) : false,
    visual_preview_path: bytes !== null && bodyKind(bytes) === "pdf" && text.length === 0 ? renderPdfPreview(bytes, slug) : null,
    visual_review: visualReview,
  };
}

function simpleEvidence(result: CapturedFetchResult): EvidenceRef {
  return {
    requested_url: result.line.url,
    final_url: result.line.final_url,
    status: result.line.http_status,
    error: result.line.error,
    bytes: result.line.bytes,
    sha256: result.line.sha256,
    body_kind: bodyKind(result.bytes),
  };
}

async function capture(
  run: CaptureRun,
  url: string,
  slug: string,
  attempt: number,
): Promise<{ readonly result: CapturedFetchResult; readonly body: string | null; readonly anchors: readonly Anchor[] }> {
  const result = await capturedFetch(
    url,
    { headers: { accept: ACCEPT, "accept-language": "fr-CA,fr;q=0.9,en;q=0.7" } },
    {
      run,
      source: "pv-categorie-a-pdf-rates",
      slugs: [slug],
      attempt,
      timeoutMs: 15_000,
      maxBytes: MAX_HTTP_BYTES,
      store: false,
      retainBody: true,
    },
  );
  const kind = bodyKind(result.bytes);
  const body = result.ok && (kind === "html" || kind === "text" || kind === "json")
    ? capturedText(result)
    : null;
  return { result, body, anchors: body === null ? [] : anchors(body, result.line.final_url ?? url) };
}

function hash32(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function sample<T>(values: readonly T[], seed: string, count: number): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = hash32(`${seed}:${index}`) % (index + 1);
    [output[index], output[swap]] = [output[swap]!, output[index]!];
  }
  return output.slice(0, count);
}

function hostname(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}

function discoveryFlags(
  pageUrl: string,
  pageBody: string,
  pageAnchors: readonly Anchor[],
  actualUrl: string,
): Record<string, boolean> {
  const actual = pageAnchors.find((anchor) => sameResource(anchor.url, actualUrl));
  const href = actual?.href ?? actualUrl;
  return {
    page_reached_from_pv_home_link: pageUrl !== "homepage" && pageAnchors.some((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`)),
    page_passes_historic_context_gate: DISCOVERY_CONTEXT.test(pageBody),
    page_passes_plural_aware_context_gate: PV_MARKERS.test(pageBody),
    actual_pdf_anchor_seen_in_opened_page: actual !== undefined,
    actual_pdf_href_has_pdf_extension: /\.pdf(?:$|[?#])/i.test(href),
    actual_pdf_href_is_extensionless: !/\.pdf(?:$|[?#])/i.test(href),
    actual_pdf_host_differs_from_page: hostname(actualUrl) !== hostname(pageUrl),
  };
}

function sameResource(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.href === b.href || (a.pathname === b.pathname && a.pathname.length > 1 && a.pathname.endsWith(".pdf"));
  } catch {
    return left === right;
  }
}

function documentAnchors(values: readonly Anchor[]): Anchor[] {
  return values
    .filter((anchor) => DOCUMENT_HINT.test(`${anchor.href} ${anchor.text}`))
    .filter((anchor) => !NON_DOCUMENT_ASSET.test(new URL(anchor.url).pathname))
    .slice(0, 12);
}

async function inspectTarget(
  run: CaptureRun,
  observation: SurveyReport["observations"][number],
  matrixEntry: CoverageMatrix["cities"][string] | undefined,
  attempt: { value: number },
): Promise<Record<string, unknown>> {
  if (!observation.directory_website || !observation.pv_evidence[0]) throw new Error(`cas a incomplet: ${observation.slug}`);
  const actualRequestedUrl = observation.pv_evidence[0].requested_url;
  const actualFinalUrl = observation.pv_evidence[0].final_url ?? actualRequestedUrl;
  const home = await capture(run, observation.directory_website, observation.slug, attempt.value++);
  const pageCandidates = home.anchors
    .filter((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`) && !NON_DOCUMENT_ASSET.test(new URL(anchor.url).pathname))
    .slice(0, 10);
  const candidatePages: Array<{ readonly url: string; readonly body: string; readonly anchors: readonly Anchor[]; readonly result: CapturedFetchResult }> = [
    { url: "homepage", body: home.body ?? "", anchors: home.anchors, result: home.result },
  ];
  for (const candidate of pageCandidates) {
    const pageCapture = await capture(run, candidate.url, observation.slug, attempt.value++);
    if (pageCapture.body !== null) candidatePages.push({ url: candidate.url, body: pageCapture.body, anchors: pageCapture.anchors, result: pageCapture.result });
  }
  const sourcePage = candidatePages.find((candidate) => candidate.anchors.some((anchor) => sameResource(anchor.url, actualRequestedUrl) || sameResource(anchor.url, actualFinalUrl)))
    ?? candidatePages.find((candidate) => candidate.url !== "homepage" && candidate.body.includes("proc"))
    ?? candidatePages[0]!;
  const pageUrl = sourcePage.url;
  const page = sourcePage;
  const pdf = await capture(run, actualRequestedUrl, observation.slug, attempt.value++);
  const openedPdf = pdfEvidence(pdf.result, `${actualRequestedUrl} ${actualFinalUrl}`, observation.slug);
  const pageBody = page.body ?? "";
  const pageResolvedUrl = pageUrl === "homepage" ? (home.result.line.final_url ?? observation.directory_website) : pageUrl;
  const flags = discoveryFlags(pageResolvedUrl, pageBody, page.anchors, actualRequestedUrl);
  const alternateDocuments: Record<string, unknown>[] = [];
  const alternatePdfs: PdfEvidence[] = [];
  for (const anchor of documentAnchors(page.anchors)) {
    if (sameResource(anchor.url, actualRequestedUrl) || sameResource(anchor.url, actualFinalUrl)) continue;
    const candidate = await capture(run, anchor.url, observation.slug, attempt.value++);
    if (bodyKind(candidate.result.bytes) === "pdf") {
      const evidence = pdfEvidence(candidate.result, `${anchor.text} ${anchor.href}`, observation.slug);
      alternatePdfs.push(evidence);
      alternateDocuments.push({ anchor: { href: anchor.href, text: anchor.text }, pdf: evidence });
    } else {
      alternateDocuments.push({ anchor: { href: anchor.href, text: anchor.text }, evidence: simpleEvidence(candidate.result) });
    }
  }
  const genericIndex = observation.slug === "saint-benjamin" ? SAINT_BENJAMIN_PV_CONFIG.pvIndexUrl : null;
  const genericIndexCapture = genericIndex
    ? await capture(run, genericIndex, observation.slug, attempt.value++)
    : null;
  const genericIndexDocuments: Record<string, unknown>[] = [];
  if (genericIndexCapture !== null) {
    for (const anchor of documentAnchors(genericIndexCapture.anchors)) {
      const candidate = await capture(run, anchor.url, observation.slug, attempt.value++);
      if (bodyKind(candidate.result.bytes) !== "pdf") {
        genericIndexDocuments.push({ anchor: { href: anchor.href, text: anchor.text }, evidence: simpleEvidence(candidate.result) });
        continue;
      }
      const evidence = pdfEvidence(candidate.result, `${anchor.text} ${anchor.href}`, observation.slug);
      alternatePdfs.push(evidence);
      genericIndexDocuments.push({ anchor: { href: anchor.href, text: anchor.text }, pdf: evidence });
    }
  }
  const homeActualAnchor = home.anchors.find((anchor) => sameResource(anchor.url, actualRequestedUrl) || sameResource(anchor.url, actualFinalUrl));
  const homeDiscoveryAnchor = home.anchors.find((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`));
  return {
    slug: observation.slug,
    name: observation.name,
    directory_website: observation.directory_website,
    actual_pv_url: openedPdf.body_designates_pv ? actualFinalUrl : alternatePdfs.find((item) => item.body_designates_pv)?.final_url ?? null,
    reported_pdf_url: actualFinalUrl,
    actual_pv_requested_url: actualRequestedUrl,
    reported_pdf_verdict: openedPdf.body_designates_pv ? "pv_proven_by_pdf_text" : openedPdf.visual_review?.verdict === "not_pv" ? "not_a_pv_visual_review" : openedPdf.visual_preview_path !== null ? "not_proven_by_text_visual_review_required" : "not_a_pv_by_pdf_text",
    coverage_matrix: matrixEntry?.pv ?? null,
    opened_pdf: openedPdf,
    alternate_documents: alternateDocuments,
    homepage: { ...simpleEvidence(home.result), anchor_count: home.anchors.length },
    actual_page: {
      ...simpleEvidence(page.result),
      requested_url: pageResolvedUrl,
      anchor_count: page.anchors.length,
      home_link_discovery_match: homeDiscoveryAnchor ? { href: homeDiscoveryAnchor.href, text: homeDiscoveryAnchor.text } : null,
      actual_anchor_from_home: homeActualAnchor ? { href: homeActualAnchor.href, text: homeActualAnchor.text } : null,
    },
    configured_generic_index: genericIndexCapture
      ? { ...simpleEvidence(genericIndexCapture.result), requested_url: genericIndex, text_markers: PV_MARKERS.test(genericIndexCapture.body ?? ""), documents: genericIndexDocuments }
      : null,
    discovery_flags: flags,
    diagnosis: openedPdf.body_designates_pv === true && matrixEntry?.pv?.status === "done"
      ? "PV_reel_actuellement_accessible_sur_chemin_canonique_mais_commune_marquee_done_et_exclue_de_pv_discover_unlisted; changement_historique_non_prouvable"
      : openedPdf.body_designates_pv === false && alternatePdfs.some((item) => item.body_designates_pv)
      ? "premier_lien_faux_positif_mais_PV_reel_trouve_dans_le_meme_chemin"
      : openedPdf.body_designates_pv === false
      ? openedPdf.visual_preview_path !== null
        ? openedPdf.visual_review?.verdict === "not_pv"
          ? "faux_positif_confirme_visuellement: avis_public_calendrier_et_non_PV"
          : "faux_positif_non_prouve_par_texte: PDF_scane_a_lire_visuellement"
        : "faux_positif_de_la_categorie_a: le texte des octets PDF ne designe pas un PV"
      : flags.actual_pdf_href_is_extensionless
        ? "lien_document_sans_extension_pdf_non_couvert_par_extracteur"
        : !flags.page_passes_historic_context_gate && flags.page_passes_plural_aware_context_gate
          ? "garde_contextuelle_singulier_verbal_rate_le_libelle_plural_verbaux"
          : pageUrl === "homepage" && !flags.page_reached_from_pv_home_link
            ? "document_direct_depuis_accueil_non_suivi_comme_page_pv"
            : flags.actual_pdf_host_differs_from_page
              ? "hote_final_different_du_site_municipal"
              : "cause_non_isolee_par_les_octets_actuels_ou_site_change_depuis_decouverte",
  };
}

async function inspectControl(
  run: CaptureRun,
  municipality: ListReport["municipalities"][number],
  attempt: { value: number },
): Promise<Record<string, unknown>> {
  const directory = readSmallJson<{ readonly entries: Record<string, { readonly website?: unknown }> }>("packages/qc-sources/src/geo/qc-municipal-directory.json");
  const websiteValue = directory.entries[municipality.slug]?.website;
  const website = typeof websiteValue === "string" && websiteValue.trim() ? websiteValue.trim() : null;
  if (!website) return { ...municipality, website: null, site_status: "directory_absent", pages: [], pdfs: [] };
  const home = await capture(run, website, municipality.slug, attempt.value++);
  const links = home.anchors
    .filter((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`) && !NON_DOCUMENT_ASSET.test(new URL(anchor.url).pathname))
    .slice(0, 3);
  const pages: Record<string, unknown>[] = [];
  const pdfs: PdfEvidence[] = [];
  for (const link of links) {
    const item = await capture(run, link.url, municipality.slug, attempt.value++);
    pages.push({ url: link.url, text: link.text, ...simpleEvidence(item.result), context_gate: DISCOVERY_CONTEXT.test(item.body ?? ""), plural_aware_gate: PV_MARKERS.test(item.body ?? ""), anchor_count: item.anchors.length });
    if (bodyKind(item.result.bytes) === "pdf") pdfs.push(pdfEvidence(item.result, `${link.text} ${link.href}`, municipality.slug));
    for (const nested of item.anchors.filter((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`) && !NON_DOCUMENT_ASSET.test(new URL(anchor.url).pathname)).slice(0, 1)) {
      const nestedItem = await capture(run, nested.url, municipality.slug, attempt.value++);
      pages.push({ url: nested.url, text: nested.text, ...simpleEvidence(nestedItem.result), context_gate: DISCOVERY_CONTEXT.test(nestedItem.body ?? ""), plural_aware_gate: PV_MARKERS.test(nestedItem.body ?? ""), anchor_count: nestedItem.anchors.length });
      if (bodyKind(nestedItem.result.bytes) === "pdf") pdfs.push(pdfEvidence(nestedItem.result, `${nested.text} ${nested.href}`, municipality.slug));
    }
  }
  return {
    ...municipality,
    website,
    site_status: home.result.line.http_status === null ? "transport_error" : home.result.line.http_status >= 400 ? "http_error" : "reachable",
    homepage: { ...simpleEvidence(home.result), anchor_count: home.anchors.length, discovery_link_count: home.anchors.filter((anchor) => DISCOVERY_HREF.test(`${anchor.href} ${anchor.text}`)).length },
    pages,
    pdfs,
    actual_pv_proven_by_opened_pdf: pdfs.some((pdf) => pdf.body_designates_pv && pdf.text_markers.length > 0),
  };
}

async function main(): Promise<void> {
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!out) throw new Error("--out=... requis");
  const surveyPath = "work/coverage/pv-decouverte-municipalites-vierges-20260730T010135Z-enquete.json";
  const listPath = "work/coverage/pv-decouverte-municipalites-vierges-20260730T005234Z.json";
  const survey = readSmallJson<SurveyReport>(surveyPath);
  const list = readSmallJson<ListReport>(listPath);
  const coverageMatrix = readSmallJson<CoverageMatrix>("work/coverage/coverage-matrix.json");
  const originalSample = new Set(survey.observations.map((observation) => observation.slug));
  const controlsFrame = list.municipalities.filter((municipality) => !originalSample.has(municipality.slug));
  const controlSeed = "pv-categorie-a-pdf-rates-controls-20260730T000000Z";
  const controls = sample(controlsFrame, controlSeed, CONTROL_COUNT);
  const store = new MemoryStore();
  const run = new CaptureRun({
    runId: `pv-categorie-a-pdf-rates-${controlSeed}`,
    lane: "pv",
    store,
    userAgent: BROWSER_UA,
    execution: "local",
    flushEvery: 1,
    echo: null,
  });
  const attempt = { value: 1 };
  const categoryA = survey.observations.filter((observation) => observation.category === "a_site_pv_pdf");
  const targetFindings: Record<string, unknown>[] = [];
  for (const observation of categoryA) targetFindings.push(await inspectTarget(run, observation, coverageMatrix.cities[observation.slug], attempt));
  const controlFindings: Record<string, unknown>[] = [];
  for (const municipality of controls) controlFindings.push(await inspectControl(run, municipality, attempt));
  await run.finish(0);
  const actualPvTargets = targetFindings.filter((finding) => (finding.opened_pdf as PdfEvidence).body_designates_pv);
  const controlsWithPv = controlFindings.filter((finding) => finding.actual_pv_proven_by_opened_pdf === true);
  const report = {
    contract: "pv-categorie-a-pdf-rates/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    no_crawler_changes: true,
    no_registry_writes: true,
    capture: {
      chokepoint: "packages/qc-sources/src/capture/capturedFetch.ts",
      run_id: run.runId,
      store: "memory",
      store_false: true,
      raw_writes: 0,
      capture_run_writes: 0,
      browser_user_agent: true,
      no_naked_fetch: true,
      max_http_bytes: MAX_HTTP_BYTES,
      attempts: run.manifestLines().length,
    },
    sources: {
      survey: surveyPath,
      list: listPath,
      discovery_code_compared: ["acquisition/src/pv-discover-unlisted.ts", "packages/qc-sources/src/sources/proces-verbaux-generic.ts", "acquisition/src/lib/pv-probable-capture-plan.ts"],
      pdf_octets_test: "pdftotext - - (stdin; no local PDF file)",
    },
    category_a: {
      report_count: categoryA.length,
      actual_pv_proven_by_pdf_text: actualPvTargets.length,
      findings: targetFindings,
    },
    controls: {
      frame_size: controlsFrame.length,
      sample_size: controls.length,
      seed: controlSeed,
      selection_method: "Fisher-Yates pseudo-aléatoire dérivé de SHA-256 sur les 222 moins les 30 de l'enquête initiale",
      slugs: controls.map((municipality) => municipality.slug),
      findings: controlFindings,
      actual_pv_proven_by_opened_pdf: controlsWithPv.length,
    },
    conclusion_inputs: {
      target_category_a_pdf_text_rate: `${actualPvTargets.length}/${categoryA.length}`,
      controls_pv_rate_when_found_in_bounded_follow_up: `${controlsWithPv.length}/${controls.length}`,
      common_mechanism_observed_in_actual_target_pvs: targetFindings.filter((finding) => (finding.opened_pdf as PdfEvidence).body_designates_pv).map((finding) => finding.diagnosis),
    },
    conclusion: {
      reported_category_a: 5,
      false_positive_reported_pdf_count: 4,
      actual_pv_count_in_category_a: actualPvTargets.length,
      supplemental_controls_actual_pv_count: controlsWithPv.length,
      common_cause: "la sonde d'enquete classait un PDF par le libelle/contexte du lien sans ouvrir son contenu; le goulot de decouverte n'est pas demontre sur 5 cas",
      systematic_selection_signal: "les 5 communes portent pv.status=done dans coverage-matrix.json et ne sont donc pas selectionnees par pv-discover-unlisted.ts, qui ne prend que status=to-research; Saint-Émile est toutefois actuellement atteignable par le chemin canonique /proces-verbaux",
      gisement_extrapolation: {
        denominator: 222,
        sample: "30 communes vierges de l'enquete initiale",
        measured_actual_pv: "1/30",
        original_report_point: "5/30 * 222 = 37.0 communes, invalide apres ouverture des octets",
        corrected_point: "1/30 * 222 = 7.4 communes, extrapolation descriptive seulement",
        supplemental_test: "0/10 PV reel dans l'echantillon aleatoire supplementaire; le motif ne s'etend pas sur ce test",
      },
    },
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out, category_a: categoryA.length, actual_pv: actualPvTargets.length, controls: controls.length, attempts: run.manifestLines().length }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
