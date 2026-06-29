/**
 * pv-aoca-run.ts — récupère les INDEX de procès-verbaux (PV) des municipalités de
 * la MRC d'Abitibi-Ouest hébergées sur l'« Inforoute de la MRC d'Abitibi-Ouest »
 * (domaines `<slug>.ao.ca`, CMS ColdFusion : pages `/(fr/)page/index.cfm?PageID=N`,
 * PDF servis sous `/documents/pages/<…>.pdf`).
 *
 * POURQUOI UN OUTIL DÉDIÉ (HTTP, pas chromium) : le rendu obscura échouait sur
 * cette famille pour une raison de RÉSOLUTION D'URL, pas de JS. La page d'accueil
 * (au domaine nu) sert ses liens de menu en relatif (`page/index.cfm?PageID=N`),
 * qui ne résolvent correctement que SOUS le préfixe de langue `/fr/` ; visités au
 * domaine nu ils retombent sur `/page/…` → « Document introuvable » (404). Les
 * pages PV sont en réalité du HTML statique parfaitement lisible en `GET` une fois
 * l'URL `/fr/page/…` correcte. On fait donc un petit BFS HTTP du menu (gardé sur
 * les libellés « municipalité / conseil / séance / procès-verbaux ») et on extrait
 * les PV de chaque page rencontrée.
 *
 * STRUCTURE typique : Accueil → « La municipalité » → « Procès-verbaux » →
 * « Procès-verbaux AAAA » → liste d'ancres `<a href="…/documents/pages/…pv….pdf">
 * Procès-verbal - DATE</a>`.
 *
 * ANTI-INVENTION STRICTE : l'extraction réutilise `pvEntriesFromHtml` (pv-gonet-run),
 * le même parseur quality-gated que partout ailleurs — un lien n'est gardé que s'il
 * est PV-identifié (libellé/URL « procès-verbal / séance », ordres-du-jour exclus).
 * Seules des URLs `.pdf` RÉELLEMENT présentes dans le DOM sont déposées. 0 PV → rien.
 *
 * RÉUTILISATION : `PvManifestEntry`, helpers S3 (lib/s3), format manifest
 * `registry/qc-pv/<slug>/index.json` — exactement comme pv-vplus-run / pv-obscura-run.
 * NE met PAS à jour la matrice (S3 = source de vérité ; coverage-reconcile suit).
 *
 * USAGE :
 *   npx tsx src/pv-aoca-run.ts --slugs gallichan,poularies --no-deposit
 *   npx tsx src/pv-aoca-run.ts --slugs "a,b,c" --deposit
 *   npx tsx src/pv-aoca-run.ts --slugs gallichan=gallichan.ao.ca --deposit   # host explicite
 */

import { writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import { pvEntriesFromHtml } from "./pv-gonet-run.js";
import type { PvManifestEntry } from "./pv-gonet-run.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Libellés de menu à suivre depuis l'ACCUEIL (un cran avant le sous-menu PV) :
const NAV_BROAD_RE =
  /municipalit|conseil|administration|s[ée]ance|proc[eèé]s|verba|greffe|vie\s+d[ée]mocratique|document/i;
// Au-delà de l'accueil, on ne suit QUE ce qui mène aux PV (index + pages d'année) :
const PV_FOLLOW_RE = /proc[eèé]s|verba|s[ée]ance/i;
// Lien dont le libellé indique un contexte PV (active la collecte des PDF datés) :
const PV_LABEL_RE = /proc[eèé]s|verba|s[ée]ance|conseil/i;
// Sous-page d'année (« 2024 », « Procès-verbaux 2024 ») — suivie UNIQUEMENT depuis
// une page déjà PV-contextuelle (sinon on suivrait des « actualités 2024 », etc.).
const YEAR_RE = /\b20\d{2}\b/;
const ODJ_RE = /ordre[-_\s.]*du[-_\s.]*jour|\bo(?:dj|j)\b|\bagenda\b/i;
// Sur une page PV avérée, exclut le bruit non-PV (la séance « budget/taxation » EST
// un PV, donc PAS exclue) : ordres-du-jour, règlements, avis, calendriers, formulaires.
const PV_PAGE_NONPV_RE = /r[èe]gl|avis\b|formulaire|politique|calendrier|\bodj\b/i;
// Une date de séance dans le libellé ou le nom de fichier (FR long, JJ-MM-AAAA, ISO).
const FR_MONTHS_RE = "janv|f[eé]vr|mars|avril|mai|juin|juill|ao[uû]t|sept|octo|nov|d[eé]c";
const DATE_RE = new RegExp(
  `(?:\\b\\d{1,2}(?:er|ier)?\\s+(?:${FR_MONTHS_RE})[a-zàâçéèêëîïôûù.]*\\s+20\\d{2}` +
  `|\\b\\d{1,2}[-_.]\\d{1,2}[-_.](?:20\\d{2}|\\d{2})\\b` +
  `|\\b20\\d{2}[-_.]\\d{1,2}[-_.]\\d{1,2}\\b)`, "i",
);

/**
 * PDF datés sur une page PV AVÉRÉE (atteinte via un lien PV-libellé). Beaucoup de
 * villes ao.ca nomment leurs ancres « SÉANCE DU 2 AOÛT 2022 » ou « P.V.-signe.pdf »
 * — pas le keyword exact que `pvEntriesFromHtml` exige. Sur une page dont on SAIT
 * (par le chemin de navigation) qu'elle est « Procès-verbaux », un `.pdf` qui porte
 * une DATE de séance et n'est ni ODJ ni règlement/avis/calendrier EST un PV.
 * Anti-invention : l'URL émise est l'ancre `.pdf` RÉELLE du DOM ; jamais devinée.
 */
function pvContextPdfEntries(html: string, baseUrl: string): PvManifestEntry[] {
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']*\.pdf(?:[?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1]!.replace(/&amp;/g, "&"), baseUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    const fn = decodeURIComponent(url.split("/").pop() ?? "");
    const hay = `${label} ${fn}`;
    if (ODJ_RE.test(hay)) continue;
    if (PV_PAGE_NONPV_RE.test(hay)) continue;
    if (!DATE_RE.test(hay)) continue;           // doit porter une date de séance
    seen.add(url);
    out.push({ url, title: label || fn.replace(/\.pdf$/i, ""), contentType: "application/pdf" });
  }
  return out;
}

async function getHtml(url: string, timeoutMs = 25_000): Promise<{ ok: boolean; status: number; html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    const html = await r.text();
    return { ok: r.ok, status: r.status, html, finalUrl: r.url || url };
  } catch {
    return { ok: false, status: 0, html: "", finalUrl: url };
  } finally {
    clearTimeout(to);
  }
}

interface Anchor { url: string; label: string }

/** PageID navigation anchors (same host), with their visible label. */
function navAnchors(html: string, baseUrl: string, host: string): Anchor[] {
  const out: Anchor[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']*index\.cfm\?[^"']*PageID=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1]!.replace(/&amp;/g, "&"), baseUrl).href; } catch { continue; }
    let h: string;
    try { h = new URL(url).host; } catch { continue; }
    if (h !== host) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    out.push({ url, label });
  }
  return out;
}

interface SlugResult {
  slug: string;
  origin: string | null;
  status: "deposited" | "probe-ok" | "skip-existing" | "no-pv" | "unreachable" | "no-url" | "error";
  count: number;
  pages: number;
  detail: string;
}

async function processCity(
  slug: string, explicitHost: string | undefined, s3: S3Client | null,
  deposit: boolean, force: boolean, maxPages: number, maxDepth: number,
): Promise<SlugResult> {
  const base: SlugResult = { slug, origin: null, status: "no-url", count: 0, pages: 0, detail: "" };
  let origin = "";
  if (explicitHost) {
    origin = `https://${explicitHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  } else {
    const site = websiteForSlug(slug);
    if (!site) return { ...base, detail: "aucun site (annuaire vide)" };
    try { origin = new URL(site).origin; } catch { return { ...base, detail: `site invalide: ${site}` }; }
  }
  base.origin = origin;

  if (s3 && deposit && !force && (await exists(s3, `registry/qc-pv/${slug}/index.json`))) {
    return { ...base, status: "skip-existing", detail: "manifest déjà en S3 (--force pour réécrire)" };
  }

  // Point d'entrée : sous le préfixe de langue /fr/ (sinon les liens relatifs cassent).
  const starts = [`${origin}/fr/index.cfm`, `${origin}/fr/`, `${origin}/`];
  let startUrl = "";
  let startHtml = "";
  for (const s of starts) {
    const r = await getHtml(s);
    if (r.ok && /Inforoute de la MRC|PageID=/i.test(r.html)) { startUrl = r.finalUrl; startHtml = r.html; break; }
  }
  if (!startHtml) return { ...base, status: "unreachable", detail: `accueil /fr injoignable (essayé ${starts.length} variantes)` };

  // Host dérivé de l'URL FINALE (le site peut rediriger www↔apex) : c'est le host
  // contre lequel on filtre les liens internes, sinon une redirection www→apex fait
  // chuter TOUTES les ancres relatives (host résolu ≠ host de l'annuaire).
  let host: string;
  try { host = new URL(startUrl).host; } catch { return { ...base, status: "error", detail: "startUrl invalide" }; }

  // BFS gardé sur les libellés de menu PV. `pv` = la page est dans un contexte
  // procès-verbaux (atteinte via un lien PV-libellé) → on y collecte aussi les PDF
  // datés et on suit ses sous-pages d'année (« 2024 »).
  const merged = new Map<string, PvManifestEntry>();
  const visited = new Set<string>([startUrl]);
  const queue: { url: string; html: string; depth: number; pv: boolean }[] = [{ url: startUrl, html: startHtml, depth: 0, pv: false }];
  let pagesFetched = 1;

  while (queue.length > 0 && pagesFetched <= maxPages) {
    const node = queue.shift()!;
    for (const e of pvEntriesFromHtml(node.html, node.url)) if (!merged.has(e.url)) merged.set(e.url, e);
    if (node.pv) for (const e of pvContextPdfEntries(node.html, node.url)) if (!merged.has(e.url)) merged.set(e.url, e);
    if (node.depth >= maxDepth) continue;
    for (const a of navAnchors(node.html, node.url, host)) {
      if (visited.has(a.url)) continue;
      const hay = `${a.label} ${a.url}`;
      const isPvLabel = PV_LABEL_RE.test(hay);
      // Quoi suivre : à l'accueil, le menu large ; ensuite, les liens PV ; et — sur
      // une page DÉJÀ PV-contextuelle — les sous-pages d'année (« 2024 »).
      const follow = node.depth === 0
        ? NAV_BROAD_RE.test(hay)
        : (PV_FOLLOW_RE.test(hay) || (node.pv && YEAR_RE.test(a.label)));
      if (!follow) continue;
      visited.add(a.url);
      if (pagesFetched >= maxPages) break;
      pagesFetched++;
      const r = await getHtml(a.url);
      if (r.ok && r.html) queue.push({ url: r.finalUrl, html: r.html, depth: node.depth + 1, pv: node.pv || isPvLabel });
    }
  }

  const entries = [...merged.values()];
  base.count = entries.length;
  base.pages = pagesFetched;
  if (entries.length === 0) return { ...base, status: "no-pv", detail: `BFS ${pagesFetched} pages, 0 PV PDF (pas de section procès-verbaux ?)` };

  const manifest = {
    _note:
      "PV index discovered by pv-aoca-run.ts (MRC d'Abitibi-Ouest 'Inforoute' ColdFusion CMS, " +
      "<slug>.ao.ca). A small HTTP BFS of the /fr/ menu reaches the per-year procès-verbaux pages; " +
      "pvEntriesFromHtml (pv-gonet-run.ts) parsed real PV .pdf links, quality-gated to PV-identified " +
      "documents (ordres-du-jour excluded). No fabrication.",
    _generatedAt: new Date().toISOString(),
    slug,
    sourceId: `proces-verbaux-${slug}`,
    pvIndexUrl: startUrl,
    discoveryTrack: "mrcao-inforoute-cfm",
    renderEngine: "http",
    origin,
    pagesCrawled: pagesFetched,
    count: entries.length,
    entries,
  };
  if (deposit && s3) {
    await putBytes(s3, `registry/qc-pv/${slug}/index.json`, JSON.stringify(manifest, null, 2) + "\n", "application/json");
    return { ...base, status: "deposited", detail: `${entries.length} PV → s3://registry/qc-pv/${slug}/index.json (${pagesFetched} pages)` };
  }
  return { ...base, status: "probe-ok", detail: `${entries.length} PV (non déposé, ${pagesFetched} pages)` };
}

// ── Args / main ───────────────────────────────────────────────────────────────
interface Args { targets: { slug: string; host?: string }[]; deposit: boolean; force: boolean; out?: string; concurrency: number; maxPages: number; maxDepth: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { targets: [], deposit: false, force: false, concurrency: 4, maxPages: 80, maxDepth: 4 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--slugs") { a.targets = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [slug, host] = s.split("="); return { slug: slug!, ...(host ? { host } : {}) }; }); }
    else if (k === "--deposit") a.deposit = true;
    else if (k === "--no-deposit") a.deposit = false;
    else if (k === "--force") a.force = true;
    else if (k === "--concurrency") a.concurrency = Math.max(1, Number(argv[++i] ?? "4"));
    else if (k === "--max-pages") a.maxPages = Math.max(1, Number(argv[++i] ?? "80"));
    else if (k === "--max-depth") a.maxDepth = Math.max(1, Number(argv[++i] ?? "4"));
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) { console.error("usage: --slugs a,b,c [--deposit] [--out file]"); process.exit(2); }
  const s3 = args.deposit ? s3Client() : null;
  console.log(`[pv-aoca] villes=${args.targets.length} deposit=${args.deposit} concurrency=${args.concurrency}`);

  const results: SlugResult[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= args.targets.length) return;
      const t = args.targets[i]!;
      let r: SlugResult;
      try { r = await processCity(t.slug, t.host, s3, args.deposit, args.force, args.maxPages, args.maxDepth); }
      catch (e) { r = { slug: t.slug, origin: null, status: "error", count: 0, pages: 0, detail: e instanceof Error ? e.message : String(e) }; }
      results.push(r);
      console.log(`[${results.length}/${args.targets.length}] ${r.status.padEnd(13)} ${r.slug} :: ${r.detail}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, args.targets.length) }, () => worker()));

  const byStatus: Record<string, number> = {};
  let totalPv = 0;
  for (const r of results) { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; totalPv += r.count; }
  console.log(`\n=== STATUS ${JSON.stringify(byStatus)}  totalPV=${totalPv}`);
  const deposited = results.filter((r) => r.status === "deposited");
  console.log(`déposés=${deposited.length} [${deposited.map((r) => `${r.slug}:${r.count}`).join(", ")}]`);
  if (args.out) { writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)); console.log(`rapport → ${args.out}`); }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
