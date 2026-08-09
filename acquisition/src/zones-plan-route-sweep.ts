/**
 * Sweep $0 de ROUTAGE des plans PDF déjà sur disque (lane recalage zones).
 *
 * Pour chaque slug `zones.status != done` ayant un plan indexé dans work/zonage-plans,
 * on mesure — SANS aucune dépense et sans réseau — les trois faits qui décident de la
 * voie (§6 de docs/spec/zonage-georeferencement-gcp.md) :
 *
 *   1. IDENTITÉ du document (mêmes marqueurs disqualifiants que zones-doc-identity-gate) :
 *      un géoréf parfait sur un AVIS PUBLIC ou un SAD de MRC ne vaut rien.
 *   2. GÉORÉF EMBARQUÉ (`extractGeoRef`) ⇒ voie T1, la moins chère.
 *   3. ÉTIQUETTES en couche texte (`pdftotextWords` + `looksLikeZoneCode`) ⇒ `--labels text`
 *      possible ; 0 code lettré = plan-glyphes ⇒ voie vision Claude dict-gatée.
 *
 * Le but est d'ARRÊTER de grinder au hasard : ce tableau dit quels slugs sont des T1
 * immédiats (géoréf + texte), lesquels demandent seulement des lectures vision, et
 * lesquels sont de MAUVAIS DOCUMENTS à ne pas ouvrir du tout.
 *
 * Usage :
 *   npx tsx acquisition/src/zones-plan-route-sweep.ts [--limit 80] [--json] [--slugs a,b]
 *                                                     [--shard 0 --shards 3] [--with-gcp]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { extractGeoRef } from "./lib/t1-georef.js";
import { looksLikeZoneCode, pdftotextWords } from "./lib/t1-labels.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const DISQUALIFIERS: Array<{ re: RegExp; why: string }> = [
  { re: /avis\s+public/i, why: "AVIS-PUBLIC" },
  { re: /table\s+des\s+mati[eè]res/i, why: "TABLE-DES-MATIERES" },
  { re: /sch[eé]ma\s+d[’']?\s*am[eé]nagement/i, why: "SAD-REGIONAL" },
  { re: /territoire\s+non\s+organis[eé]|\bTNO\b/i, why: "TNO-MRC" },
  { re: /sans\s+valeur\s+l[eé]gale/i, why: "SANS-VALEUR-LEGALE" },
  { re: /\bPMAD\b|plan\s+m[eé]tropolitain/i, why: "PMAD" },
  { re: /proc[eè]s[-\s]verbal/i, why: "PROCES-VERBAL" },
];

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slugToNameRegex(s: string): RegExp {
  const body = s
    .replace(/--\d+$/, "")
    .split("--")[0]!
    .split("-")
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((w) => (/^(d|l)$/i.test(w) ? `${w}['’]?` : w))
    .join("[-\\s'’]*");
  return new RegExp(body, "i");
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
const nonDone = Object.keys(cities).filter((s) => (cities[s]?.zones?.status ?? "unknown") !== "done");
const byLength = [...nonDone].sort((a, b) => b.length - a.length);

function matchSlug(name: string): string | null {
  const lower = name.toLowerCase();
  return byLength.find((s) => lower.startsWith(`${s}-`) || lower.startsWith(`${s}.`)) ?? null;
}

const plansBySlug = new Map<string, { path: string; bytes: number }[]>();
for (const p of walk(resolve("work/zonage-plans"))) {
  if (!p.toLowerCase().endsWith(".pdf")) continue;
  const slug = matchSlug(p.split("/").pop()!);
  if (!slug) continue;
  let bytes = 0;
  try {
    bytes = statSync(p).size;
  } catch {
    /* ignore */
  }
  if (!plansBySlug.has(slug)) plansBySlug.set(slug, []);
  plansBySlug.get(slug)!.push({ path: p.slice(resolve(".").length + 1), bytes });
}

const gcpSlugs = new Set<string>();
for (const p of walk(resolve("work/gcp"))) {
  if (!p.endsWith(".gcp.json")) continue;
  const name = p.split("/").pop()!;
  const slug = byLength.find((s) => name === `${s}.gcp.json` || name.startsWith(`${s}.`));
  if (slug) gcpSlugs.add(slug);
}

const only = (arg("slugs", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const shard = Number(arg("shard", "NaN"));
const nShards = Number(arg("shards", "NaN"));
const limit = Number(arg("limit", "500"));

let slugs = [...plansBySlug.keys()].sort();
if (only.length) slugs = slugs.filter((s) => only.includes(s));
else if (!has("with-gcp")) slugs = slugs.filter((s) => !gcpSlugs.has(s));
if (Number.isFinite(shard) && Number.isFinite(nShards)) slugs = slugs.filter((_, i) => i % nShards === shard);
slugs = slugs.slice(0, limit);

function pdfText(path: string, last: number): string {
  try {
    return execFileSync("pdftotext", ["-f", "1", "-l", String(last), path, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch {
    return "";
  }
}

type Row = {
  slug: string;
  pdf: string;
  kb: number;
  identity: string;
  disqualifiers: string[];
  georef: string;
  letteredCodes: number;
  sampleCodes: string[];
  route: string;
};

const rows: Row[] = [];
for (const slug of slugs) {
  const plans = plansBySlug.get(slug)!.sort((a, b) => b.bytes - a.bytes);
  const best = plans[0]!;
  const row: Row = {
    slug,
    pdf: best.path,
    kb: Math.round(best.bytes / 1024),
    identity: "?",
    disqualifiers: [],
    georef: "?",
    letteredCodes: 0,
    sampleCodes: [],
    route: "?",
  };

  // 1. identité
  const text = pdfText(best.path, 4);
  const norm = deaccent(text);
  const hits = DISQUALIFIERS.filter((d) => d.re.test(norm)).map((d) => d.why);
  row.disqualifiers = hits;
  row.identity = hits.length
    ? "REJET"
    : text.trim().length < 40
      ? "INDETERMINE"
      : slugToNameRegex(slug).test(norm)
        ? "OK"
        : "SUSPECT";

  // 2. géoréf embarqué
  try {
    const geo = extractGeoRef(readFileSync(best.path));
    row.georef = geo ? `T1:${(geo as any).crsName ?? "embedded"}` : "none";
  } catch (e) {
    row.georef = `err:${String((e as Error).message).slice(0, 40)}`;
  }

  // 3. étiquettes texte
  try {
    const { words } = pdftotextWords(best.path, { page: 1 });
    const codes = new Set<string>();
    for (const w of words) if (looksLikeZoneCode(w.text)) codes.add(w.text);
    row.letteredCodes = codes.size;
    row.sampleCodes = [...codes].slice(0, 6);
  } catch {
    row.letteredCodes = -1;
  }

  row.route =
    row.identity === "REJET"
      ? "SKIP-mauvais-doc"
      : row.georef.startsWith("T1") && row.letteredCodes >= 3
        ? "T1-TEXT (immediat)"
        : row.georef.startsWith("T1")
          ? "T1-VISION (dict requis)"
          : row.letteredCodes >= 3
            ? "T2/T3 + labels text"
            : "T2/T3 + vision (dict requis)";

  rows.push(row);
  if (!has("json")) {
    console.log(
      `${row.slug}\t${row.identity}${row.disqualifiers.length ? `(${row.disqualifiers.join(",")})` : ""}\tgeoref=${row.georef}\tcodes=${row.letteredCodes}\t${row.route}\t${row.pdf}\t[${row.sampleCodes.join(" ")}]`,
    );
  }
}

if (has("json")) console.log(JSON.stringify(rows, null, 2));
else {
  const by = (r: (x: Row) => boolean) => rows.filter(r).length;
  console.log(
    `# ${rows.length} slugs sondés — T1-TEXT=${by((r) => r.route === "T1-TEXT (immediat)")} · T1-VISION=${by((r) => r.route === "T1-VISION (dict requis)")} · T2/T3-text=${by((r) => r.route === "T2/T3 + labels text")} · T2/T3-vision=${by((r) => r.route === "T2/T3 + vision (dict requis)")} · mauvais-doc=${by((r) => r.route === "SKIP-mauvais-doc")}`,
  );
}
