/**
 * _zones-vplus-discover — $0 discovery sweep for the ZONES recalage VPlus lane
 * ([[vplus-modellium-portal-lane]], [[zones-recalage-quickwin-lane]] passe E).
 *
 * Pour les munis `zones.status != done` (matrice), détecte celles hébergées sur le
 * CMS VPlus/Modellium et extrait les PDF de PLAN DE ZONAGE téléchargeables sur
 * `vplus-documents.s3` — le gisement $0 prouvé (stukely-sud/saint-bonaventure).
 *
 * Phase 1 — VPlus ? : GET https://vplus.modellium.com/api/<host>/config/pc?localisation=fr
 *   → JSON avec routesTree ⇒ VPlus. (les non-VPlus renvoient 404/HTML/erreur, écartés.)
 * Phase 2 — pour chaque route urbanisme/zonage/reglement : GET structure/detail/<id>
 *   → HTML ; on extrait les liens `vplus-documents.s3….pdf` dont le NOM matche
 *   /zonage|carte|plan/i (le plan officiel), en excluant grille/norme/matrice/reglement seuls.
 *
 * ANTI-INVENTION : seules des URLs .pdf RÉELLEMENT présentes dans l'API sont émises.
 *
 * USAGE :
 *   npx tsx acquisition/src/_zones-vplus-discover.ts --slugs stukely-sud,saint-adelphe
 *   npx tsx acquisition/src/_zones-vplus-discover.ts --shard 0 --mod 1 --limit 60 --offset 0
 *   npx tsx acquisition/src/_zones-vplus-discover.ts --all --out work/.../out.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

const API = "https://vplus.modellium.com/api";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PDF_RE = /https?:\/\/vplus-documents\.s3[^"'<>\n\r]+?\.pdf/gi;
const ZONE_NAME = /urbanis|zonage|am[ée]nagement|r[èe]glement|plan|carte|permis|construction/i;
// Nom de fichier: on veut le PLAN de zonage (carte), pas la grille de normes seule.
const WANT_FILE = /zonage|carte|plan/i;
const REJECT_FILE = /grille|norme|matrice|proc[eè]s|verba|budget|taxe|avis|formulaire|permis|demande/i;

function arg(k: string, d?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
}
function flag(k: string): boolean {
  return process.argv.includes(`--${k}`);
}

async function getText(url: string, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; text: string }> {
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

function hostCandidates(slug: string): string[] {
  const site = websiteForSlug(slug);
  if (!site) return [];
  let host: string;
  try { host = new URL(site).host; } catch { return []; }
  const alt = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [host, alt];
}

interface RouteNode { name?: string; elementId?: string; [k: string]: unknown }
function collectZoneRoutes(tree: unknown): { name: string; elementId: string }[] {
  const hits: { name: string; elementId: string }[] = [];
  const seen = new Set<string>();
  const walk = (o: unknown): void => {
    if (o == null) return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (typeof o === "object") {
      const n = o as RouteNode;
      if (typeof n.name === "string" && typeof n.elementId === "string" && n.elementId &&
          ZONE_NAME.test(n.name) && !seen.has(n.elementId)) {
        seen.add(n.elementId);
        hits.push({ name: n.name.trim(), elementId: n.elementId });
      }
      for (const k of Object.keys(n)) walk(n[k]);
    }
  };
  walk(tree);
  return hits;
}

function decodeName(url: string): string {
  const last = url.split("/").pop() ?? url;
  try { return decodeURIComponent(last); } catch { return last; }
}

interface SlugResult {
  slug: string;
  host: string | null;
  vplus: boolean;
  routes: number;
  plans: { url: string; name: string; route: string }[];
  note: string;
}

async function detectVplus(slug: string): Promise<{ host: string | null; tree: unknown | null; note: string }> {
  const hosts = hostCandidates(slug);
  if (hosts.length === 0) return { host: null, tree: null, note: "no-site" };
  for (const host of hosts) {
    const r = await getText(`${API}/${host}/config/pc?localisation=fr`);
    if (!r.ok) continue;
    const t = r.text.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      const j = JSON.parse(t);
      return { host, tree: j, note: "vplus" };
    } catch { /* not json */ }
  }
  return { host: null, tree: null, note: "not-vplus" };
}

async function processSlug(slug: string): Promise<SlugResult> {
  const res: SlugResult = { slug, host: null, vplus: false, routes: 0, plans: [], note: "" };
  const det = await detectVplus(slug);
  if (!det.tree) { res.note = det.note; return res; }
  res.host = det.host; res.vplus = true;
  const routes = collectZoneRoutes(det.tree);
  res.routes = routes.length;
  const seenUrl = new Set<string>();
  for (const rt of routes.slice(0, 12)) {
    const r = await getText(`${API}/${det.host}/structure/detail/${rt.elementId}?inStructure=false&localisation=fr`);
    if (!r.ok) continue;
    const norm = r.text.replace(/\\\//g, "/");
    for (const m of norm.matchAll(PDF_RE)) {
      const url = m[0].trim().replace(/ /g, "%20");
      if (seenUrl.has(url)) continue;
      const fn = decodeName(url);
      if (!WANT_FILE.test(fn) || REJECT_FILE.test(fn)) continue;
      seenUrl.add(url);
      res.plans.push({ url, name: fn, route: rt.name });
    }
  }
  res.note = res.plans.length ? "PLANS" : "vplus-no-plan";
  return res;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main(): Promise<void> {
  let slugs: string[];
  const slugsArg = arg("slugs");
  if (slugsArg) {
    slugs = slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
    const cities: Record<string, any> = matrix.cities ?? {};
    const shard = Number(arg("shard", "0"));
    const mod = Number(arg("mod", "1"));
    const all = Object.keys(cities).filter((s, idx) => idx % mod === shard && cities[s]?.zones?.status !== "done");
    const offset = Number(arg("offset", "0"));
    const limit = flag("all") ? all.length : Number(arg("limit", "60"));
    slugs = all.slice(offset, offset + limit);
  }
  process.stderr.write(`[vplus-discover] ${slugs.length} slugs, conc=8\n`);
  const results = await mapLimit(slugs, 8, processSlug);
  const vplus = results.filter((r) => r.vplus);
  const withPlan = results.filter((r) => r.plans.length > 0);
  const out = { total: slugs.length, vplusCount: vplus.length, withPlanCount: withPlan.length,
    withPlan, vplusNoPlan: vplus.filter((r) => r.plans.length === 0).map((r) => ({ slug: r.slug, host: r.host, routes: r.routes })) };
  const outPath = arg("out");
  if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
