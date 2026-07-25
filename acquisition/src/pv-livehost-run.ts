/**
 * pv-livehost-run.ts — récupère les INDEX de procès-verbaux (PV) des villes QC
 * dont le SITE VIVANT diffère du host de l'annuaire (redirection / domaine refait)
 * et/ou dont le menu d'accueil est rendu en JS (mais dont les pages PV restent du
 * HTML statique). Voie HTTP pure (pas de chromium), complémentaire de
 * `pv-obscura-run` (JS-wall) et `pv-gonet-run` (host annuaire).
 *
 * POURQUOI : beaucoup de résidus `to-research` étaient classés « morts / 0 PV » car
 * sondés au host de l'annuaire — qui 000/redirige. En SUIVANT la redirection
 * (`fetch redirect:follow`) on tombe sur le site vivant (WordPress/Divi/CMS) dont
 * la page « procès-verbaux » liste de VRAIS PDF. Deux découvertes outillées ici :
 *   1. fallback SITEMAP (`/sitemap.xml`, `/wp-sitemap.xml`) : les sites à menu JS
 *      n'exposent aucun lien PV au home, mais leur sitemap liste la vraie page
 *      (ex. `/municipalite/le-conseil/calendrier-des-seances/`).
 *   2. mode `--strict-path` : sites mutualisés multi-municipalités (un seul WP, une
 *      page `/citoyens/<muni>/proces-verbaux/` par muni) → on n'extrait QUE la page
 *      fournie + ses sous-pages de même préfixe, pour ne JAMAIS attribuer les PV
 *      d'une municipalité à une autre.
 *
 * ANTI-INVENTION STRICTE : on réutilise la garde-fou de `pv-gonet-run`
 * (`pvEntriesFromHtml`) PUIS un re-classifieur PV durci (`isRealPv`) qui exclut
 * ordres-du-jour, règlements, rapports, budgets, avis, comptes, calendriers… —
 * un fichier daté-seul n'est gardé que sur une page PV-contexte ET s'il se réduit à
 * une date de séance (`isPureDatePvTitle`). Un échantillon des entrées est
 * HEAD-vérifié LIVE (200 + content-type PDF/doc) avant tout dépôt. 0 PV réel ou
 * 0 PDF live → aucun dépôt.
 *
 * RÉUTILISATION : `PvManifestEntry`, `pvEntriesFromHtml`, `extractPvNavigationLinks`
 * (pv-gonet-run), helpers S3 (lib/s3), format manifest `registry/qc-pv/<slug>/index.json`.
 * NE met PAS à jour la matrice (S3 = source de vérité ; coverage-reconcile suit).
 *
 * USAGE :
 *   npx tsx src/pv-livehost-run.ts --slugs rouyn-noranda=https://www.rouyn-noranda.ca/ --no-deposit
 *   npx tsx src/pv-livehost-run.ts --slugs "a=https://…,b=https://…" --deposit
 *   npx tsx src/pv-livehost-run.ts --map sites.tsv --deposit            # tsv: slug<TAB>code<TAB>url
 *   npx tsx src/pv-livehost-run.ts --slugs saint-andre=…/proces-verbaux/ --strict-path --deposit
 */

import { readFileSync, writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import {
  pvEntriesFromHtml,
  extractPvNavigationLinks,
  type PvManifestEntry,
} from "./pv-gonet-run.js";
import { pvHeadingContextUrls } from "../../packages/qc-sources/src/sources/proces-verbaux-parser.js";

// Le résidu compte des sites à certificat TLS cassé qui servent pourtant un vrai
// contenu (cf. pv-deep) ; comme un navigateur lenient, on n'échoue pas sur le cert.
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Re-classifieur PV durci (anti-invention : exclut OJ/règlements/rapports) ────
const PV_TOKEN = /proc[eèé]?s?[-_\s.]*verb|(?:^|[^a-z])p\.?v\.?(?:[^a-z]|$)|\bminutes?\b/i;
const ODJ = /ordre[-_\s.]*du[-_\s.]*jour|\bodj\b|\bagenda\b|(?:^|[^a-z])o\.?j\.?(?:[^a-z]|$)/i;
const NONPV =
  /r[èe]gl|(?:^|[^a-z])res(?:[^a-z]|$)|avis\b|rapport|budget|(?:^|[^a-z])pti(?:[^a-z]|$)|comptes?\b|\bliste\b|formulaire|politique|calendrier|pr[ée]vision|taxat|financ|d[ée]penses?\b|bilan|appel[-_\s]?d?[-_\s]?offre|soumission|contrat|don[-_\s]|infolettre|bulletin|sommaire[-_\s]*decisionnel|certificat/i;

// Mois FR, y compris orthographes tronquées/sans accent des noms de fichier (fvrier, aout…).
const MONTHS =
  "janv(?:ier)?|f[ée]?vr?(?:ier)?|fvrier|mars|avr(?:il)?|mai|juin|juill?(?:et)?|ao[uû]?t|sept(?:embre)?|octo?(?:bre)?|nov(?:embre)?|d[ée]c(?:embre)?";

/** Un libellé/nom de fichier qui se RÉDUIT à une date de séance (pas un rapport). */
function isPureDatePvTitle(s: string): boolean {
  const residual = s
    .replace(/[_]+/g, " ")
    .replace(/\.(pdf|docx?|odt)\b/gi, " ")
    .replace(/20\d{2}[-./\s]\d{1,2}[-./\s]\d{1,2}/g, " ")
    .replace(/\b\d{1,2}[-./\s]\d{1,2}[-./\s](?:20\d{2}|\d{2})\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}(?:er|re|e)?\\s*(?:${MONTHS})\\.?\\s*20\\d{2}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}(?:er|re|e)?\\s*(?:${MONTHS})\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:${MONTHS})\\b`, "gi"), " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(
      /\b(?:s[ée]ances?|ordinaires?|extraordinaires?|sp[ée]cial[e]?s?|ajourn[ée]*|extra|reprises?|reguli[eè]re?s?|conseil|municipal[e]?|ville|version|finale?s?|corrig[ée]*|adopt[ée]*|publi[ée]*|le|du|de|la|au|et|mb|ko|mo|no|num[ée]ro)\b/gi,
      " ",
    )
    .replace(/[^a-zàâçéèêëîïôûù]/gi, "")
    .trim();
  return residual.length <= 2;
}

/** `pvEntriesFromHtml` garde un .pdf daté sur TOUTE page PV-contexte ; ce filtre
 * resserre : OJ jamais ; token PV → gardé ; sinon date-pure non-NONPV uniquement. */
function isRealPv(title: string, url: string, pvContext: boolean): boolean {
  const fn = decodeURIComponent((url.split("/").pop() ?? "").split(/[?#]/)[0] ?? "");
  const hay = `${title} ${fn}`;
  if (ODJ.test(hay)) return false;
  if (PV_TOKEN.test(hay)) return true; // PV explicite (même « PV - Budget 2026 »)
  if (!pvContext) return false;
  if (NONPV.test(hay)) return false;
  return isPureDatePvTitle(title) || isPureDatePvTitle(fn);
}

const PV_PATHS = [
  "/conseil-municipal/proces-verbaux/", "/municipalite/proces-verbaux/", "/proces-verbaux/",
  "/documents-publics/proces-verbaux/", "/seances-du-conseil/", "/conseil-municipal/seances-du-conseil/",
  "/vie-democratique/seances-du-conseil/", "/vie-democratique/proces-verbaux/", "/conseil-municipal/",
  "/seances-conseil/", "/seances-publiques/", "/proces-verbaux", "/fr/proces-verbaux/",
  "/municipalite/conseil-municipal/", "/la-municipalite/proces-verbaux/", "/conseil/proces-verbaux/",
  "/documents/proces-verbaux/", "/publications/proces-verbaux/", "/proces-verbaux-et-ordres-du-jour/",
  "/ordres-du-jour-et-proces-verbaux/", "/seances-du-conseil-et-proces-verbaux/",
  "/la-municipalite/conseil-municipal/", "/vie-municipale/seances-du-conseil/", "/les-proces-verbaux",
  "/municipalite/le-conseil/calendrier-des-seances/",
];

const PV_CTX_PATH =
  /proc[eè]s[-_]?verb|seances?[-_](?:du[-_])?conseil|seances?[-_]conseil|conseil[-_]municipal|calendrier[-_]des[-_]s[ée]ances?|registre[-_]des[-_]proces|\/pv[\/_-]|edocman\/proces|doccenters/i;
function pageIsPvContext(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname + url.search;
    return p !== "/" && PV_CTX_PATH.test(p);
  } catch {
    return false;
  }
}

// ── HTTP (TLS-lenient, 1 retry) ────────────────────────────────────────────────
async function getHtmlOnce(url: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(ct)) return null;
    const t = await r.text();
    return t.length > 200 ? t : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}
async function getHtml(url: string, timeoutMs = 30_000): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await getHtmlOnce(url, timeoutMs);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 800));
  }
  return null;
}

interface HarvestResult {
  slug: string;
  host: string | null;
  count: number;
  raw: number;
  pvPages: string[];
  entries: PvManifestEntry[];
}

async function harvest(slug: string, baseUrl: string, strictPath: boolean): Promise<HarvestResult> {
  const origin = new URL(baseUrl).origin;
  const baseDir = baseUrl.replace(/[^/]*$/, "");
  const inScope = (u: string): boolean => !strictPath || u.startsWith(baseDir) || u.startsWith(baseUrl);
  const home = await getHtml(baseUrl);
  const merged = new Map<string, PvManifestEntry>();
  let raw = 0;
  const pvPages = new Set<string>();
  const toVisit = new Set<string>();
  const absorb = (ents: PvManifestEntry[], pageUrl: string, html: string): void => {
    // PV context comes from the page URL OR from a « Procès-verbaux » /
    // « Séances du conseil » heading that heads the link in the DOM. The latter
    // unblocks genuine date-only PVs on pages whose URL has no PV keyword
    // (albanel /documents, saint-félix /pv2024); ODJ headings disqualify.
    const urlCtx = pageIsPvContext(pageUrl);
    const domCtx = pvHeadingContextUrls(html, pageUrl);
    let kept = 0;
    for (const e of ents) {
      raw++;
      const ctx = urlCtx || domCtx.has(e.url);
      if (!isRealPv(e.title ?? "", e.url, ctx)) continue;
      kept++;
      if (!merged.has(e.url)) merged.set(e.url, e);
    }
    if (kept) pvPages.add(pageUrl);
  };

  if (home) {
    absorb(pvEntriesFromHtml(home, baseUrl), baseUrl, home);
    for (const l of extractPvNavigationLinks(home, baseUrl)) if (inScope(l)) toVisit.add(l);
  }
  if (!strictPath) for (const p of PV_PATHS) toVisit.add(origin + p);

  // Fallback sitemap (sans chromium) : les sites à menu JS exposent quand même la
  // vraie page PV dans leur sitemap XML.
  const SITEMAP_PV =
    /proc[eè]s|verbaux|verbal|s[ée]ance|conseil|calendrier[-_]des[-_]s|vie[-_]democr|greffe|administ|gouvernance|documents?[-_]publics|publications/i;
  for (const sm of strictPath ? [] : ["/sitemap.xml", "/wp-sitemap.xml", "/sitemap_index.xml"]) {
    const idx = await getHtml(origin + sm, 15_000);
    if (!idx) continue;
    const subs = [...idx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((m) => m[1]!)
      .filter((u) => /sitemap/i.test(u) && /\.xml/i.test(u));
    const pages: string[] = [];
    const pools = subs.length ? subs.slice(0, 6) : [origin + sm];
    for (const sub of pools) {
      const body = sub === origin + sm ? idx : await getHtml(sub, 15_000);
      if (!body) continue;
      for (const m of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const u = m[1]!;
        if (/\.xml/i.test(u)) continue;
        if (SITEMAP_PV.test(u)) pages.push(u.replace(/^http:/, "https:"));
      }
    }
    for (const p of pages.slice(0, 25)) toVisit.add(p);
    if (pages.length) break;
  }

  const visited = new Set<string>([baseUrl]);
  const NOISE = /\?(month|year|day)=|\.m4a|\.mp[34]|\.jpe?g|\.png|details-evenements/i;
  const PRIO =
    /proc[eè]s[-_]?verb|verbaux|doccenters|year2|edocman|seances?[-_](?:du[-_])?conseil|archives?[-_]|\/pv[\/_-]|annee|\b20\d{2}\b/i;
  const ranked = [...toVisit]
    .filter((u) => !NOISE.test(u))
    .sort((a, b) => Number(PRIO.test(b)) - Number(PRIO.test(a)));
  const level2 = ranked.slice(0, 50);
  const deeper = new Set<string>();
  await Promise.all(
    level2.map(async (u) => {
      if (visited.has(u)) return;
      visited.add(u);
      const html = await getHtml(u);
      if (!html) return;
      absorb(pvEntriesFromHtml(html, u), u, html);
      for (const l of extractPvNavigationLinks(html, u))
        if (!visited.has(l) && !NOISE.test(l) && inScope(l)) deeper.add(l);
    }),
  );
  const level3 = [...deeper].filter((u) => !visited.has(u)).slice(0, 40);
  await Promise.all(
    level3.map(async (u) => {
      if (visited.has(u)) return;
      visited.add(u);
      const html = await getHtml(u);
      if (!html) return;
      absorb(pvEntriesFromHtml(html, u), u, html);
    }),
  );
  return { slug, host: origin, count: merged.size, raw, pvPages: [...pvPages], entries: [...merged.values()] };
}

// ── Anti-invention : un échantillon doit servir un VRAI PDF live ───────────────
async function verifyPdf(url: string, timeoutMs = 20_000): Promise<boolean> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r = await fetch(url, { method: "HEAD", headers: { "user-agent": UA }, redirect: "follow", signal: ctrl.signal });
    if (r.status === 405 || r.status === 403 || !r.headers.get("content-type")) {
      r = await fetch(url, {
        method: "GET",
        headers: { "user-agent": UA, range: "bytes=0-2048" },
        redirect: "follow",
        signal: ctrl.signal,
      });
    }
    if (!r.ok && r.status !== 206) return false;
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    return /pdf|octet-stream|msword|officedocument|opendocument/.test(ct);
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}
async function verifySample(entries: PvManifestEntry[]): Promise<{ checked: number; live: number }> {
  const step = Math.max(1, Math.floor(entries.length / 6));
  const sample = entries.filter((_, i) => i % step === 0).slice(0, 6);
  let live = 0;
  for (const e of sample) if (await verifyPdf(e.url)) live++;
  return { checked: sample.length, live };
}

// ── Args / main ────────────────────────────────────────────────────────────────
interface Args {
  targets: { slug: string; url?: string }[];
  deposit: boolean;
  force: boolean;
  strictPath: boolean;
  concurrency: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const targets: { slug: string; url?: string }[] = [];
  const slugsRaw = get("slugs");
  if (slugsRaw) {
    for (const item of slugsRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const eq = item.indexOf("=");
      if (eq >= 0) targets.push({ slug: item.slice(0, eq), url: item.slice(eq + 1) });
      else targets.push({ slug: item });
    }
  }
  const mapFile = get("map");
  if (mapFile) {
    for (const line of readFileSync(mapFile, "utf8").trim().split("\n")) {
      const cols = line.split("\t");
      if (cols.length >= 3 && /^2/.test(cols[1]!)) targets.push({ slug: cols[0]!, url: cols[2]! });
      else if (cols.length === 2) targets.push({ slug: cols[0]!, url: cols[1]! });
    }
  }
  return {
    targets,
    deposit: has("deposit"),
    force: has("force"),
    strictPath: has("strict-path"),
    concurrency: Math.max(1, Number(get("concurrency") ?? get("conc") ?? "6")),
    ...(get("out") ? { out: get("out") } : {}),
  };
}

function resolveUrl(t: { slug: string; url?: string }): string | null {
  if (t.url) return t.url;
  const site = websiteForSlug(t.slug);
  return site ?? null;
}

interface SlugOutcome {
  slug: string;
  status: "deposited" | "probe-ok" | "skip-existing" | "verify-fail" | "no-pv" | "no-url" | "error";
  count: number;
  verify: { checked: number; live: number };
  pvPages: string[];
  detail: string;
}

async function processCity(
  t: { slug: string; url?: string },
  s3: S3Client | null,
  args: Args,
): Promise<SlugOutcome> {
  const url = resolveUrl(t);
  if (!url) return { slug: t.slug, status: "no-url", count: 0, verify: { checked: 0, live: 0 }, pvPages: [], detail: "aucun site (annuaire vide ; passer slug=url)" };
  if (s3 && args.deposit && !args.force && (await exists(s3, `registry/qc-pv/${t.slug}/index.json`)))
    return { slug: t.slug, status: "skip-existing", count: 0, verify: { checked: 0, live: 0 }, pvPages: [], detail: "manifest déjà en S3 (--force pour réécrire)" };

  const r = await harvest(t.slug, url, args.strictPath);
  if (r.count === 0)
    return { slug: t.slug, status: "no-pv", count: 0, verify: { checked: 0, live: 0 }, pvPages: [], detail: `0 PV réel (raw=${r.raw})` };

  const verify = await verifySample(r.entries);
  if (args.deposit && s3) {
    if (verify.live === 0)
      return { slug: t.slug, status: "verify-fail", count: r.count, verify, pvPages: r.pvPages, detail: "aucun PDF de l'échantillon n'est live → pas de dépôt" };
    const manifest = {
      _note:
        "PV index discovered by pv-livehost-run.ts (HTTP crawl of the LIVE host, " +
        "redirect-followed) reusing pv-gonet-run's quality gate (pvEntriesFromHtml) " +
        "PLUS a strict PV re-classifier (OJ/règlements/rapports/budgets/avis excluded). " +
        "Only real .pdf/doc PV links present in the page DOM. Sample HEAD-verified live. No fabrication.",
      _generatedAt: new Date().toISOString(),
      slug: t.slug,
      sourceId: `proces-verbaux-${t.slug}`,
      pvIndexUrl: r.pvPages[0] ?? url,
      discoveryTrack: "livehost-http-crawl",
      renderEngine: "http-crawl",
      host: r.host,
      pvPages: r.pvPages,
      count: r.entries.length,
      verifiedSample: verify,
      entries: r.entries,
    };
    await putBytes(s3, `registry/qc-pv/${t.slug}/index.json`, JSON.stringify(manifest, null, 2), "application/json");
    return { slug: t.slug, status: "deposited", count: r.count, verify, pvPages: r.pvPages, detail: `${r.count} PV → s3://registry/qc-pv/${t.slug}/index.json` };
  }
  return { slug: t.slug, status: "probe-ok", count: r.count, verify, pvPages: r.pvPages, detail: `${r.count} PV (non déposé)` };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    console.error("usage: --slugs a[=url],b[=url] | --map FILE  [--deposit] [--force] [--strict-path] [--out FILE]");
    process.exit(2);
  }
  const s3 = args.deposit ? s3Client() : null;
  console.log(`[pv-livehost] villes=${args.targets.length} deposit=${args.deposit} strictPath=${args.strictPath} conc=${args.concurrency}`);

  const results: SlugOutcome[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= args.targets.length) return;
      const t = args.targets[i]!;
      let r: SlugOutcome;
      try {
        r = await processCity(t, s3, args);
      } catch (e) {
        r = { slug: t.slug, status: "error", count: 0, verify: { checked: 0, live: 0 }, pvPages: [], detail: e instanceof Error ? e.message : String(e) };
      }
      results.push(r);
      console.log(`[${results.length}/${args.targets.length}] ${r.status.padEnd(13)} ${r.slug} count=${r.count} verify=${r.verify.live}/${r.verify.checked} :: ${r.detail}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, args.targets.length) }, () => worker()));

  const byStatus: Record<string, number> = {};
  let totalPv = 0;
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "deposited" || r.status === "probe-ok") totalPv += r.count;
  }
  console.log(`\n=== STATUS ${JSON.stringify(byStatus)}  totalPV=${totalPv}`);
  const deposited = results.filter((r) => r.status === "deposited").sort((a, b) => b.count - a.count);
  console.log(`déposés=${deposited.length} [${deposited.map((r) => `${r.slug}:${r.count}`).join(", ")}]`);
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`rapport → ${args.out}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
