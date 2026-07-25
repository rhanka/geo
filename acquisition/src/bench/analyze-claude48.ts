/**
 * analyze-claude48 — post-process the Claude-4.8 normes bench results into the
 * cost/consumption deliverable requested by the coordinator:
 *
 *   per city × model:
 *     - RAW TOKENS: input (incl. image tokens = input_tokens + cache_creation +
 *       cache_read) and output, kept separate;
 *   two projections:
 *     (A) API-$   = list-price billing. total_cost_usd from the CLI is the
 *         AUTHORITATIVE figure (it prices cached image tokens correctly); a naive
 *         tokens×list-price is shown alongside for transparency.
 *     (B) SUBSCRIPTION consumption: on the OAuth Max plan the real bill is $0 —
 *         the binding limit is the rolling 5-hour window. Expressed as "N munis
 *         before the window limit" from output tokens/muni and a stated window
 *         budget assumption (--window-out-tokens, calibrate from a live
 *         rate_limit_event).
 *   projected onto the FULL residue ≈ 1066 muni-tasks (~434 zones + ~632 normes).
 *   The Claude-4.8 bench measures NORMES grilles, so the normes leg (632) is the
 *   grounded projection; the 1066 figure reuses the same per-muni cost as an
 *   upper estimate (zones/glyph reads are a different, cheaper task — flagged).
 *
 * Pure read of work/bench/claude48-results.json — no LLM, no S3.
 *
 * Usage:
 *   npx tsx acquisition/src/bench/analyze-claude48.ts \
 *      [--results work/bench/claude48-results.json] [--window-out-tokens 2000000]
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

// ── list prices ($/1M tokens) ────────────────────────────────────────────────
const OPUS48_IN = 5.0;
const OPUS48_OUT = 25.0;
// Mistral OCR-4: ~$1 / 1000 pages (Document-AI), page-billed not token-billed
const MISTRAL_OCR_USD_PER_PAGE = 0.001;

// ── residue sizing ───────────────────────────────────────────────────────────
const RESIDUE_TOTAL = 1066;
const RESIDUE_ZONES = 434;
const RESIDUE_NORMES = 632;

function arg(k: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

interface Row {
  slug: string;
  layout: string;
  windowFirst: number;
  windowLast: number;
  gridFound: boolean;
  sigZoneCodes: number;
  pagesRead: number;
  pagesFailed: number;
  zonesRead: number;
  uniqueCodes: number;
  overlap: number;
  recoupExtracted: number;
  recoupSig: number;
  publishedFieldPct: number;
  hallucinationCodes: string[];
  inTokens: number;
  outTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsdApiEquiv: number;
  seconds: number;
  existingUniqueCodes: number;
  existingPublishedPct: number;
  rateLimited: boolean;
  error?: string;
}

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function main(): void {
  const resultsPath = arg("results") ?? join(REPO, "work", "bench", "claude48-results.json");
  if (!existsSync(resultsPath)) throw new Error(`results not found: ${resultsPath}`);
  const j = JSON.parse(readFileSync(resultsPath, "utf8")) as { rows: Row[]; model?: string; effort?: string; maxPages?: number; dpi?: number };
  const rows = j.rows ?? [];
  const windowOut = Number(arg("window-out-tokens") ?? "2000000"); // Max-20x 5h assumption (calibrate)

  // Per-city derived figures. "Productive" = a city where Claude actually read a
  // grille (zonesRead>0); pure window-miss/scan cities are reported but excluded
  // from the per-muni cost/quality means (their $ is real but their coverage is 0).
  const per = rows.map((r) => {
    const inTotal = r.inTokens + r.cacheCreateTokens + r.cacheReadTokens; // input incl. image
    const naiveApiUsd = (inTotal / 1e6) * OPUS48_IN + (r.outTokens / 1e6) * OPUS48_OUT;
    return {
      slug: r.slug,
      layout: r.layout,
      window: `${r.windowFirst}-${r.windowLast}`,
      productive: r.zonesRead > 0,
      sig: r.gridFound ? r.sigZoneCodes : 0,
      zones: r.zonesRead,
      codes: r.uniqueCodes,
      overlap: r.overlap,
      recoupE: r.recoupExtracted,
      recoupSig: r.recoupSig,
      pubPct: r.publishedFieldPct,
      hallucCodes: r.gridFound && r.uniqueCodes > 0 ? r.uniqueCodes - r.overlap : 0,
      inNonCached: r.inTokens,
      cacheCreate: r.cacheCreateTokens,
      cacheRead: r.cacheReadTokens,
      inTotal,
      out: r.outTokens,
      apiUsd: r.costUsdApiEquiv, // authoritative (CLI total_cost_usd)
      naiveApiUsd,
      seconds: r.seconds,
      rateLimited: r.rateLimited,
      error: r.error,
    };
  });

  const productive = per.filter((p) => p.productive);
  const nProd = productive.length || 1;
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

  const meanApiUsd = mean(productive.map((p) => p.apiUsd));
  const meanInTotal = mean(productive.map((p) => p.inTotal));
  const meanOut = mean(productive.map((p) => p.out));
  const meanSeconds = mean(productive.map((p) => p.seconds));
  const meanRecoupE = mean(productive.map((p) => p.recoupE));
  const meanPubPct = mean(productive.map((p) => p.pubPct));
  const totalHalluc = sum(productive.map((p) => p.hallucCodes));
  const totalCodes = sum(productive.map((p) => p.codes));

  // Projections onto residue (grounded on NORMES; 1066 as upper estimate).
  const normesApiUsd = meanApiUsd * RESIDUE_NORMES;
  const fullApiUsd = meanApiUsd * RESIDUE_TOTAL;
  // Subscription: real $0; binding = 5h rolling window. munis before window limit
  // from output tokens/muni (reasoning-dominated) against the assumed window budget.
  const munisPerWindow = meanOut > 0 ? windowOut / meanOut : 0;
  const windowsForNormes = munisPerWindow > 0 ? RESIDUE_NORMES / munisPerWindow : 0;
  const windowsForFull = munisPerWindow > 0 ? RESIDUE_TOTAL / munisPerWindow : 0;

  const L: string[] = [];
  L.push("# Claude Opus 4.8 (xhigh) — tokens bruts, coût API & consommation abonnement");
  L.push("");
  L.push(`_Modèle ${j.model ?? "claude-opus-4-8"} · effort ${j.effort ?? "xhigh"} · fenêtre ≤${j.maxPages ?? 6}p · dpi ${j.dpi ?? 200} · ${rows.length} villes (${productive.length} productives)._`);
  L.push("");
  L.push("Prix liste Opus 4.8 : **$5.00/1M in · $25.00/1M out**. `input incl. image` = input_tokens + cache_creation (tuiles image) + cache_read. `API-$` = `total_cost_usd` rapporté par le CLI (fait foi ; tarifie correctement les tokens-image cachés). `API-$ naïf` = tokens×prix-liste (montré pour transparence). Abonnement OAuth (apiKeySource:none) : **facturation réelle 0 $** — la limite est la fenêtre glissante 5 h.");
  L.push("");
  L.push("## Par ville (Claude 4.8)");
  L.push("");
  L.push("| ville | layout | fen. | prod. | zones | codes | overlap | recoupE | pub% | halluc | in(noncache) | cacheCreate(img) | cacheRead | **in total** | **out** | **API-$** | API-$ naïf | s |");
  L.push("|---|---|--:|:--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const p of [...per].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const tag = p.error ? ` ⚠️${p.error}` : p.rateLimited ? " ⚠️RL" : "";
    L.push(
      `| ${p.slug}${tag} | ${p.layout} | ${p.window} | ${p.productive ? "✓" : "·"} | ${p.zones} | ${p.codes} | ${p.overlap}/${p.sig} | ${round(p.recoupE, 2)} | ${p.pubPct} | ${p.hallucCodes} | ${p.inNonCached} | ${p.cacheCreate} | ${p.cacheRead} | ${p.inTotal} | ${p.out} | ${round(p.apiUsd, 3)} | ${round(p.naiveApiUsd, 3)} | ${p.seconds} |`,
    );
  }
  L.push("");
  L.push("## Agrégats & moyennes/muni (villes productives)");
  L.push("");
  L.push(`- Villes productives : ${productive.length}/${rows.length}. Correctness : recoupExtracted moy = **${round(meanRecoupE, 3)}** (précision), publishedFieldPct moy = **${round(meanPubPct, 1)}%**, hallucinations = **${totalHalluc}/${totalCodes} codes** (${totalCodes ? round((100 * totalHalluc) / totalCodes, 1) : 0}%).`);
  L.push(`- Tokens/muni : in total (incl. image) = **${Math.round(meanInTotal)}** · out = **${Math.round(meanOut)}** (le out gonfle par le raisonnement xhigh).`);
  L.push(`- Coût/muni : **API-$ = $${round(meanApiUsd, 3)}** (fait foi) · temps = **${round(meanSeconds, 0)}s/muni**.`);
  L.push(`- Total observé : API-$ = $${round(sum(per.map((p) => p.apiUsd)), 2)} sur ${rows.length} villes ; tokens in=${sum(per.map((p) => p.inTotal))} out=${sum(per.map((p) => p.out))}.`);
  L.push("");
  L.push("## Projection sur le résidu (≈1066 tâches-muni : ~434 zones + ~632 normes)");
  L.push("");
  L.push("| modèle | tokens/muni (in/out) | API-$/muni | $ / 632 normes | $ / 1066 (est.) | conso abonnement |");
  L.push("|---|---|--:|--:|--:|---|");
  L.push(
    `| **Claude Opus 4.8** | ${Math.round(meanInTotal)}/${Math.round(meanOut)} | $${round(meanApiUsd, 3)} | **$${round(normesApiUsd, 0)}** | ~$${round(fullApiUsd, 0)} | **0 $ réel** ; ~${round(munisPerWindow, 1)} munis / fenêtre 5 h → normes en ~${round(windowsForNormes, 1)} fenêtres (${round(windowsForNormes / 4.8, 1)} j @ ~5 fen./j) |`,
  );
  L.push(`| GPT-5.5 (codex) | — | — | — | — | crédits GPT (à remplir par l'agent codex) |`);
  L.push(`| GPT-5.4 (codex) | — | — | — | — | crédits GPT (à remplir) |`);
  L.push(`| Mistral OCR-4 | ~pages | $${MISTRAL_OCR_USD_PER_PAGE}/page | ~$${round(MISTRAL_OCR_USD_PER_PAGE * RESIDUE_NORMES * 6, 2)} (6p/muni) | ~$${round(MISTRAL_OCR_USD_PER_PAGE * RESIDUE_TOTAL * 6, 2)} | crédits Mistral |`);
  L.push("");
  L.push("### Notes de projection");
  L.push(`- **API-$** : le bench Claude-4.8 mesure les grilles de NORMES ; la projection **632 normes = $${round(normesApiUsd, 0)}** est la plus fondée. Le chiffre **1066** réutilise le même coût/muni comme borne haute — les 434 tâches ZONES (lecture de glyphes de plans, tâche plus légère) coûteraient moins.`);
  L.push(`- **Abonnement (B)** : coût réel **0 $** sur OAuth (le \`total_cost_usd\` est l'équivalent-API « fantôme »). La contrainte est la fenêtre glissante 5 h. \`munis/fenêtre\` calculé sur ${windowOut.toLocaleString("fr")} tokens-out/fenêtre (hypothèse Max-20x — **à calibrer sur un vrai rate_limit_event**) ÷ ${Math.round(meanOut)} out/muni.`);
  L.push(`- Le \`out\` élevé (raisonnement xhigh) domine à la fois l'API-$ (×$25/1M) ET la consommation d'abonnement. Baisser l'effort (high) réduirait fortement les deux, au prix d'un peu de qualité.`);
  L.push("");

  const md = L.join("\n");
  const outPath = join(REPO, "work", "bench", "claude48-cost-projection.md");
  writeFile(outPath, md).catch(() => undefined);
  // eslint-disable-next-line no-console
  console.log(md);
  console.error(`\n[analyze] wrote ${outPath}`);
}

main();
