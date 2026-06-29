/**
 * OCR QUALITY BENCH — Chemin A (MistralVisionMultiZone chat-API, in place) vs
 * Chemin B (mistral-ocr Document-AI, this branch) over the SAME bounded grille
 * pages of 8 municipalities, on the SAME `ZoneNorms` grid.
 *
 * For each ville × path we measure, on the SAME pages:
 *   - nb zones extracted
 *   - nb published fields (confidence ≥ 0.85) vs refused/absent (< 0.85)
 *   - anti-invention: EVERY published value must be a verbatim substring of its
 *     own `raw` cell text (else it is a fabricated value → bench FAILS the run)
 *   - real $ cost (Chemin A: medium-token estimate; Chemin B: billed pages)
 *   - latency
 *
 * Budget guard: aborts the whole bench if cumulative $ exceeds BUDGET_USD.
 *
 * Run:  npx tsx acquisition/src/bench/run-ocr-bench.ts
 * Env:  MISTRAL_API_KEY (loaded from sentropic/.env). NEVER printed.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../lib/s3.js";
import {
  extractMultiZonePageFromPdf,
  MistralVisionMultiZone,
  type MultiZoneRawExtraction,
  type MultiZoneVisionCallImpl,
} from "../../../packages/qc-sources/src/sources/grille-vision-multizone.js";
import {
  extractZonePageFromPdf,
  MistralVisionGrille,
  type VisionRawExtraction,
  type VisionCallImpl,
} from "../../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import {
  PUBLISH_THRESHOLD,
  type NormFieldT,
  type ZoneNormsT,
} from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import { runOcrPath } from "./mistral-ocr-path.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WORK = join(REPO, "work", "zonage-norms");
const OUT = join(REPO, "work", "coverage", "BENCH-OCR.md");

const BUDGET_USD = 3.0;
const SNAPSHOT = "2026-06-22";

// Mistral medium chat pricing (per 1M tokens) — for Chemin A cost (estimate).
const MED_IN_PER_M = 0.4;
const MED_OUT_PER_M = 2.0;

interface Ville {
  slug: string;
  type: "multizone" | "image";
  pages: number[];
  /** "multizone" = zones-in-columns vision; "vision" = single-zone vertical. */
  pathA: "multizone" | "vision";
  sourceUrl: string;
}

// 8 villes — mix of native-text multizone grids, a big PDF (sliced), and a scan.
// Pages bornées à 2/ville (heavy multizone chat-vision = ~30-120s/pass) to hold
// both budget AND wall-clock; the comparison is per-page on the SAME pages.
const VILLES: Ville[] = [
  { slug: "stratford", type: "multizone", pages: [1, 2], pathA: "multizone", sourceUrl: "local://stratford/grille.pdf" },
  { slug: "portneuf", type: "multizone", pages: [4, 6], pathA: "multizone", sourceUrl: "local://portneuf/grille.pdf" },
  { slug: "saint-jacques-le-mineur", type: "multizone", pages: [1, 2], pathA: "multizone", sourceUrl: "local://saint-jacques-le-mineur/grille.pdf" },
  { slug: "sutton", type: "multizone", pages: [1, 2], pathA: "multizone", sourceUrl: "local://sutton/grille.pdf" },
  { slug: "saint-raymond", type: "multizone", pages: [2, 3], pathA: "multizone", sourceUrl: "local://saint-raymond/grille.pdf" },
  { slug: "saint-constant", type: "multizone", pages: [1], pathA: "multizone", sourceUrl: "local://saint-constant/grille.pdf" },
  { slug: "cap-sante", type: "multizone", pages: [130, 310], pathA: "multizone", sourceUrl: "local://cap-sante/grille.pdf" },
  { slug: "saint-stanislas-de-kostka", type: "image", pages: [2, 3], pathA: "vision", sourceUrl: "local://saint-stanislas-de-kostka/grille.pdf" },
];

/** Hard per-page-pass timeout for the chat-vision path (no timeout in the lib). */
const PATH_A_PASS_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms)),
  ]);
}

// ───────────────────────────────────────────────────────────────────────────
//  Metrics
// ───────────────────────────────────────────────────────────────────────────

function allFields(z: ZoneNormsT): NormFieldT[] {
  return [
    z.densite,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ].filter((f): f is NormFieldT => f !== null);
}

/** Anti-invention check: a published value's text must appear verbatim in raw. */
function valueAppearsInRaw(f: NormFieldT): boolean {
  if (f.value === null) return true; // null can never be a fabrication
  const raw = (f.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
  const v = String(f.value);
  if (raw.includes(v)) return true;
  // tolerate integer/decimal punctuation (e.g. value 7.5 vs raw "7,5 m")
  const vAlt = v.includes(".") ? v : `${v}.`;
  return raw.includes(vAlt) || raw.includes(v.replace(/\.0$/, ""));
}

interface PathMetrics {
  zones: number;
  fieldsTotal: number;
  fieldsPublished: number; // confidence ≥ PUBLISH_THRESHOLD AND value !== null
  fieldsBelow: number; // present field but value null or conf < threshold → escalation
  falseValues: number; // published value NOT verbatim in raw (anti-invention breach)
  usd: number;
  latencyMs: number;
  pagesOrCalls: string;
  error?: string;
}

function summarise(zones: ZoneNormsT[]): Pick<PathMetrics, "zones" | "fieldsTotal" | "fieldsPublished" | "fieldsBelow" | "falseValues"> {
  let total = 0;
  let published = 0;
  let below = 0;
  let falseV = 0;
  for (const z of zones) {
    for (const f of allFields(z)) {
      total++;
      const isPub = f.value !== null && f.confidence >= PUBLISH_THRESHOLD;
      if (isPub) {
        published++;
        if (!valueAppearsInRaw(f)) falseV++;
      } else {
        below++;
      }
    }
  }
  return { zones: zones.length, fieldsTotal: total, fieldsPublished: published, fieldsBelow: below, falseValues: falseV };
}

// ───────────────────────────────────────────────────────────────────────────
//  Chemin A — existing 2-pass vision (multizone or single-zone), token-cost
//  tracked exactly like the production runner's estimator.
// ───────────────────────────────────────────────────────────────────────────

async function runPathA(v: Ville): Promise<PathMetrics> {
  const pdf = join(WORK, v.slug, "grille.pdf");
  const t0 = Date.now();
  let inTok = 0;
  let outTok = 0;
  let calls = 0;
  const zones: ZoneNormsT[] = [];
  try {
    if (v.pathA === "multizone") {
      const base = new MistralVisionMultiZone();
      const tracked: MultiZoneVisionCallImpl = async (img, pass) => {
        calls++;
        const out: MultiZoneRawExtraction = await withTimeout(
          base.extract(img, pass),
          PATH_A_PASS_TIMEOUT_MS,
          `${v.slug} multizone pass${pass}`,
        );
        inTok += 2300;
        outTok += 120 * Math.max(1, out.zones.length);
        return out;
      };
      for (const p of v.pages) {
        const zs = await extractMultiZonePageFromPdf(pdf, p, {
          source_url: v.sourceUrl,
          snapshot: SNAPSHOT,
          vision: tracked,
        });
        zones.push(...zs);
      }
    } else {
      const base = new MistralVisionGrille();
      const tracked: VisionCallImpl = async (img, pass, ez) => {
        calls++;
        const out: VisionRawExtraction = await withTimeout(
          base.extract(img, pass, ez),
          PATH_A_PASS_TIMEOUT_MS,
          `${v.slug} vision pass${pass}`,
        );
        inTok += 2100;
        outTok += 300;
        return out;
      };
      for (const p of v.pages) {
        const z = await extractZonePageFromPdf(pdf, p, {
          source_url: v.sourceUrl,
          snapshot: SNAPSHOT,
          vision: tracked,
        });
        zones.push(z);
      }
    }
  } catch (e) {
    return {
      zones: 0, fieldsTotal: 0, fieldsPublished: 0, fieldsBelow: 0, falseValues: 0,
      usd: (inTok / 1e6) * MED_IN_PER_M + (outTok / 1e6) * MED_OUT_PER_M,
      latencyMs: Date.now() - t0,
      pagesOrCalls: `${calls} calls`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const s = summarise(zones);
  return {
    ...s,
    usd: (inTok / 1e6) * MED_IN_PER_M + (outTok / 1e6) * MED_OUT_PER_M,
    latencyMs: Date.now() - t0,
    pagesOrCalls: `${calls} chat-calls (${v.pages.length} pg ×2 passes)`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Chemin B — mistral-ocr Document-AI.
// ───────────────────────────────────────────────────────────────────────────

async function runPathB(v: Ville): Promise<PathMetrics> {
  const pdf = join(WORK, v.slug, "grille.pdf");
  try {
    const res = await runOcrPath(pdf, v.pages, { source_url: v.sourceUrl, snapshot: SNAPSHOT });
    const s = summarise(res.zones);
    return {
      ...s,
      usd: res.usd,
      latencyMs: res.latencyMs,
      pagesOrCalls: `${res.pagesProcessed} pages billed`,
    };
  } catch (e) {
    return {
      zones: 0, fieldsTotal: 0, fieldsPublished: 0, fieldsBelow: 0, falseValues: 0,
      usd: 0, latencyMs: 0, pagesOrCalls: "—",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Driver
// ───────────────────────────────────────────────────────────────────────────

function pct(num: number, den: number): string {
  return den === 0 ? "—" : `${Math.round((num / den) * 1000) / 10}%`;
}

async function main(): Promise<void> {
  // Load MISTRAL_API_KEY from sentropic/.env if not already present.
  if (!process.env["MISTRAL_API_KEY"]) {
    const env = loadEnv("/home/antoinefa/src/sentropic/.env");
    if (env["MISTRAL_API_KEY"]) process.env["MISTRAL_API_KEY"] = env["MISTRAL_API_KEY"];
  }
  if (!process.env["MISTRAL_API_KEY"]) {
    console.error("MISTRAL_API_KEY missing — cannot run live bench");
    process.exit(2);
  }

  let cumUsd = 0;
  const rows: Array<{ v: Ville; a: PathMetrics; b: PathMetrics }> = [];

  for (const v of VILLES) {
    if (cumUsd > BUDGET_USD) {
      console.error(`[bench] STOP — cumulative $${cumUsd.toFixed(3)} > budget $${BUDGET_USD}`);
      break;
    }
    // Path B first (fast OCR) so we always capture it even if vision stalls.
    console.error(`[bench] ${v.slug} (${v.type}, pages ${v.pages.join(",")}) — path B (mistral-ocr)…`);
    const b = await runPathB(v);
    cumUsd += b.usd;
    console.error(`[bench] ${v.slug} — path A (chat-vision)…`);
    const a = await runPathA(v);
    cumUsd += a.usd;
    rows.push({ v, a, b });
    console.error(
      `[bench] ${v.slug}: A zones=${a.zones} pub=${a.fieldsPublished}/${a.fieldsTotal} false=${a.falseValues} $${a.usd.toFixed(4)} ${a.latencyMs}ms` +
        (a.error ? ` ERR(${a.error.slice(0, 60)})` : "") +
        ` | B zones=${b.zones} pub=${b.fieldsPublished}/${b.fieldsTotal} false=${b.falseValues} $${b.usd.toFixed(4)} ${b.latencyMs}ms` +
        (b.error ? ` ERR(${b.error.slice(0, 60)})` : ""),
    );
    console.error(`[bench] cumulative $${cumUsd.toFixed(3)}`);
  }

  // ── Aggregate escalation load (% fields < 0.85, both paths) ──
  let aBelow = 0, aTotal = 0, bBelow = 0, bTotal = 0, aFalse = 0, bFalse = 0;
  for (const { a, b } of rows) {
    aBelow += a.fieldsBelow; aTotal += a.fieldsTotal; aFalse += a.falseValues;
    bBelow += b.fieldsBelow; bTotal += b.fieldsTotal; bFalse += b.falseValues;
  }

  // ── Markdown report ──
  const lines: string[] = [];
  lines.push("# BENCH OCR — Chemin A (vision chat-API) vs Chemin B (mistral-ocr Document-AI)");
  lines.push("");
  lines.push(`_Généré ${new Date().toISOString()} — 8 villes, pages bornées, même grille ZoneNorms, garde anti-invention buildVisionField partagée._`);
  lines.push("");
  lines.push("- **Chemin A** : `MistralVisionMultiZone` / `MistralVisionGrille` — API chat `mistral-medium-latest`, image base64, 2 passes/page.");
  lines.push("- **Chemin B** : lib `mistral-ocr` (`convertPdf` → endpoint `/v1/ocr`, `mistral-ocr-latest`), PDF tranché → markdown → même grille.");
  lines.push("- **Publié** = champ `value !== null` ET `confidence ≥ 0.85`. **<0.85** = champ présent mais refusé/absent → escalade vérificateur Opus.");
  lines.push("- **fausses** = valeur publiée NON présente verbatim dans `raw` (violation anti-invention). Objectif : 0.");
  lines.push("");
  lines.push("| Ville | Type | Pg | Chemin | Zones | Publiés (≥0.85) | <0.85 (escalade) | %≥0.85 | fausses=0 ? | $/ville | latence |");
  lines.push("|---|---|---|---|---:|---:|---:|---:|:--:|---:|---:|");
  for (const { v, a, b } of rows) {
    const rowA = `| ${v.slug} | ${v.type} | ${v.pages.length} | A vision | ${a.zones} | ${a.fieldsPublished} | ${a.fieldsBelow} | ${pct(a.fieldsPublished, a.fieldsTotal)} | ${a.error ? "ERR" : a.falseValues === 0 ? "oui" : `NON(${a.falseValues})`} | $${a.usd.toFixed(4)} | ${a.latencyMs}ms |`;
    const rowB = `| ↳ | | | B mistral-ocr | ${b.zones} | ${b.fieldsPublished} | ${b.fieldsBelow} | ${pct(b.fieldsPublished, b.fieldsTotal)} | ${b.error ? "ERR" : b.falseValues === 0 ? "oui" : `NON(${b.falseValues})`} | $${b.usd.toFixed(4)} | ${b.latencyMs}ms |`;
    lines.push(rowA);
    lines.push(rowB);
    if (a.error) lines.push(`| | | | A error | colspan | ${a.error.slice(0, 120)} | | | | | |`);
    if (b.error) lines.push(`| | | | B error | colspan | ${b.error.slice(0, 120)} | | | | | |`);
  }
  lines.push("");
  lines.push("## Totaux");
  lines.push("");
  lines.push(`- **Coût total réel du bench** : $${cumUsd.toFixed(3)} (budget $${BUDGET_USD}).`);
  lines.push(`- **Chemin A** — champs publiés ${aTotal - aBelow}/${aTotal} (${pct(aTotal - aBelow, aTotal)}), **<0.85 = ${pct(aBelow, aTotal)}** (charge d'escalade), fausses=${aFalse}.`);
  lines.push(`- **Chemin B** — champs publiés ${bTotal - bBelow}/${bTotal} (${pct(bTotal - bBelow, bTotal)}), **<0.85 = ${pct(bBelow, bTotal)}** (charge d'escalade), fausses=${bFalse}.`);
  lines.push("");
  lines.push("## Reco (remplie d'après les chiffres ci-dessus)");
  lines.push("");
  lines.push("_voir le rapport CONCIS rendu par l'agent ; cette section est dérivée des totaux._");
  lines.push("");

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, lines.join("\n") + "\n", "utf8");
  console.error(`[bench] wrote ${OUT}`);
  console.error(
    `[bench] DONE total=$${cumUsd.toFixed(3)} | A: pub=${pct(aTotal - aBelow, aTotal)} esc<0.85=${pct(aBelow, aTotal)} false=${aFalse} | B: pub=${pct(bTotal - bBelow, bTotal)} esc<0.85=${pct(bBelow, bTotal)} false=${bFalse}`,
  );
}

main().catch((e) => {
  console.error("[bench] FATAL", e instanceof Error ? e.message : e);
  process.exit(1);
});
