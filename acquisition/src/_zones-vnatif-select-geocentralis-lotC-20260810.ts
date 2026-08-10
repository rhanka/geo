/**
 * _zones-vnatif-select-geocentralis-lotC-20260810.ts — SÉLECTION + validation LIVE
 * de la worklist LOT-C géoCentralis WFS (les ~40 munis suivants après le pilote + lot-A + lot-B).
 *
 * Read-only vis-à-vis du servi : ne lit QUE le scoping (upgradable_list) et les worklists
 * lot-A + lot-B (pour l'exclusion — les 40 lot-B ATTEMPTED, dont les 7 SKIP, restent exclus),
 * puis PROBE la source WFS en direct (GetFeature&count=1 → numberMatched) pour confirmer que
 * chaque URL rend des features avant inclusion.
 *
 * Sélection :
 *   - host = geoserver.geocentralis.com (endpoint partagé unique)
 *   - exclut les 3 pilotes {adstock, baie-comeau, beauceville} + les 40 slugs lot-A + les 40 slugs lot-B
 *   - garde l'ordre du scoping (alphabétique) → prend les LIMIT (défaut 40) suivants
 *     dont l'URL rend numberMatched>0.
 *
 * Dérivation de l'URL (réplique EXACTE de la recette lot-A/lot-B, cf. worklists) :
 *   fragment scoping `#evb:<layer>[id_municipalite=<id>]` →
 *   couche typeNames=evb:<layer>, CQL_FILTER=id_municipalite=<value> où
 *   - couche evb:siadmin_pzon_99_s → TOUJOURS quoté  '<id>'  (colonne texte)
 *   - couche evb:zonage_municipal  → quoté ssi id à zéro de tête, sinon nu (colonne num.)
 *   Le rule est déduit à 100% des worklists lot-A/B ; la validation LIVE numberMatched>0
 *   est le vrai garde (si la forme canonique rend 0, on essaie l'alternative ; sinon exclu).
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-select-geocentralis-lotC-20260810.ts \
 *     [--limit 40] --worklist-out work/coverage/zones-vnatif-capture-worklist-geocentralis-lotC-20260810.json \
 *     --diag-out work/coverage/_zones-vnatif-select-geocentralis-lotC-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "geoserver.geocentralis.com";
const PILOT = new Set(["adstock", "baie-comeau", "beauceville"]);
const PRIOR_WORKLISTS = [
  "work/coverage/zones-vnatif-capture-worklist-geocentralis-lotA-20260810.json",
  "work/coverage/zones-vnatif-capture-worklist-geocentralis-lotB-20260810.json",
];
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
const CODE_LAYERS = new Set(["evb:zonage_municipal", "evb:siadmin_pzon_99_s"]);

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }

interface Scoped { slug: string; level: string; url_host: string; endpoint_class: string; zone_source_url: string }

function loadScoping(): Scoped[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list?: Scoped[] };
  return Array.isArray(raw.upgradable_list) ? raw.upgradable_list : [];
}
function loadPriorSlugs(): Set<string> {
  const s = new Set<string>();
  for (const wl of PRIOR_WORKLISTS) {
    const raw = JSON.parse(readFileSync(resolve(ROOT, wl), "utf8")) as Array<{ slug: string }>;
    for (const t of raw) s.add(t.slug);
  }
  return s;
}

/** `...ows#evb:<layer>[id_municipalite=<id>]` → {layer, id} */
function parseFragment(url: string): { layer: string; id: string } | null {
  const m = /#(evb:[a-z0-9_]+)\[id_municipalite=([^\]]+)\]/i.exec(url);
  if (!m) return null;
  return { layer: m[1]!, id: m[2]!.trim() };
}
function buildUrl(layer: string, cql: string): string {
  return `https://${HOST}/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&outputFormat=application/json&CQL_FILTER=id_municipalite=${cql}`;
}
/** Canonical CQL value per lot-A/B rule; alternate = other quoting. */
function cqlForms(layer: string, id: string): { canonical: string; alternate: string } {
  const quoted = `%27${id}%27`;
  const bare = id;
  if (layer === "evb:siadmin_pzon_99_s") return { canonical: quoted, alternate: bare };
  // evb:zonage_municipal → quoted iff leading zero, else bare
  return id.startsWith("0") ? { canonical: quoted, alternate: bare } : { canonical: bare, alternate: quoted };
}

async function fetchNumberMatched(url: string, timeoutMs = 30_000): Promise<{ nm: number | null; status: number | null; error: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}&count=1`, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-select-probe/1" } });
    if (!res.ok) return { nm: null, status: res.status, error: `HTTP ${res.status}` };
    const gj = await res.json() as { numberMatched?: unknown };
    return { nm: typeof gj.numberMatched === "number" ? gj.numberMatched : null, status: res.status, error: null };
  } catch (e) { return { nm: null, status: null, error: (e as Error).message }; }
  finally { clearTimeout(t); }
}

async function main(): Promise<void> {
  const limit = Number(arg("limit") ?? 40);
  const worklistOut = arg("worklist-out");
  const diagOut = arg("diag-out");
  const scoping = loadScoping();
  const prior = loadPriorSlugs();
  const candidates = scoping.filter((s) => s.url_host === HOST && !PILOT.has(s.slug) && !prior.has(s.slug));
  process.stderr.write(`[select] geocentralis upgradable=${scoping.filter((s) => s.url_host === HOST).length} ; après exclusion pilote(${PILOT.size})+lotA/B(${prior.size}) = ${candidates.length} candidats\n`);

  const diag: Record<string, unknown>[] = [];
  const worklist: Array<{ slug: string; source: string; urls: string[] }> = [];
  for (const c of candidates) {
    if (worklist.length >= limit) break;
    const d: Record<string, unknown> = { slug: c.slug, level: c.level, endpoint_class: c.endpoint_class, zone_source_url: c.zone_source_url };
    const frag = parseFragment(c.zone_source_url);
    if (!frag || !CODE_LAYERS.has(frag.layer)) {
      d.included = false; d.reason = `fragment/couche non exploitable (${String(frag?.layer)})`; diag.push(d); continue;
    }
    d.layer = frag.layer; d.id_municipalite = frag.id;
    const { canonical, alternate } = cqlForms(frag.layer, frag.id);
    const canUrl = buildUrl(frag.layer, canonical);
    const canProbe = await fetchNumberMatched(canUrl);
    d.canonical_url = canUrl; d.canonical_number_matched = canProbe.nm; d.canonical_status = canProbe.status; d.canonical_error = canProbe.error;
    let chosenUrl: string | null = null; let chosenForm: string | null = null; let chosenNm: number | null = null;
    if (canProbe.nm !== null && canProbe.nm > 0) { chosenUrl = canUrl; chosenForm = "canonical"; chosenNm = canProbe.nm; }
    else {
      const altUrl = buildUrl(frag.layer, alternate);
      const altProbe = await fetchNumberMatched(altUrl);
      d.alternate_url = altUrl; d.alternate_number_matched = altProbe.nm; d.alternate_status = altProbe.status; d.alternate_error = altProbe.error;
      if (altProbe.nm !== null && altProbe.nm > 0) { chosenUrl = altUrl; chosenForm = "alternate"; chosenNm = altProbe.nm; }
    }
    if (chosenUrl) {
      d.included = true; d.chosen_form = chosenForm; d.chosen_number_matched = chosenNm; d.chosen_url = chosenUrl;
      worklist.push({ slug: c.slug, source: "zones-vnatif", urls: [chosenUrl] });
    } else {
      d.included = false; d.reason = "aucune forme (quoted/nu) ne rend numberMatched>0";
    }
    diag.push(d);
    process.stderr.write(`[select] ${c.slug} ${frag.layer} id=${frag.id} → ${d.included ? `IN (${chosenForm}, nm=${chosenNm})` : `OUT (${String(d.reason)})`}\n`);
  }

  process.stderr.write(`[select] worklist retenue = ${worklist.length} munis (limit=${limit})\n`);
  if (worklistOut) { writeFileSync(resolve(ROOT, worklistOut), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST → ${worklistOut}\n`); }
  const record = { contract: "zones-vnatif-select-geocentralis-lotC/v1", date: "2026-08-10", host: HOST, excluded: { pilot: [...PILOT], prior_count: prior.size }, limit, candidates_total: candidates.length, selected: worklist.length, diag };
  if (diagOut) { writeFileSync(resolve(ROOT, diagOut), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`DIAG → ${diagOut}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
