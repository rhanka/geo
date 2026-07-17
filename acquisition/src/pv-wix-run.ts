/**
 * pv-wix-run.ts — lane WIX. Les municipalités QC hébergées sur Wix publient leurs
 * procès-verbaux comme BILLETS de blog (`/single-post/proces-verbal-…`) dont le PDF
 * réel est servi par le CDN Wix (`<tenant>.usrfiles.com/ugd/….pdf`). Ce PDF
 * n'apparaît NI comme `<a href>` dans le HTML statique, NI dans un rendu headless
 * PASSIF : il vit dans le JSON `warmupData` embarqué et n'est matérialisé qu'à
 * l'hydratation du widget blog. D'où 0 PV pour toutes les voies existantes :
 *   - `pv-discover-unlisted.ts` (regex `href=…\.pdf`)          → not found
 *   - `pv-site-probe.ts`        (moisson d'ancres `<a>`)       → docsPV=0
 *   - `pv-obscura-run.ts`       (rendu passif chromium)        → no-pv-rendered
 *
 * VOIE RÉELLE, 100% SERVER-SIDE (aucun chromium, aucune contention) :
 *   1. `<home>/blog-feed.xml` — flux RSS SSR de Wix : la liste RÉELLE des billets.
 *   2. filtre PV STRICT sur le titre (`procès-verbal` requis ; avis / ordre du jour /
 *      avis de motion / règlement rejetés) → jamais un avis pris pour un PV.
 *   3. fetch de chaque billet retenu → extraction des URLs PDF RÉELLEMENT présentes
 *      dans la page (CDN Wix `usrfiles.com/ugd/*.pdf` / `wixstatic.com/ugd/*.pdf`,
 *      y compris échappées `https:\/\/…` dans le JSON embarqué).
 *   4. émission d'un fichier de PAIRES {href,text} — consommé tel quel par
 *      `pv-dom-deposit.ts --pairs-file`, qui applique la garde-fou PV partagée
 *      (`pvEntriesFromRenderedDom`), le gate HEAD-live et le dépôt du manifest S3.
 *
 * RÉUTILISATION : ce script NE dépose RIEN et ne réimplémente ni le parser, ni la
 * garde-fou, ni le format manifest, ni S3 — il ne fait que produire les paires
 * réelles que la chaîne committée sait déjà déposer.
 *
 * ANTI-INVENTION : chaque href émis est une URL réellement lue dans le HTML d'un
 * billet réellement récupéré (HTTP 200) et listé par le flux RSS du site. Aucune
 * URL devinée/fabriquée. 0 billet PV → 0 paire → aucun dépôt (skip justifié).
 *
 * ROBOTS : robots.txt du site est lu et respecté (le billet ou le flux interdit est
 * sauté), conformément au régime « Robots ON ».
 *
 * USAGE :
 *   npx tsx acquisition/src/pv-wix-run.ts --slugs baie-sainte-catherine=https://www.baiestecatherine.com \
 *     --out-dir /tmp/scratch
 *   # puis, pour chaque slug avec paires > 0 :
 *   npx tsx acquisition/src/pv-dom-deposit.ts --slug baie-sainte-catherine \
 *     --pv-index-url https://www.baiestecatherine.com/conseil-municipal \
 *     --pairs-file /tmp/scratch/baie-sainte-catherine.pairs.json --deposit
 *
 * Options :
 *   --slugs a=home,b        villes ; `slug=urlAccueil` (l'accueil, pas la page PV)
 *                           OU `slug` seul → accueil résolu via l'annuaire municipal.
 *   --out-dir DIR           dossier des fichiers `<slug>.pairs.json` (défaut: cwd).
 *   --window-days N         ne garder que les billets datés ≤ N jours (0 = tous ;
 *                           défaut 0). La date vient du `pubDate` RSS.
 *   --max-posts N           plafond de billets PV visités par ville (défaut 40).
 *   --delay-ms MS           délai entre deux requêtes (défaut 1200).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

// ── Filtres PV (mêmes principes que la garde-fou partagée : PV explicite requis) ──
/** Un billet n'est un PV que si son titre porte « procès-verbal » (ou « p.v. »). */
const PV_TITLE_RE = /proc[eè]s[-\s]?verba|\bp\.?\s?v\.?\b/i;
/** Rejets durs : un avis / ODJ / avis de motion n'est PAS un procès-verbal. */
const NON_PV_TITLE_RE =
  /avis\s+public|avis\s+de\s+motion|ordre\s+du\s+jour|\bodj\b|\bagenda\b|promulgation|d[ée]rogation|appel\s+d'offres/i;
/** PDF réels du CDN Wix (les deux hôtes observés), y.c. forme échappée JSON. */
const WIX_PDF_RE =
  /https?:\/\/[a-z0-9.-]+\.(?:usrfiles|wixstatic)\.com\/ugd\/[^"'\\\s<>)]+\.pdf/gi;

interface Args {
  slugs: Array<{ slug: string; home: string }>;
  outDir: string;
  windowDays: number;
  maxPosts: number;
  delayMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, d = ""): string => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? (argv[i + 1] ?? d) : d;
  };
  const slugs = (get("slugs") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      // `slug` seul → l'accueil est résolu depuis l'annuaire municipal committé
      // (même source que pv-discover-unlisted) ; `slug=url` force l'accueil.
      if (eq < 0) return { slug: item, home: websiteForSlug(item) ?? "" };
      return { slug: item.slice(0, eq), home: item.slice(eq + 1) };
    });
  return {
    slugs,
    outDir: get("out-dir", process.cwd()),
    windowDays: Number(get("window-days", "0")),
    maxPosts: Number(get("max-posts", "40")),
    delayMs: Number(get("delay-ms", "1200")),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getText(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": PV_USER_AGENT,
        Accept: "text/html,application/xml,*/*;q=0.8",
        "Accept-Language": "fr-CA,fr;q=0.9",
      },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let body = buf.toString("utf8");
    if (body.includes("�")) body = buf.toString("latin1");
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: -1, body: e instanceof Error ? e.name : "err" };
  } finally {
    clearTimeout(timer);
  }
}

// ── robots.txt (Robots ON) ────────────────────────────────────────────────────

/** Renvoie les `Disallow:` applicables à notre UA (bloc `*` ou ciblant « radar »). */
async function robotsDisallows(origin: string): Promise<string[]> {
  const r = await getText(`${origin}/robots.txt`);
  if (!r.ok || !r.body) return [];
  const out: string[] = [];
  let active = false;
  for (const raw of r.body.split("\n")) {
    const ln = raw.trim();
    if (/^user-agent:/i.test(ln)) {
      const ua = ln.slice("user-agent:".length).trim();
      active = ua === "*" || ua.toLowerCase().includes("radar");
      continue;
    }
    if (active && /^disallow:/i.test(ln)) {
      const dis = ln.slice("disallow:".length).trim();
      if (dis) out.push(dis);
    }
  }
  return out;
}

/** Motif robots (`*` glob) → autorisé ou non pour un chemin+query donné. */
function robotsAllows(disallows: string[], pathWithQuery: string): boolean {
  for (const pat of disallows) {
    if (pat.includes("*")) {
      const rx = new RegExp(
        "^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"),
      );
      if (rx.test(pathWithQuery)) return false;
    } else if (pathWithQuery.startsWith(pat)) {
      return false;
    }
  }
  return true;
}

// ── Flux RSS Wix ──────────────────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  pubDate?: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1] ?? "";
    const title = decodeXml(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = decodeXml(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const pubDate = decodeXml(block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    if (title && /^https?:/i.test(link)) items.push({ title, link, ...(pubDate ? { pubDate } : {}) });
  }
  return items;
}

/** URLs PDF RÉELLES du CDN Wix présentes dans la page (JSON embarqué inclus). */
function wixPdfUrls(html: string): string[] {
  // Wix échappe les URLs dans le JSON embarqué (`https:\/\/…`) → dé-échapper d'abord.
  const flat = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of flat.matchAll(WIX_PDF_RE)) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runSlug(
  slug: string,
  home: string,
  args: Args,
): Promise<{ slug: string; status: string; pairs: number; out?: string; note?: string }> {
  let origin: string;
  try {
    origin = new URL(home).origin;
  } catch {
    return { slug, status: "bad-home", pairs: 0 };
  }

  const disallows = await robotsDisallows(origin);
  if (!robotsAllows(disallows, "/blog-feed.xml")) {
    return { slug, status: "robots-denied-feed", pairs: 0 };
  }

  const feed = await getText(`${origin}/blog-feed.xml`);
  if (!feed.ok || !/<rss|<item\b/i.test(feed.body)) {
    return { slug, status: "no-wix-feed", pairs: 0, note: `status=${feed.status}` };
  }

  const items = parseFeed(feed.body);
  const cutoff = args.windowDays > 0 ? Date.now() - args.windowDays * 86_400_000 : 0;
  const pvItems = items
    .filter((it) => PV_TITLE_RE.test(it.title) && !NON_PV_TITLE_RE.test(it.title))
    .filter((it) => {
      if (!cutoff || !it.pubDate) return true;
      const t = Date.parse(it.pubDate);
      return Number.isNaN(t) ? true : t >= cutoff;
    })
    .slice(0, args.maxPosts);

  if (pvItems.length === 0) {
    return { slug, status: "feed-no-pv-post", pairs: 0, note: `items=${items.length}` };
  }

  const pairs: Array<{ href: string; text: string }> = [];
  const seen = new Set<string>();
  for (const it of pvItems) {
    let p: string;
    try {
      const u = new URL(it.link);
      p = u.pathname + u.search;
    } catch {
      continue;
    }
    if (!robotsAllows(disallows, p)) continue;
    await sleep(args.delayMs);
    const post = await getText(it.link);
    if (!post.ok || !post.body) continue;
    for (const href of wixPdfUrls(post.body)) {
      if (seen.has(href)) continue;
      seen.add(href);
      pairs.push({ href, text: it.title });
    }
  }

  const outFile = join(args.outDir, `${slug}.pairs.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        home,
        _note:
          "Paires PV réelles moissonnées par pv-wix-run.ts (flux RSS Wix blog-feed.xml → billets " +
          "`procès-verbal` → URLs PDF réelles du CDN Wix lues dans la page). Aucune URL fabriquée. " +
          "Le dépôt (garde-fou PV + HEAD-live + manifest S3) est fait par pv-dom-deposit.ts --pairs-file.",
        _generatedAt: new Date().toISOString(),
        slug,
        feedItems: items.length,
        pvPosts: pvItems.length,
        n: pairs.length,
        pairs,
      },
      null,
      2,
    ) + "\n",
  );

  return {
    slug,
    status: pairs.length > 0 ? "pairs-ok" : "post-no-pdf",
    pairs: pairs.length,
    out: outFile,
    note: `pvPosts=${pvItems.length}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    console.error("usage: --slugs slug=https://home[,slug2=…] [--out-dir DIR] [--window-days N] [--max-posts N]");
    process.exit(2);
  }
  console.error(`[pv-wix] villes=${args.slugs.length} window=${args.windowDays}d maxPosts=${args.maxPosts}`);
  const results: Array<{ slug: string; status: string; pairs: number; out?: string; note?: string }> = [];
  for (const [i, s] of args.slugs.entries()) {
    if (!s.home) {
      results.push({ slug: s.slug, status: "no-home", pairs: 0 });
      console.error(`--- [${i + 1}/${args.slugs.length}] ${s.slug}: pas d'URL d'accueil (slug=home requis)`);
      continue;
    }
    const r = await runSlug(s.slug, s.home, args);
    results.push(r);
    const tag = r.status === "pairs-ok" ? "OK " : "--- ";
    console.error(`${tag}[${i + 1}/${args.slugs.length}] ${s.slug}: ${r.status} pairs=${r.pairs}${r.note ? ` (${r.note})` : ""}`);
  }
  const ok = results.filter((r) => r.status === "pairs-ok");
  console.error(`\n=== pairs-ok=${ok.length}/${results.length} : ${ok.map((r) => `${r.slug}(${r.pairs})`).join(", ") || "—"}`);
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
