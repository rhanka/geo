#!/usr/bin/env tsx
/**
 * norms-vplus-grille-enum — READ-ONLY, $0, 0 LLM.
 *
 * Énumère les PDF d'une muni servie par un portail **VPlus/Modellium** en passant
 * par le FLUX NATIF de l'API, et non par la page HTML.
 *
 * Pourquoi : un portail VPlus est une **coquille Angular**. `fetch` sur
 * `/municipalite/administration/reglements` ne rend que `<vplus-app-root>` (soft-404),
 * `undici` peut même échouer en « Parse Error: Missing expected CR after header value »
 * (faux négatif d'outil : le site est VIVANT), le bucket S3 répond 403 sur toute clé
 * absente ET sur `?list-type=2`, et Wayback n'en connaît qu'une poignée de clés.
 * ⇒ Conclure « la muni ne diffuse pas sa grille » depuis la page HTML est FAUX.
 *
 * Le flux natif (mêmes endpoints que `pv-vplus-run.ts`) :
 *   GET {API}/<host>/config/pc?localisation=fr                    → routesTree (elementId par page)
 *   GET {API}/<host>/structure/detail/<elementId>?inStructure=false&localisation=fr
 *                                                                 → toutes les URL vplus-documents.s3
 *
 * Usage :
 *   npx tsx acquisition/src/norms-vplus-grille-enum.ts --slugs a,b,c [--all] [--host <h>]
 *     --all   : imprime TOUS les PDF (défaut : seulement ceux dont le nom évoque
 *               une grille / un règlement de zonage / une annexe).
 *     --host  : force l'hôte (utile quand l'annuaire est vide ou faux).
 *
 * N'écrit rien. Le nom des clés peut commencer par des ESPACES ⇒ l'URL imprimée est
 * percent-encodée et directement utilisable comme `--source-url`.
 */
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

const API = "https://vplus.modellium.com/api";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PDF_RE = /https?:\/\/vplus-documents\.s3[^"'<>\n\r]+?\.pdf/gi;
/** Ce qui vaut la peine d'être ouvert pour la lane NORMES. */
const GRILLE_RE =
  /grille|sp[ée]cification|zonage|annexe|urbanisme|usages?[-_\s.]*et[-_\s.]*normes/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

async function get(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

/** Percent-encode le nom de fichier (certaines clés portent des espaces littéraux). */
function normalizeUrl(u: string): string {
  const i = u.lastIndexOf("/");
  if (i < 0) return u;
  return u.slice(0, i + 1) + encodeURIComponent(decodeURIComponent(u.slice(i + 1)));
}

interface Node { name?: string; elementId?: string; [k: string]: unknown }

/** Tous les (name, elementId) du routesTree, dédupliqués. */
function routeNodes(raw: string): Array<{ name: string; elementId: string }> {
  let tree: unknown;
  try { tree = JSON.parse(raw); } catch { return []; }
  const seen = new Set<string>();
  const out: Array<{ name: string; elementId: string }> = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    const n = o as Node;
    if (typeof n.elementId === "string" && n.elementId && !seen.has(n.elementId)) {
      seen.add(n.elementId);
      out.push({ name: typeof n.name === "string" ? n.name.trim() : "", elementId: n.elementId });
    }
    for (const k of Object.keys(n)) walk(n[k]);
  };
  walk(tree);
  return out;
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

async function runSlug(slug: string, explicitHost?: string, all = false): Promise<void> {
  console.log(`\n### ${slug}`);
  const hosts = hostCandidates(slug, explicitHost);
  if (hosts.length === 0) { console.log("  NO-URL (annuaire vide) — passer --host"); return; }

  let host = "";
  let cfg = "";
  for (const h of hosts) {
    const r = await get(`${API}/${encodeURIComponent(h)}/config/pc?localisation=fr`);
    if (r.ok && /routesTree/i.test(r.text)) { host = h; cfg = r.text; break; }
  }
  if (!host) { console.log(`  NOT-VPLUS (config/pc introuvable pour ${hosts.join(", ")})`); return; }

  const nodes = routeNodes(cfg);
  console.log(`  host=${host} routes=${nodes.length}`);

  const found = new Map<string, string>(); // url → route name
  for (const n of nodes) {
    const r = await get(
      `${API}/${encodeURIComponent(host)}/structure/detail/${encodeURIComponent(n.elementId)}?inStructure=false&localisation=fr`,
    );
    if (!r.ok) continue;
    for (const m of r.text.matchAll(PDF_RE)) {
      const url = normalizeUrl(m[0].replace(/\\\//g, "/"));
      if (!found.has(url)) found.set(url, n.name || n.elementId);
    }
  }

  if (found.size === 0) { console.log("  0 PDF (portail vide ou routes protégées)"); return; }
  let shown = 0;
  for (const [url, route] of found) {
    let fn = url.split("/").pop() ?? url;
    try { fn = decodeURIComponent(fn); } catch { /* garder brut */ }
    if (!all && !GRILLE_RE.test(fn)) continue;
    shown++;
    console.log(`  [${route}] ${fn}\n    ${url}`);
  }
  console.log(`  ⇒ ${found.size} PDF au total, ${shown} retenus${all ? "" : " (filtre grille/zonage/annexe ; --all pour tout voir)"}`);
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("required: --slugs a,b,c");
  const explicitHost = arg("host");
  const all = hasFlag("all");
  for (const slug of slugs) await runSlug(slug, explicitHost, all);
}

void main();
