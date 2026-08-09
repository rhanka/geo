import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface DirEntry {
  slug?: string;
  website?: string | null;
}

interface Hit {
  slug: string;
  pageUrl: string;
  href: string;
  text: string;
  score: number;
  path?: string;
  bytes?: number;
  error?: string;
}

const REPO = resolve(import.meta.dirname, "../..");
const DIR = resolve(REPO, "packages/qc-sources/src/geo/qc-municipal-directory.json");
const PDF_ROOT = resolve(REPO, "work/zonage-norms");
function argCsv(name: string): string[] | null {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) {
    return process.argv[i + 1]!.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return null;
}
const OUT_ARG = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
})();
const OUT = OUT_ARG
  ? resolve(REPO, OUT_ARG)
  : resolve(REPO, "work/zonage-norms-focus/direct-pdf-acquisition.json");
const DEFAULT_TARGETS = [
  "dosquet",
  "saint-antoine-de-tilly",
  "saint-edouard-de-lotbiniere",
  "saint-janvier-de-joly",
  "saint-patrice-de-beaurivage",
  "saint-sylvestre",
  "sainte-agathe-de-lotbiniere",
  "saint-benjamin",
  "saint-camille-de-lellis",
  "saint-cyprien--les-etchemins",
  "saint-louis-de-gonzague--les-etchemins",
  "saint-luc-de-bellechasse",
  "saint-prosper",
  "sainte-aurelie",
  "sainte-justine",
  "sainte-rose-de-watford",
];
const TARGETS = argCsv("--slugs") ?? DEFAULT_TARGETS;

const PATHS = [
  "",
  "/urbanisme",
  "/urbanisme/",
  "/reglements",
  "/reglements/",
  "/reglementation",
  "/reglementation/",
  "/permis-et-reglements",
  "/permis-et-reglements/",
  "/services-aux-citoyens/urbanisme",
  "/services-aux-citoyens/urbanisme/",
  "/services-aux-citoyens/reglements",
  "/services-aux-citoyens/reglements/",
  "/municipalite/reglements",
  "/municipalite/reglements/",
  "/pages/urbanisme",
  "/pages/reglements",
  "/pages/reglementation",
];

function root(site: string): string {
  const u = new URL(site);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function absolute(base: string, href: string): string | null {
  try {
    return new URL(href.replace(/&amp;/g, "&"), base).toString();
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "sentropic-geo/0.1", accept: "text/html,*/*" },
      signal: AbortSignal.timeout(16000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|text|xml/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function score(text: string, href: string): number {
  const hay = `${text} ${href}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let s = 0;
  if (/grille/.test(hay)) s += 10;
  if (/specification/.test(hay)) s += 6;
  if (/zonage/.test(hay)) s += 5;
  if (/norme|usage/.test(hay)) s += 3;
  if (/urbanisme/.test(hay)) s += 2;
  if (/plan[-_ ]de[-_ ]zonage|plan[-_ ]zonage/.test(hay)) s -= 6;
  if (/proces|ordre|avis|tax|budget|seance|incendie|election|ethique/.test(hay)) s -= 8;
  if (/\.pdf(?:$|[?#])/.test(hay)) s += 3;
  return s;
}

function links(slug: string, pageUrl: string, html: string): { pages: string[]; hits: Hit[] } {
  const pages = new Set<string>();
  const hits: Hit[] = [];
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(aRe)) {
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const href = absolute(pageUrl, m[1] ?? "");
    if (!href) continue;
    const folded = `${text} ${href}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (/\.pdf(?:$|[?#])/i.test(href)) {
      const sc = score(text, href);
      if (sc >= 8) hits.push({ slug, pageUrl, href, text, score: sc });
      continue;
    }
    if (/reglement|urbanisme|zonage|permis/.test(folded)) pages.add(href);
  }
  const rawPdf = /https?:\/\/[^"' <>)]+\.pdf(?:\?[^"' <>)]+)?/gi;
  for (const m of html.matchAll(rawPdf)) {
    const href = (m[0] ?? "").replace(/&amp;/g, "&");
    const sc = score("", href);
    if (sc >= 8) hits.push({ slug, pageUrl, href, text: "", score: sc });
  }
  return { pages: [...pages], hits };
}

async function download(hit: Hit): Promise<Hit> {
  try {
    const res = await fetch(hit.href, {
      headers: { "user-agent": "sentropic-geo/0.1", accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return { ...hit, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return { ...hit, error: `too-small ${buf.length}` };
    const dir = join(PDF_ROOT, hit.slug);
    mkdirSync(dir, { recursive: true });
    const filename = decodeURIComponent(new URL(hit.href).pathname.split("/").pop() ?? "document.pdf")
      .replace(/[^\w.\-]+/g, "-")
      .slice(0, 120);
    const path = join(dir, existsSync(join(dir, "grille.pdf")) ? filename : "grille.pdf");
    writeFileSync(path, buf);
    return { ...hit, path: path.replace(`${REPO}/`, ""), bytes: buf.length };
  } catch (e) {
    return { ...hit, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  const dir = JSON.parse(readFileSync(DIR, "utf8")) as { entries?: Record<string, DirEntry> };
  const entries = Object.values(dir.entries ?? {});
  const hits: Hit[] = [];
  for (const slug of TARGETS) {
    const site = entries.find((e) => e.slug === slug)?.website;
    if (!site) continue;
    const pages = new Set(PATHS.map((p) => `${root(site)}${p}`));
    for (const page of [...pages]) {
      const html = await getText(page);
      if (!html) continue;
      const found = links(slug, page, html);
      for (const p of found.pages.slice(0, 12)) pages.add(p);
      hits.push(...found.hits);
    }
    for (const page of [...pages].slice(PATHS.length)) {
      const html = await getText(page);
      if (!html) continue;
      hits.push(...links(slug, page, html).hits);
    }
  }
  const dedup = new Map<string, Hit>();
  for (const h of hits.sort((a, b) => b.score - a.score)) {
    const key = `${h.slug}:${h.href}`;
    if (!dedup.has(key)) dedup.set(key, h);
  }
  const downloaded: Hit[] = [];
  const counts = new Map<string, number>();
  for (const h of dedup.values()) {
    const n = counts.get(h.slug) ?? 0;
    if (n >= 3) continue;
    const d = await download(h);
    downloaded.push(d);
    counts.set(h.slug, n + 1);
    console.log([d.slug, `score=${d.score}`, d.path ?? d.error ?? "", d.href, d.text].join("\t"));
  }
  writeFileSync(OUT, JSON.stringify({ hits: [...dedup.values()], downloaded }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
