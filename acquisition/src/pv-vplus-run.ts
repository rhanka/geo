/**
 * pv-vplus-run.ts — récupère les INDEX de procès-verbaux (PV) des villes QC dont
 * le site est une SPA « vplus » (builder Modellium : `<vplus-app-root>` + assets
 * `vplus-documents.s3.ca-central-1.amazonaws.com/<slug>/…`). Ces sites NE rendent
 * RIEN d'exploitable en fetch statique ET la voie obscura (rendu headless des
 * chemins PV canoniques) échoue : la SPA route ses pages côté client par des
 * `elementId` arbitraires, jamais aux chemins `/conseil-municipal/proces-verbaux/`.
 *
 * VOIE D'API (pas de chromium) : la SPA vplus se peuple via l'API publique
 *   https://vplus.modellium.com/api/<host>/config/pc?localisation=fr
 *     → l'arbre des routes (`routesTree`) ; chaque nœud a un `name` et un `elementId`.
 *   https://vplus.modellium.com/api/<host>/structure/detail/<elementId>?inStructure=false&localisation=fr
 *     → le contenu de la page (HTML + champs) ; la page « Séances du conseil » /
 *       « Procès-verbaux » contient les liens `…/_publication/fichiers/<N> PV <date>.pdf`.
 *
 * On lit donc l'API directement (HTTP), on repère les routes PV/séances dans
 * `config/pc`, on télécharge leur `structure/detail`, et on extrait les PDF
 * `vplus-documents.s3…` dont le NOM DE FICHIER porte la convention PV de la
 * municipalité (« … PV AAAA-MM-JJ … »), en EXCLUANT les ordres-du-jour (« OJ »).
 *
 * ANTI-INVENTION STRICTE : seules des URLs `.pdf` RÉELLEMENT présentes dans la
 * réponse API sont déposées. La classe « c'est un PV » repose sur la convention
 * de nommage du fichier par la municipalité elle-même (token « PV » + une date),
 * jamais sur une URL devinée. 0 PV réel → aucun dépôt.
 *
 * RÉUTILISATION : `PvManifestEntry` (pv-gonet-run), helpers S3 (lib/s3), format
 * manifest `registry/qc-pv/<slug>/index.json` — exactement comme pv-obscura-run.
 * NE met PAS à jour la matrice (S3 = source de vérité ; coverage-reconcile suit).
 *
 * USAGE :
 *   npx tsx src/pv-vplus-run.ts --slugs saint-andre-avellin --no-deposit
 *   npx tsx src/pv-vplus-run.ts --slugs "a,b,c" --deposit
 *   npx tsx src/pv-vplus-run.ts --slugs a=www.host.qc.ca --deposit   # host explicite
 */

import { writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import type { PvManifestEntry } from "./pv-gonet-run.js";

const API = "https://vplus.modellium.com/api";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Extraction PV depuis un texte de réponse API (HTML `contenu` + champs) ──────
// NB : certaines villes servent des href NON-encodés (espaces littéraux dans le
// nom de fichier, ex. « 2-PV EXTRA FINAL.pdf ») ⇒ on autorise l'espace et on
// percent-encode l'URL retenue. On normalise aussi les slashes échappés (`\/`).
const PDF_RE = /https?:\/\/vplus-documents\.s3[^"'<>\n\r]+?\.pdf/gi;
const OJ_RE = /(?:^|[^a-z])o(?:dj|j)(?:[^a-z]|$)|ordre[-_\s.]*du[-_\s.]*jour/i;
// Accents retirés ET « s » de « procès » souvent absent dans les abréviations :
// « procès-verbal », « procs-verbal », « proc-verb », « Proc-verb-reg » → tous PV.
const PV_RE = /(?:^|[^a-z])pv(?:[^a-z]|$)|proc[eèé]?s?[-_\s.]*verb/i;
// Règlements / avis / formulaires / calendriers : pas des PV. N'exclut QUE le
// chemin « date seule » (un fichier explicitement nommé « PV » est toujours gardé).
const NONPV_RE = /\b\d{3}-\d{2}\b|r[èe]gl|avis\b|formulaire|politique|calendrier|pr[ée]visions|taxation|financ/i;
const FR_MONTHS: Record<string, string> = {
  jan: "01", fév: "02", fev: "02", mar: "03", avr: "04", mai: "05", juin: "06",
  juil: "07", aou: "08", aoû: "08", sep: "09", oct: "10", nov: "11", déc: "12", dec: "12",
};

function decodeName(url: string): string {
  const last = url.split("/").pop() ?? url;
  try { return decodeURIComponent(last); } catch { return last; }
}

/** Best-effort séance date → ISO (YYYY-MM-DD or YYYY-MM), else undefined.
 * Couvre ISO (2026-01-13), JJ-MM-AAAA/AA (15-12-2022, 26-10-22) et long FR (7 juillet 2022). */
function dateFromName(fn: string): string | undefined {
  let m = fn.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = fn.match(/\b(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}|\d{2})\b/);
  if (m) {
    const d = m[1]!.padStart(2, "0"), mo = m[2]!.padStart(2, "0");
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${mo}-${d}`;
  }
  m = fn.match(/\b(\d{1,2})(?:er)?\s+([a-zàâçéèêëîïôûù]{3,})\.?\s+(20\d{2})\b/i);
  if (m) { const mo = FR_MONTHS[m[2]!.slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[1]!.padStart(2, "0")}`; }
  return undefined;
}

/**
 * Un fichier « daté seul » est un PV SEULEMENT si son nom se réduit à une date
 * (plus d'éventuels qualificatifs de séance : ordinaire/extraordinaire/…). Sinon
 * il porte des mots descriptifs (« Dépôt de l'état des activités de fonctionnement »,
 * « rapport », « bilan »…) ⇒ ce n'est PAS un PV. Robuste aux accents retirés.
 */
function isPureDatePv(fn: string): boolean {
  const residual = fn
    .replace(/\.pdf$/i, "")
    .replace(/20\d{2}[-_.]\d{1,2}[-_.]\d{1,2}/g, " ")
    .replace(/\b\d{1,2}[-_.]\d{1,2}[-_.](?:20\d{2}|\d{2})\b/g, " ")
    .replace(/\b\d{1,2}(?:er)?\s+[a-zàâçéèêëîïôûù]{3,}\.?\s+20\d{2}\b/gi, " ")
    .replace(/s[ée]ances?|ordinaires?|extraordinaires?|sp[ée]cial[e]?s?|ajourn[ée]*|extra|reprises?|conseil|municipal[e]?|version|finale?s?|corrig[ée]*|adopt[ée]*|\bdu\b|\bde\b|\bla\b|\ble\b|\bau\b|\bet\b|\bv\d\b/gi, " ")
    .replace(/[^a-zàâçéèêëîïôûù]/gi, "")
    .trim();
  return residual.length <= 2;
}

/**
 * Real PV pdf URLs in an API response, filename-classified, OJ/règlements excluded.
 * `strong` = la route est explicitement « procès-verbaux / séances » (pas seulement
 * « conseil municipal ») : on accepte alors un PDF daté même sans token « PV »
 * (beaucoup de fichiers ne sont nommés que par leur date sur ces pages dédiées).
 * Route faible → token « PV/procès-verbal » obligatoire. Anti-invention inchangée.
 */
export function vplusPvEntriesFromApiText(text: string, strong: boolean): PvManifestEntry[] {
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  const norm = text.replace(/\\\//g, "/");
  for (const m of norm.matchAll(PDF_RE)) {
    const url = m[0].trim().replace(/ /g, "%20");
    if (seen.has(url)) continue;
    const fn = decodeName(url);
    if (OJ_RE.test(fn)) continue;            // jamais d'ordre-du-jour
    const iso = dateFromName(fn);
    const hasPvToken = PV_RE.test(fn);
    // PV-identifié : (a) token « PV/procès-verbal » explicite → toujours gardé ;
    // (b) sinon, sur une route PV dédiée, un fichier dont le nom se RÉDUIT à une
    //     date de séance (pas de mots descriptifs → pas un rapport/dépôt/règlement).
    // Hors de ces deux cas → rejeté (anti-invention : on ne dépose pas un doc non-PV).
    if (!hasPvToken && !(strong && iso && !NONPV_RE.test(fn) && isPureDatePv(fn))) continue;
    seen.add(url);
    out.push({
      url,
      title: iso ? `Procès-verbal ${iso}` : fn.replace(/\.pdf$/i, ""),
      ...(iso ? { publishedAt: iso } : {}),
      contentType: "application/pdf",
    });
  }
  return out;
}

// ── API vplus ───────────────────────────────────────────────────────────────
async function getText(url: string, timeoutMs = 25_000): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,*/*" }, signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(to);
  }
}

interface RouteNode { name?: string; elementId?: string; [k: string]: unknown }

/** Collect (name, elementId) of routes whose title looks PV / séance / conseil. */
function collectPvRoutes(tree: unknown): { name: string; elementId: string }[] {
  const hits: { name: string; elementId: string }[] = [];
  const seen = new Set<string>();
  const PV_NAME = /proc[eè]s|verba|s[ée]ance|conseil/i;
  const walk = (o: unknown): void => {
    if (o == null) return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (typeof o === "object") {
      const n = o as RouteNode;
      if (typeof n.name === "string" && typeof n.elementId === "string" && n.elementId &&
          PV_NAME.test(n.name) && !seen.has(n.elementId)) {
        seen.add(n.elementId);
        hits.push({ name: n.name.trim(), elementId: n.elementId });
      }
      for (const k of Object.keys(n)) walk(n[k]);
    }
  };
  walk(tree);
  // routes "proces/verbal/séance" first, "conseil" generic last (fallback only).
  hits.sort((a, b) => Number(/conseil/i.test(a.name) && !/proc|verba|s[ée]ance/i.test(a.name)) -
                      Number(/conseil/i.test(b.name) && !/proc|verba|s[ée]ance/i.test(b.name)));
  return hits;
}

function hostCandidates(slug: string, explicit?: string): string[] {
  if (explicit) return [explicit];
  const site = websiteForSlug(slug);
  if (!site) return [];
  let host: string;
  try { host = new URL(site).host; } catch { return []; }
  const alt = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [host, alt];
}

interface SlugResult {
  slug: string;
  host: string | null;
  status: "deposited" | "probe-ok" | "skip-existing" | "no-pv" | "not-vplus" | "no-url" | "error";
  count: number;
  routes: string[];
  detail: string;
}

async function processCity(
  slug: string, explicitHost: string | undefined, s3: S3Client | null,
  deposit: boolean, force: boolean,
): Promise<SlugResult> {
  const base: SlugResult = { slug, host: null, status: "no-url", count: 0, routes: [], detail: "" };
  const hosts = hostCandidates(slug, explicitHost);
  if (hosts.length === 0) return { ...base, detail: "aucun site (annuaire vide)" };

  if (s3 && deposit && !force && (await exists(s3, `registry/qc-pv/${slug}/index.json`))) {
    return { ...base, host: hosts[0]!, status: "skip-existing", detail: "manifest déjà en S3 (--force pour réécrire)" };
  }

  // 1) config/pc — trouver le host vplus valide + les routes PV.
  let host = "";
  let cfg = "";
  for (const h of hosts) {
    const r = await getText(`${API}/${h}/config/pc?localisation=fr`);
    if (r.ok && r.text.length > 200 && /routesTree/i.test(r.text)) { host = h; cfg = r.text; break; }
  }
  if (!host) return { ...base, host: hosts[0]!, status: "not-vplus", detail: "config/pc vplus introuvable (pas un site vplus/modellium ?)" };
  base.host = host;

  let routes: { name: string; elementId: string }[] = [];
  try { routes = collectPvRoutes(JSON.parse(cfg).routesTree); } catch { routes = []; }
  if (routes.length === 0) return { ...base, status: "no-pv", detail: "aucune route PV/séance dans routesTree" };

  // 2) structure/detail de chaque route PV → extraire les PDF PV (merge, dédupe).
  const merged = new Map<string, PvManifestEntry>();
  const usedRoutes: string[] = [];
  for (const route of routes) {
    const r = await getText(
      `${API}/${host}/structure/detail/${encodeURIComponent(route.elementId)}?inStructure=false&localisation=fr`,
    );
    if (!r.ok) continue;
    const strong = /proc|verba|s[ée]ance/i.test(route.name);
    const entries = vplusPvEntriesFromApiText(r.text, strong);
    if (entries.length > 0) usedRoutes.push(`${route.name} (${entries.length})`);
    for (const e of entries) if (!merged.has(e.url)) merged.set(e.url, e);
  }
  const entries = [...merged.values()];
  base.count = entries.length;
  base.routes = usedRoutes;
  if (entries.length === 0) return { ...base, status: "no-pv", detail: `routes PV présentes mais 0 PDF PV (élément vplus vide / autre module) — routes=${routes.map((x) => x.name).join("|")}` };

  // 3) Dépôt (ou probe si --no-deposit).
  const manifest = {
    _note:
      "PV index discovered by pv-vplus-run.ts via the vplus/modellium public API " +
      "(SPA content endpoint structure/detail). Only real vplus-documents.s3 .pdf URLs " +
      "named per the municipality's own PV convention (token 'PV' + séance date), " +
      "ordres-du-jour excluded. No fabrication.",
    _generatedAt: new Date().toISOString(),
    slug,
    sourceId: `proces-verbaux-${slug}`,
    pvIndexUrl: `https://${host}/`,
    discoveryTrack: "vplus-modellium-api",
    renderEngine: "http-api",
    host,
    routes: usedRoutes,
    count: entries.length,
    entries,
  };
  if (deposit && s3) {
    await putBytes(s3, `registry/qc-pv/${slug}/index.json`, JSON.stringify(manifest, null, 2), "application/json");
    return { ...base, status: "deposited", detail: `${entries.length} PV → s3://registry/qc-pv/${slug}/index.json` };
  }
  return { ...base, status: "probe-ok", detail: `${entries.length} PV (non déposé)` };
}

// ── Args / main ───────────────────────────────────────────────────────────────
interface Args { targets: { slug: string; host?: string }[]; deposit: boolean; force: boolean; out?: string; concurrency: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { targets: [], deposit: false, force: false, concurrency: 6 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--slugs") { a.targets = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [slug, host] = s.split("="); return { slug: slug!, ...(host ? { host } : {}) }; }); }
    else if (k === "--deposit") a.deposit = true;
    else if (k === "--no-deposit") a.deposit = false;
    else if (k === "--force") a.force = true;
    else if (k === "--concurrency") a.concurrency = Math.max(1, Number(argv[++i] ?? "6"));
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) { console.error("usage: --slugs a,b,c [--deposit] [--out file]"); process.exit(2); }
  const s3 = args.deposit ? s3Client() : null;
  console.log(`[pv-vplus] villes=${args.targets.length} deposit=${args.deposit} concurrency=${args.concurrency}`);

  const results: SlugResult[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= args.targets.length) return;
      const t = args.targets[i]!;
      let r: SlugResult;
      try { r = await processCity(t.slug, t.host, s3, args.deposit, args.force); }
      catch (e) { r = { slug: t.slug, host: null, status: "error", count: 0, routes: [], detail: e instanceof Error ? e.message : String(e) }; }
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
