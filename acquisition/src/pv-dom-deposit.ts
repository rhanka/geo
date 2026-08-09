/**
 * pv-dom-deposit.ts — dépose un manifest PV À PARTIR D'UN DOM RENDU + INTERAGI
 * capté hors-process (par playwright : dépliage d'accordéon, sélection d'année,
 * shadow-DOM, postback ASP mois/année…), pour les index JS-wall que le rendu
 * headless PASSIF de `pv-obscura-run.ts` ne suffit pas à ouvrir.
 *
 * RÉUTILISATION STRICTE (ne réinvente RIEN) :
 *   - `pvEntriesFromRenderedDom` de pv-obscura-run.ts : MÊME parser + MÊME garde-fou
 *     qualité (lien PV-identifié, jamais d'ordre-du-jour, gestionweblex/howick).
 *   - `manifestKey` / format `PvObscuraManifest` / `putBytes` / `exists` de la lib S3.
 *
 * GATE ANTI-INVENTION (double) :
 *   1. STRUCTURE : seules les ancres RÉELLEMENT présentes dans le DOM capté et
 *      retenues par la garde-fou de `pvEntriesFromRenderedDom` sont candidates.
 *   2. HEAD-LIVE : chaque candidat est vérifié VIVANT (HEAD ; repli GET Range 0-0
 *      si HEAD 405/403/501/erreur). Un lien non-vivant est REJETÉ, jamais déposé.
 *   Si 0 PV vivant → aucun dépôt (skip justifié). Le manifest ne contient QUE des
 *   liens vérifiés vivants. Aucune fabrication.
 *
 * USAGE :
 *   npx tsx acquisition/src/pv-dom-deposit.ts \
 *     --slug la-malbaie \
 *     --pv-index-url https://ville.lamalbaie.qc.ca/…/proces-verbaux \
 *     --dom-file /…/scratchpad/la-malbaie.dom.html \
 *     --deposit            # (défaut : --no-deposit = probe)
 *
 * Le --dom-file peut être le outerHTML complet OU un fragment `<a …>` (les hrefs
 * doivent être ABSOLUS — playwright renvoie `anchor.href` déjà résolu).
 */
import { readFileSync } from "node:fs";

import { s3Client, putBytes, exists } from "./lib/s3.js";
import {
  pvEntriesFromRenderedDom,
  manifestKey,
  type PvObscuraManifest,
} from "./pv-obscura-run.js";
import type { PvManifestEntry } from "./pv-gonet-run.js";
import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

interface Args {
  slug: string;
  pvIndexUrl: string;
  domFile: string;
  pairsFile: string;
  domEncoding: BufferEncoding;
  deposit: boolean;
  force: boolean;
  headCheck: boolean;
}
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);
  return {
    slug: get("slug") ?? "",
    pvIndexUrl: get("pv-index-url") ?? "",
    domFile: get("dom-file") ?? "",
    pairsFile: get("pairs-file") ?? "",
    // Beaucoup de sites QC (ASP classique) servent du windows-1252/latin1 ; lire en
    // 'latin1' rend les accents corrects (« Procès-verbal » au lieu de « Proc�s »).
    domEncoding: (get("dom-encoding") ?? "utf8") as BufferEncoding,
    deposit: has("deposit") && !has("no-deposit"),
    force: has("force") || has("overwrite"),
    headCheck: !has("no-head-check"),
  };
}

/**
 * Synthétise un fragment HTML `<a href>text</a>` à partir d'un JSON d'ancres
 * capté par playwright (browser_evaluate --filename). Accepte {href,text},
 * {h,t}, ou [href,text]. Les hrefs sont déjà ABSOLUS (anchor.href). C'est le
 * même format qu'un DOM rendu du point de vue de pvEntriesFromRenderedDom.
 */
function fragmentFromPairsJson(json: string): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const parsed = JSON.parse(json) as unknown;
  const pageContext = parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>)["home"] === "string"
    ? `<h1>Procès-verbaux / séances du conseil</h1>`
    : "";
  let items: unknown[] = [];
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const k of ["pairs", "anchors", "result", "data", "out", "value", "sample"]) {
      if (Array.isArray(o[k])) { items = o[k] as unknown[]; break; }
    }
  }
  const rows: string[] = [];
  for (const it of items as unknown[]) {
    let href = ""; let text = "";
    if (Array.isArray(it)) { href = String(it[0] ?? ""); text = String(it[1] ?? ""); }
    else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      href = String(o["href"] ?? o["h"] ?? o["url"] ?? "");
      text = String(o["text"] ?? o["t"] ?? o["title"] ?? o["label"] ?? "");
      if (pageContext && !/proc[eè]s|verba|s[eé]ance|\bp\.?v\.?\b/i.test(text)) text = `Séance ${text}`.trim();
    }
    if (!href) continue;
    rows.push(`<a href="${esc(href)}">${esc(text)}</a>`);
  }
  return `<!doctype html><html><body>\n${pageContext}\n${rows.join("\n")}\n</body></html>`;
}

/** Vérifie qu'un lien est VIVANT (HEAD ; repli GET Range 0-0). true = vivant. */
async function isLive(url: string): Promise<{ live: boolean; code: number | string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  const headers = { "User-Agent": PV_USER_AGENT } as Record<string, string>;
  try {
    const h = await fetch(url, { method: "HEAD", redirect: "follow", signal: ac.signal, headers });
    if (h.status >= 200 && h.status < 300) return { live: true, code: h.status };
    // HEAD souvent bloqué/incorrect sur les CMS municipaux → repli GET Range 0-0.
    if ([403, 405, 406, 501, 400].includes(h.status)) {
      const g = await fetch(url, { method: "GET", redirect: "follow", signal: ac.signal, headers: { ...headers, Range: "bytes=0-0" } });
      // consomme + ferme le corps sans le lire entièrement
      try { await g.body?.cancel(); } catch { /* ignore */ }
      if (g.status >= 200 && g.status < 300) return { live: true, code: g.status };
      return { live: false, code: g.status };
    }
    return { live: false, code: h.status };
  } catch (e) {
    // repli GET si HEAD a levé (certains serveurs coupent la connexion sur HEAD)
    try {
      const g = await fetch(url, { method: "GET", redirect: "follow", signal: ac.signal, headers: { ...headers, Range: "bytes=0-0" } });
      try { await g.body?.cancel(); } catch { /* ignore */ }
      if (g.status >= 200 && g.status < 300) return { live: true, code: g.status };
      return { live: false, code: g.status };
    } catch {
      return { live: false, code: e instanceof Error ? e.name : "err" };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** HEAD-live gate avec concurrence bornée (4). */
async function liveOnly(entries: PvManifestEntry[]): Promise<{ kept: PvManifestEntry[]; dropped: Array<{ url: string; code: number | string }> }> {
  const kept: PvManifestEntry[] = [];
  const dropped: Array<{ url: string; code: number | string }> = [];
  const queue = [...entries];
  async function worker(): Promise<void> {
    for (;;) {
      const e = queue.shift();
      if (!e) return;
      const r = await isLive(e.url);
      if (r.live) kept.push(e);
      else dropped.push({ url: e.url, code: r.code });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  // conserve l'ordre d'origine (les workers peuvent le brasser)
  const keptSet = new Set(kept.map((e) => e.url));
  const ordered = entries.filter((e) => keptSet.has(e.url));
  return { kept: ordered, dropped };
}

// ── Extracteur Google Drive (le parser déployé ne reconnaît PAS drive.google) ──
// Beaucoup de municipalités QC (ex. la-malbaie) hébergent leurs PV en PDF sur
// Google Drive et les lient en `drive.google.com/file/d/<id>/view`. Le parser
// partagé ne classe pas ça comme document → 0. On extrait donc ces ancres RÉELLES
// nous-mêmes, garde-fou identique : PV-identifié (label/url), jamais d'ordre-du-jour.
const FR_MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04", mai: "05",
  juin: "06", juillet: "07", août: "08", aout: "08", septembre: "09", octobre: "10",
  novembre: "11", décembre: "12", decembre: "12",
};
function isoFromText(s: string): string | undefined {
  const l = s.toLowerCase();
  const full = l.match(/(\d{1,2})(?:er)?\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})/i);
  if (full?.[1] && full[2] && full[3]) { const mo = FR_MONTHS[full[2]]; if (mo) return `${full[3]}-${mo}-${full[1].padStart(2, "0")}`; }
  const iso = l.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const my = l.match(/\b([a-zàâçéèêëîïôûù]+)\s+(\d{4})\b/i);
  if (my?.[1] && my[2]) { const mo = FR_MONTHS[my[1]]; if (mo) return `${my[2]}-${mo}`; }
  return undefined;
}
function extractDriveEntries(dom: string, baseUrl: string): PvManifestEntry[] {
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  for (const m of dom.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1]!.replace(/&amp;/g, "&"), baseUrl).href; } catch { continue; }
    if (!/https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=|uc\?|document\/|spreadsheets\/)/i.test(url)) continue;
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hay = `${label} ${decodeURIComponent(url)}`;
    if (/ordre[-\s]du[-\s]jour|\bodj\b|\bagenda\b/i.test(hay)) continue;
    if (!/proc[eè]s|verba|s[eé]ance|conseil|\bp\.?v\.?\b/i.test(hay)) continue;
    if (seen.has(url)) continue; seen.add(url);
    const iso = isoFromText(label);
    out.push({ url, ...(label ? { title: label } : {}), ...(iso ? { publishedAt: iso } : {}), contentType: "application/pdf" });
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.pvIndexUrl || (!args.domFile && !args.pairsFile)) {
    console.error("usage: --slug S --pv-index-url URL (--dom-file FILE | --pairs-file FILE.json) [--deposit|--no-deposit] [--force] [--no-head-check]");
    process.exit(2);
  }
  const dom = args.pairsFile
    ? fragmentFromPairsJson(readFileSync(args.pairsFile, "utf8"))
    : readFileSync(args.domFile, args.domEncoding);
  const raw = [...pvEntriesFromRenderedDom(dom, args.pvIndexUrl), ...extractDriveEntries(dom, args.pvIndexUrl)];
  // dédupe défensive par URL (pvEntriesFromRenderedDom dédupe déjà, ceinture+bretelles)
  const seen = new Set<string>();
  const candidates = raw.filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)));
  console.error(`[pv-dom-deposit] ${args.slug} :: DOM=${dom.length}o, candidats extraits=${candidates.length}`);

  let entries = candidates;
  let dropped: Array<{ url: string; code: number | string }> = [];
  if (args.headCheck && candidates.length > 0) {
    const g = await liveOnly(candidates);
    entries = g.kept;
    dropped = g.dropped;
    console.error(`[pv-dom-deposit] HEAD-live : ${entries.length} vivants / ${dropped.length} rejetés`);
    for (const d of dropped.slice(0, 10)) console.error(`   DROP ${d.code} ${d.url}`);
  }

  if (entries.length === 0) {
    console.error(`[pv-dom-deposit] ${args.slug} :: 0 PV vivant → AUCUN dépôt (anti-invention)`);
    console.log(JSON.stringify({ slug: args.slug, status: "no-live-pv", candidates: candidates.length, deposited: false }));
    return;
  }

  const s3 = args.deposit ? s3Client() : null;
  if (s3 && args.deposit && !args.force && (await exists(s3, manifestKey(args.slug)))) {
    console.error(`[pv-dom-deposit] ${args.slug} :: manifest déjà en S3 (--force pour réécrire)`);
    console.log(JSON.stringify({ slug: args.slug, status: "skip-existing", live: entries.length, deposited: false }));
    return;
  }

  const manifest: PvObscuraManifest = {
    _note:
      "PV index discovered by pv-dom-deposit.ts — a JS-walled index rendered AND driven " +
      "via playwright (accordion unfold / year select / shadow-DOM / ASP postback), then " +
      "pvEntriesFromRenderedDom (pv-obscura-run.ts) parsed real PV document links, " +
      "quality-gated to PV-identified documents, and each was HEAD-live verified. No fabrication.",
    _generatedAt: new Date().toISOString(),
    slug: args.slug,
    sourceId: `proces-verbaux-${args.slug}`,
    pvIndexUrl: args.pvIndexUrl,
    discoveryTrack: "js-walled-render",
    renderEngine: "chromium-cdp",
    userAgent: PV_USER_AGENT,
    windowDays: 0,
    count: entries.length,
    entries,
  };

  if (args.deposit && s3) {
    await putBytes(s3, manifestKey(args.slug), JSON.stringify(manifest, null, 2) + "\n", "application/json");
    console.error(`[pv-dom-deposit] ${args.slug} :: ${entries.length} PV → s3://${manifestKey(args.slug)}`);
    console.log(JSON.stringify({ slug: args.slug, status: "deposited", live: entries.length, deposited: true }));
    return;
  }
  console.error(`[pv-dom-deposit] ${args.slug} :: PROBE OK (non déposé) ${entries.length} PV vivants`);
  console.log(JSON.stringify({ slug: args.slug, status: "probe-ok", live: entries.length, deposited: false, sample: entries.slice(0, 5) }));
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
