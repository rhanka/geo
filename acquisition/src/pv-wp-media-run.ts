/**
 * pv-wp-media-run.ts — discover municipal council PV PDFs exposed by a public
 * WordPress media API even when no page/menu links the files directly.
 *
 * Anti-invention: every entry comes from `/wp-json/wp/v2/media`, must be a PDF/DOC
 * media item whose title or URL is explicitly PV-identified, must not match common
 * non-PV municipal documents, and must pass a live HEAD check (GET Range fallback)
 * before deposit. Does not update coverage-matrix.json.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-wp-media-run.ts --slugs baie-johan-beetz,clarendon --no-deposit
 *   npx tsx acquisition/src/pv-wp-media-run.ts --slugs baie-johan-beetz=https://... --deposit
 */
import { writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import type { PvManifestEntry } from "./pv-gonet-run.js";

interface Target {
  slug: string;
  url?: string;
}

interface Args {
  targets: Target[];
  deposit: boolean;
  force: boolean;
  out?: string;
}

interface WpMedia {
  title?: { rendered?: string };
  source_url?: string;
  mime_type?: string;
  date?: string;
}

interface LiveResult {
  live: boolean;
  code: number | string;
  contentType?: string;
}

interface Outcome {
  slug: string;
  status: "deposited" | "probe-ok" | "skip-existing" | "no-url" | "no-wp-media" | "no-pv" | "error";
  count: number;
  apiRows: number;
  detail: string;
  sample?: PvManifestEntry[];
}

const TERMS = ["proces-verbal", "procès-verbal", "proces verbal", "procès verbal", "verbaux", "pv"];
const PV_RE = /proc[eèé]s[-_\s]*verb(?:al|aux)|\bpv\b|minutes?/i;
const NONPV_RE =
  /soumission|appel[-_\s]*d?[-_\s]*offre|r[èe]gle?ment|avis|ordre[-_\s]*du[-_\s]*jour|\bodj\b|agenda|budget|rapport|financier|taxe|calendrier|politique|formulaire|certificat/i;
const DOC_RE = /\.(?:pdf|docx?|odt)(?:[?#]|$)/i;
const DOC_CT_RE = /pdf|msword|officedocument|opendocument|octet-stream/i;

const MONTHS: Record<string, string> = {
  janvier: "01",
  février: "02",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  août: "08",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  décembre: "12",
  decembre: "12",
};

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const targets = (get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      if (eq >= 0) return { slug: item.slice(0, eq), url: item.slice(eq + 1) };
      return { slug: item };
    });
  return {
    targets,
    deposit: has("deposit") && !has("no-deposit"),
    force: has("force"),
    ...(get("out") ? { out: get("out") } : {}),
  };
}

function manifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

function stripHtml(s: string): string {
  return s
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(media: WpMedia): string {
  return stripHtml(media.title?.rendered ?? "");
}

function contentTypeFor(url: string, mime: string | undefined): string {
  if (mime) return mime;
  if (/\.pdf(?:[?#]|$)/i.test(url)) return "application/pdf";
  if (/\.docx?(?:[?#]|$)/i.test(url)) return "application/msword";
  if (/\.odt(?:[?#]|$)/i.test(url)) return "application/vnd.oasis.opendocument.text";
  return "application/octet-stream";
}

function isoFromText(s: string): string | undefined {
  const lower = s.toLowerCase();
  const iso = lower.match(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = lower.match(/\b(\d{1,2})(?:er|re|e)?[-_\s]+([a-zàâçéèêëîïôûù]+)[-_\s]+(20\d{2})\b/i);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const mo = MONTHS[dmy[2]];
    if (mo) return `${dmy[3]}-${mo}-${dmy[1].padStart(2, "0")}`;
  }
  const numeric = lower.match(/\b(\d{1,2})[-_/](\d{1,2})[-_/](20\d{2})\b/);
  if (numeric?.[1] && numeric[2] && numeric[3]) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  return undefined;
}

function isDoc(url: string, mime: string | undefined): boolean {
  return DOC_RE.test(url) || DOC_CT_RE.test(mime ?? "");
}

function isCouncilPv(media: WpMedia): boolean {
  const url = media.source_url ?? "";
  const hay = `${titleOf(media)} ${decodeURIComponent(url)}`;
  if (!isDoc(url, media.mime_type)) return false;
  if (!PV_RE.test(hay)) return false;
  if (NONPV_RE.test(hay)) return false;
  return true;
}

async function liveCheck(url: string): Promise<LiveResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  const headers = { "User-Agent": PV_USER_AGENT };
  try {
    const h = await fetch(url, { method: "HEAD", redirect: "follow", signal: ac.signal, headers });
    const hct = h.headers.get("content-type") ?? undefined;
    if (h.status >= 200 && h.status < 300 && (DOC_CT_RE.test(hct ?? "") || DOC_RE.test(url))) {
      return { live: true, code: h.status, ...(hct ? { contentType: hct } : {}) };
    }
    if ([400, 403, 405, 406, 501].includes(h.status) || !hct) {
      const g = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ac.signal,
        headers: { ...headers, Range: "bytes=0-0" },
      });
      try { await g.body?.cancel(); } catch { /* ignore */ }
      const gct = g.headers.get("content-type") ?? undefined;
      const ok = g.status >= 200 && g.status < 300 && (DOC_CT_RE.test(gct ?? "") || DOC_RE.test(url));
      return { live: ok, code: g.status, ...(gct ? { contentType: gct } : {}) };
    }
    return { live: false, code: h.status, ...(hct ? { contentType: hct } : {}) };
  } catch (e) {
    return { live: false, code: e instanceof Error ? e.name : "err" };
  } finally {
    clearTimeout(timer);
  }
}

async function wpMediaRows(baseUrl: string): Promise<WpMedia[]> {
  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const rows: WpMedia[] = [];
  for (const term of TERMS) {
    const url = new URL("/wp-json/wp/v2/media", origin);
    url.searchParams.set("search", term);
    url.searchParams.set("per_page", "100");
    try {
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": PV_USER_AGENT, accept: "application/json" },
      });
      if (!r.ok || !/json/i.test(r.headers.get("content-type") ?? "")) continue;
      const arr = (await r.json()) as unknown;
      if (!Array.isArray(arr)) continue;
      for (const row of arr as WpMedia[]) {
        const src = row.source_url ?? "";
        if (!src || seen.has(src)) continue;
        seen.add(src);
        rows.push(row);
      }
    } catch { /* ignore non-WP / blocked host */ }
  }
  return rows;
}

async function processTarget(t: Target, s3: S3Client | null, args: Args): Promise<Outcome> {
  const baseUrl = t.url ?? websiteForSlug(t.slug);
  if (!baseUrl) return { slug: t.slug, status: "no-url", count: 0, apiRows: 0, detail: "aucun site annuaire; passer slug=url" };
  const key = manifestKey(t.slug);
  if (s3 && args.deposit && !args.force && (await exists(s3, key))) {
    return { slug: t.slug, status: "skip-existing", count: 0, apiRows: 0, detail: "manifest deja en S3 (--force pour reecrire)" };
  }

  const rows = await wpMediaRows(baseUrl);
  if (rows.length === 0) return { slug: t.slug, status: "no-wp-media", count: 0, apiRows: 0, detail: "aucun media WP exploitable" };

  const entries: PvManifestEntry[] = [];
  const dropped: Array<{ url: string; code: number | string }> = [];
  for (const row of rows.filter(isCouncilPv)) {
    const url = row.source_url!;
    const live = await liveCheck(url);
    if (!live.live) {
      dropped.push({ url, code: live.code });
      continue;
    }
    const title = titleOf(row) || decodeURIComponent(url.split("/").pop() ?? url);
    const iso = isoFromText(`${title} ${url}`) ?? (row.date ? row.date.slice(0, 10) : undefined);
    entries.push({
      url,
      title,
      ...(iso ? { publishedAt: iso } : {}),
      contentType: contentTypeFor(url, row.mime_type),
    });
  }

  if (entries.length === 0) {
    return {
      slug: t.slug,
      status: "no-pv",
      count: 0,
      apiRows: rows.length,
      detail: dropped.length ? `0 PV live (${dropped.length} candidats rejetes HEAD)` : "0 media PV apres filtrage strict",
    };
  }

  const manifest = {
    _note:
      "PV index discovered by pv-wp-media-run.ts from the public WordPress media REST API " +
      "(/wp-json/wp/v2/media). Entries are real media document URLs whose title or URL is " +
      "explicitly PV-identified, common non-PV municipal documents are excluded, and every " +
      "entry was HEAD-live verified (GET Range fallback). No fabrication. coverage-matrix " +
      "is not updated here.",
    _generatedAt: new Date().toISOString(),
    slug: t.slug,
    sourceId: `proces-verbaux-${t.slug}`,
    pvIndexUrl: new URL("/wp-json/wp/v2/media", new URL(baseUrl).origin).href,
    discoveryTrack: "wp-media-api",
    renderEngine: "http-wp-rest",
    userAgent: PV_USER_AGENT,
    count: entries.length,
    verifiedAll: { live: entries.length, dropped: dropped.length },
    entries,
  };

  if (args.deposit && s3) {
    await putBytes(s3, key, JSON.stringify(manifest, null, 2) + "\n", "application/json");
    return { slug: t.slug, status: "deposited", count: entries.length, apiRows: rows.length, detail: `${entries.length} PV -> s3://${key}` };
  }
  return { slug: t.slug, status: "probe-ok", count: entries.length, apiRows: rows.length, detail: `${entries.length} PV live (non depose)`, sample: entries.slice(0, 5) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    console.error("usage: --slugs a[=url],b[=url] [--deposit|--no-deposit] [--force] [--out FILE]");
    process.exit(2);
  }
  const s3 = args.deposit ? s3Client() : null;
  console.log(`[pv-wp-media] villes=${args.targets.length} deposit=${args.deposit}`);
  const results: Outcome[] = [];
  for (const target of args.targets) {
    try {
      const r = await processTarget(target, s3, args);
      results.push(r);
      console.log(`${r.status.padEnd(13)} ${r.slug} count=${r.count} apiRows=${r.apiRows} :: ${r.detail}`);
    } catch (e) {
      const r: Outcome = {
        slug: target.slug,
        status: "error",
        count: 0,
        apiRows: 0,
        detail: e instanceof Error ? e.message : String(e),
      };
      results.push(r);
      console.log(`${r.status.padEnd(13)} ${r.slug} count=0 apiRows=0 :: ${r.detail}`);
    }
  }
  const byStatus: Record<string, number> = {};
  let totalPv = 0;
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "deposited" || r.status === "probe-ok") totalPv += r.count;
  }
  console.log(`\n=== STATUS ${JSON.stringify(byStatus)} totalPV=${totalPv}`);
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n");
    console.log(`rapport -> ${args.out}`);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
