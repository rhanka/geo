/**
 * GPT-5.5 OCR QUALITY BENCH — same bounded grille pages as BENCH-OCR.md.
 *
 * This is deliberately bench-only. GPT-5.5 reads rendered page images through the
 * local Codex CLI, then the raw verbatim-or-null cells are mapped through the
 * existing Claude image mapper, which in turn calls the frozen buildVisionField
 * guard and ZoneNorms zod schema. No new norm parsing or guard logic lives here.
 *
 * Run: npx tsx acquisition/src/bench/run-gpt55-ocr-bench.ts
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudePrompt,
  mapClaudeExtractionToZones,
  parseClaudeContent,
  renderPageToPng,
  type ClaudeRawExtraction,
} from "../lib/grille-claude-cli.js";
import { s3Client } from "../lib/s3.js";
import {
  crossValidateZoneCodes,
  type CrossValResult,
} from "../lib/zonage-norms.js";
import {
  PUBLISH_THRESHOLD,
  type NormFieldT,
  type ZoneNormsT,
} from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WORK = join(REPO, "work", "zonage-norms");
const OUT = join(REPO, "work", "delegation-mass", "OCR-BENCH-GPT55.md");
const RAW_OUT = join(REPO, "work", "delegation-mass", "OCR-BENCH-GPT55.raw.json");

const SNAPSHOT = "2026-06-29";
const GPT_METHODE = "codex/gpt-5.5-vision";
const GPT_MODEL = process.env["GPT55_MODEL"] ?? "gpt-5.5";
const GPT_EFFORT = process.env["GPT55_EFFORT"] ?? "xhigh";
const CODEX_BIN = process.env["CODEX_BIN"] ?? "codex";
const CODEX_TIMEOUT_MS = Number(process.env["GPT55_TIMEOUT_MS"] ?? "240000");
const DPI = Number(process.env["GPT55_DPI"] ?? "150");
const ONLY = new Set((process.env["GPT55_ONLY"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const STRATFORD_FULL = process.env["GPT55_STRATFORD_FULL"] === "1";
const FIELD_IDS = [
  "densite",
  "hauteur_metres",
  "hauteur_etages",
  "marge_avant_min",
  "marge_laterale_min",
  "marge_arriere_min",
  "frontage_min",
  "superficie_min",
] as const;

interface Ville {
  slug: string;
  type: "multizone" | "image";
  pages: number[];
  sourceUrl: string;
}

const VILLES: Ville[] = [
  {
    slug: "stratford",
    type: "multizone",
    pages: STRATFORD_FULL ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2],
    sourceUrl: "https://stratford.quebec/wp-content/uploads/2024/05/STR_GRILLE_20220621.pdf",
  },
  {
    slug: "portneuf",
    type: "multizone",
    pages: [4, 6],
    sourceUrl: "https://villedeportneuf.com/upload/grille_des_specifications_zonage.pdf",
  },
  {
    slug: "sutton",
    type: "multizone",
    pages: [1, 2],
    sourceUrl: "https://sutton.ca/wp-content/uploads/2020/07/Habitation-H-115-12-2020.pdf",
  },
  {
    slug: "saint-raymond",
    type: "multizone",
    pages: [2, 3],
    sourceUrl: "https://villesaintraymond.com/uploads/documents/pieces-jointes/4-Grille-des-normes-Annexe-I-MAJ-2026-05-05.pdf",
  },
  {
    slug: "cap-sante",
    type: "multizone",
    pages: [130, 310],
    sourceUrl: "https://capsante.qc.ca/assets/documents/R%C3%A8glement-de-zonage-Cap-Sant%C3%A9-refondu-2019-08.pdf",
  },
  {
    slug: "saint-stanislas-de-kostka",
    type: "image",
    pages: [2, 3],
    sourceUrl: "https://st-stanislas-de-kostka.ca/assets/files/upload/annexes-reglement330.pdf",
  },
];

interface BaselineMetrics {
  zones: number | null;
  published: number | null;
  falseValues: number | null;
  usd: number | null;
  latencyMs: number | null;
  sigOverlap?: number | null;
  note?: string;
}

const MISTRAL_BASELINE: Record<string, BaselineMetrics> = {
  stratford: { zones: 26, published: 22, falseValues: 0, usd: 0.002, latencyMs: 9261 },
  portneuf: { zones: 12, published: 40, falseValues: 0, usd: 0.002, latencyMs: 8154 },
  sutton: { zones: 6, published: 4, falseValues: 0, usd: 0.002, latencyMs: 8218 },
  "saint-raymond": { zones: 15, published: 60, falseValues: 0, usd: 0.002, latencyMs: 7598 },
  "cap-sante": { zones: 0, published: 0, falseValues: 0, usd: 0.002, latencyMs: 7792 },
  "saint-stanislas-de-kostka": { zones: 8, published: 2, falseValues: 0, usd: 0.002, latencyMs: 5413 },
};

const CLAUDE_BASELINE: Record<string, BaselineMetrics> = {
  stratford: {
    zones: 49,
    published: 142,
    falseValues: 0,
    usd: 0,
    latencyMs: 608000,
    sigOverlap: 49,
    note: "NORMES-2ENGINE.md full 8-page Stratford run; no bounded 2-page Claude row is recorded.",
  },
  portneuf: unavailableClaude(),
  sutton: unavailableClaude(),
  "saint-raymond": unavailableClaude(),
  "cap-sante": unavailableClaude(),
  "saint-stanislas-de-kostka": unavailableClaude(),
};

function unavailableClaude(): BaselineMetrics {
  return {
    zones: null,
    published: null,
    falseValues: null,
    usd: null,
    latencyMs: null,
    sigOverlap: null,
    note: "No Claude-4.8 row for this bounded BENCH-OCR grille was found in the repo reports.",
  };
}

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

function valueAppearsInRaw(f: NormFieldT): boolean {
  if (f.value === null) return true;
  const raw = (f.raw ?? "").replace(/\s/g, "").replace(/,/g, ".");
  const v = String(f.value);
  if (raw.includes(v)) return true;
  const vAlt = v.includes(".") ? v : `${v}.`;
  return raw.includes(vAlt) || raw.includes(v.replace(/\.0$/, ""));
}

interface Summary {
  zones: number;
  fieldsTotal: number;
  fieldsPublished: number;
  fieldsBelow: number;
  falseValues: number;
}

function summarise(zones: ZoneNormsT[]): Summary {
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

function publishedCount(z: ZoneNormsT): number {
  return allFields(z).filter((f) => f.value !== null && f.confidence >= PUBLISH_THRESHOLD).length;
}

function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const k = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(k);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(k, zn);
  }
  return [...byZone.values()];
}

interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface CodexVisionResult {
  extraction: ClaudeRawExtraction;
  usage: CodexUsage;
  latencyMs: number;
  stderr: string;
}

const RAW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    zones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          zone_code: { type: ["string", "null"] },
          fields: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              FIELD_IDS.map((id) => [id, { type: ["string", "null"] }]),
            ),
            required: FIELD_IDS,
          },
        },
        required: ["zone_code", "fields"],
      },
    },
  },
  required: ["zones"],
} as const;

function codexPrompt(page: number, slug: string): string {
  return [
    `Benchmark OCR GPT-5.5 pour ${slug}, page ${page}.`,
    "N'utilise aucun outil, aucune commande shell et aucun fichier externe. Lis uniquement l'image jointe.",
    buildClaudePrompt(),
  ].join("\n\n");
}

async function runCodexVision(imagePath: string, page: number, slug: string): Promise<CodexVisionResult> {
  const dir = await mkdtemp(join(tmpdir(), "gpt55-ocr-"));
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  await writeFile(schemaPath, JSON.stringify(RAW_SCHEMA), "utf8");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "-C",
    tmpdir(),
    "-s",
    "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    `model_reasoning_effort="${GPT_EFFORT}"`,
    "-m",
    GPT_MODEL,
    "--output-schema",
    schemaPath,
    "-o",
    outPath,
    "--json",
    "-i",
    imagePath,
    "-",
  ];
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await spawnCollect(CODEX_BIN, args, CODEX_TIMEOUT_MS, codexPrompt(page, slug));
    const content = await readFile(outPath, "utf8");
    const extraction = parseClaudeContent(content);
    const usage = parseCodexUsage(stdout);
    return { extraction, usage, latencyMs: Date.now() - t0, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function spawnCollect(
  bin: string,
  args: string[],
  timeoutMs: number,
  stdinText: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${bin} exit=${code}: stdout=${stdout.slice(0, 800)} stderr=${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

function parseCodexUsage(stdout: string): CodexUsage {
  const usage: CodexUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  for (const line of stdout.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const msg = JSON.parse(s) as { type?: string; usage?: Record<string, unknown> };
      if (msg.type !== "turn.completed" || !msg.usage) continue;
      usage.inputTokens += Number(msg.usage["input_tokens"] ?? 0);
      usage.cachedInputTokens += Number(msg.usage["cached_input_tokens"] ?? 0);
      usage.outputTokens += Number(msg.usage["output_tokens"] ?? 0);
      usage.reasoningOutputTokens += Number(msg.usage["reasoning_output_tokens"] ?? 0);
    } catch {
      /* ignore non-event lines */
    }
  }
  return usage;
}

interface GptMetrics extends Summary {
  usd: number;
  latencyMs: number;
  pagesRead: number;
  pagesFailed: number;
  usage: CodexUsage;
  sig?: CrossValResult | null;
  errors: string[];
  zonesRaw: ZoneNormsT[];
}

function addUsage(a: CodexUsage, b: CodexUsage): CodexUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

async function runGpt(v: Ville): Promise<GptMetrics> {
  const pdf = join(WORK, v.slug, "grille.pdf");
  if (!existsSync(pdf)) {
    throw new Error(`missing benchmark PDF: ${pdf}`);
  }
  const zones: ZoneNormsT[] = [];
  const errors: string[] = [];
  let pagesRead = 0;
  let pagesFailed = 0;
  let latencyMs = 0;
  let usage: CodexUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };

  for (const page of v.pages) {
    let png: string | null = null;
    try {
      png = await renderPageToPng(pdf, page, DPI);
      const res = await runCodexVision(png, page, v.slug);
      usage = addUsage(usage, res.usage);
      latencyMs += res.latencyMs;
      zones.push(...mapClaudeExtractionToZones(res.extraction, page, {
        source_url: v.sourceUrl,
        snapshot: SNAPSHOT,
        methode: GPT_METHODE,
      }));
      pagesRead++;
    } catch (e) {
      pagesFailed++;
      errors.push(`page ${page}: ${(e instanceof Error ? e.message : String(e)).slice(0, 1200)}`);
    } finally {
      if (png) {
        await rm(png.replace(/\/[^/]+$/, ""), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  const merged = mergeByZone(zones);
  const summary = summarise(merged);
  const sig = await maybeCrossValidate(v.slug, merged);
  return {
    ...summary,
    usd: 0,
    latencyMs,
    pagesRead,
    pagesFailed,
    usage,
    sig,
    errors,
    zonesRaw: merged,
  };
}

async function maybeCrossValidate(slug: string, zones: ZoneNormsT[]): Promise<CrossValResult | null> {
  try {
    return await crossValidateZoneCodes(s3Client(), slug, zones);
  } catch {
    return null;
  }
}

function fmtMoney(v: number | null): string {
  if (v === null) return "n/r";
  return `$${v.toFixed(4)}`;
}

function fmtMs(v: number | null): string {
  if (v === null) return "n/r";
  return `${Math.round(v)}ms`;
}

function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? "n/r" : String(v);
}

function fmtFalse(v: number | null): string {
  if (v === null) return "n/r";
  return v === 0 ? "oui" : `NON(${v})`;
}

function baselineRow(v: Ville, engine: string, b: BaselineMetrics): string {
  return `| ${v.slug} | ${v.pages.join(",")} | ${engine} | ${fmtInt(b.zones)} | ${fmtInt(b.published)} | ${fmtInt(b.sigOverlap)} | ${fmtFalse(b.falseValues)} | ${fmtMoney(b.usd)} | ${fmtMs(b.latencyMs)} | ${b.note ?? ""} |`;
}

function gptRow(v: Ville, g: GptMetrics): string {
  const sig = g.sig?.gridFound ? `${g.sig.overlap}/${g.sig.sigZoneCodes}` : "n/r";
  const note = [
    `${g.pagesRead}/${v.pages.length} pages`,
    `tokens in/out/reason=${g.usage.inputTokens}/${g.usage.outputTokens}/${g.usage.reasoningOutputTokens}`,
    g.pagesFailed ? `errors=${g.errors.join("; ")}` : "",
  ].filter(Boolean).join("; ");
  return `| ${v.slug} | ${v.pages.join(",")} | GPT-5.5 vision | ${g.zones} | ${g.fieldsPublished} | ${sig} | ${fmtFalse(g.falseValues)} | $0.0000 | ${fmtMs(g.latencyMs)} | ${note} |`;
}

function pct(num: number, den: number): string {
  return den === 0 ? "n/r" : `${Math.round((num / den) * 1000) / 10}%`;
}

async function main(): Promise<void> {
  const rows: Array<{ v: Ville; gpt: GptMetrics }> = [];
  const villes = ONLY.size ? VILLES.filter((v) => ONLY.has(v.slug)) : VILLES;
  for (const v of villes) {
    console.error(`[gpt55-bench] ${v.slug} pages=${v.pages.join(",")} start`);
    const gpt = await runGpt(v);
    rows.push({ v, gpt });
    console.error(
      `[gpt55-bench] ${v.slug} zones=${gpt.zones} pub=${gpt.fieldsPublished}/${gpt.fieldsTotal} false=${gpt.falseValues} latency=${gpt.latencyMs}ms`,
    );
    if (gpt.falseValues !== 0) {
      console.error(`[gpt55-bench] FAILURE anti-invention: ${v.slug} false=${gpt.falseValues}`);
    }
  }

  let gZones = 0;
  let gPub = 0;
  let gTotal = 0;
  let gFalse = 0;
  let gLatency = 0;
  let gIn = 0;
  let gOut = 0;
  let gReason = 0;
  let mZones = 0;
  let mPub = 0;
  let mLatency = 0;
  for (const { v, gpt } of rows) {
    gZones += gpt.zones;
    gPub += gpt.fieldsPublished;
    gTotal += gpt.fieldsTotal;
    gFalse += gpt.falseValues;
    gLatency += gpt.latencyMs;
    gIn += gpt.usage.inputTokens;
    gOut += gpt.usage.outputTokens;
    gReason += gpt.usage.reasoningOutputTokens;
    const m = MISTRAL_BASELINE[v.slug]!;
    mZones += m.zones ?? 0;
    mPub += m.published ?? 0;
    mLatency += m.latencyMs ?? 0;
  }

  const lines: string[] = [];
  lines.push("# OCR BENCH GPT-5.5 — grilles de normes municipales");
  lines.push("");
  lines.push(`_Genere ${new Date().toISOString()} — GPT-5.5 via \`codex exec -m ${GPT_MODEL}\`, effort \`${GPT_EFFORT}\`, images rasterisees a ${DPI} dpi._`);
  lines.push("");
  lines.push("## Methode");
  lines.push("");
  lines.push("- Pages: les memes pages bornees que `work/coverage/BENCH-OCR.md` pour les 6 grilles demandees.");
  lines.push("- Schema/guard: sortie brute `{zones:[{zone_code, fields}]}` puis `mapClaudeExtractionToZones(...)`, qui appelle le `buildVisionField` gele et `ZoneNorms.parse`. Chaque valeur publiee doit rester verbatim dans `raw`, sinon elle est comptee comme fabriquee.");
  lines.push("- Cout GPT: la voie Codex CLI utilise l'auth Codex locale/subscription et n'expose pas de cout API facture par appel; le cout metrique reporte est donc `$0.0000`, avec les tokens conserves en note.");
  lines.push("- Claude baseline: seul Stratford a un chiffre Claude-4.8 documente dans `NORMES-2ENGINE.md` (8 pages, pas la fenetre BENCH-OCR 1-2). Aucun autre row Claude borne n'a ete trouve dans les rapports du repo.");
  lines.push("");
  lines.push("## Resultats par grille");
  lines.push("");
  lines.push("| Ville | Pages | Moteur | Codes distincts | Champs publies >=0.85 | SIG-overlap | fabriquees=0 ? | $/grille | latence | note |");
  lines.push("|---|---:|---|---:|---:|---:|:--:|---:|---:|---|");
  for (const { v, gpt } of rows) {
    lines.push(gptRow(v, gpt));
    lines.push(baselineRow(v, "Mistral-OCR-4-0", MISTRAL_BASELINE[v.slug]!));
    lines.push(baselineRow(v, "Claude-4.8 vision", CLAUDE_BASELINE[v.slug]!));
  }
  lines.push("");
  lines.push("## Totaux GPT-5.5 vs Mistral-OCR-4-0 (memes 6 grilles bornees)");
  lines.push("");
  lines.push(`- GPT-5.5: ${gZones} codes distincts, ${gPub}/${gTotal} champs publies (${pct(gPub, gTotal)}), fausses=${gFalse}, latence=${Math.round(gLatency / 1000)}s, tokens in/out/reason=${gIn}/${gOut}/${gReason}, cout API Codex CLI expose=$0.0000.`);
  lines.push(`- Mistral-OCR-4-0 baseline BENCH-OCR: ${mZones} codes distincts, ${mPub} champs publies, fausses=0, latence=${Math.round(mLatency / 1000)}s, cout=$${(rows.length * 0.002).toFixed(4)}.`);
  lines.push("");
  lines.push("## VERDICT");
  lines.push("");
  const relation = gPub > mPub ? "meilleur" : gPub === mPub ? "approximativement egal" : "pire";
  lines.push(`Sur les 6 grilles bornees de BENCH-OCR, GPT-5.5 est **${relation} que Mistral-OCR-4-0** en champs publies: GPT-5.5=${gPub} vs Mistral=${mPub}. En codes distincts, GPT-5.5=${gZones} vs Mistral=${mZones}. Anti-invention: GPT-5.5 fausses=${gFalse}; ${gFalse === 0 ? "PASS" : "FAIL"}.`);
  lines.push("");
  lines.push("Versus Claude-4.8, le repo ne contient pas de table Claude par grille pour ces 6 pages bornees. Le seul chiffre Claude OCR documente est Stratford full-range: Claude-4.8=142 champs publies, Mistral-OCR-4-0=53, chat-vision=14. Cette run GPT-5.5 ne doit donc pas etre vendue comme superieure a Claude sur tout le corpus; elle ferme surtout la comparaison GPT-5.5 vs Mistral sur la fenetre BENCH-OCR.");
  lines.push("");
  lines.push(`Decision moteur: GPT-5.5 ${gFalse === 0 && gPub >= mPub ? "peut servir comme 3e moteur candidat en bench/dry-run" : "ne doit pas etre promu 3e moteur de production pour ces grilles"} avec ces chiffres. La promotion production resterait conditionnee a des baselines Claude-4.8 bornees completes ou a un keep-best strict, sans depot de masse.`);
  lines.push("");
  const antiInventionFailed = rows.some((r) => r.gpt.falseValues !== 0);
  if (antiInventionFailed) {
    lines.push("## ECHEC ANTI-INVENTION");
    lines.push("");
    for (const { v, gpt } of rows.filter((r) => r.gpt.falseValues !== 0)) {
      lines.push(`- ${v.slug}: ${gpt.falseValues} valeur(s) publiee(s) non presentes verbatim dans raw.`);
    }
    lines.push("");
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, lines.join("\n") + "\n", "utf8");
  await writeFile(
    RAW_OUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model: GPT_MODEL,
        effort: GPT_EFFORT,
        dpi: DPI,
        rows: rows.map(({ v, gpt }) => ({
          slug: v.slug,
          pages: v.pages,
          gpt: {
            zones: gpt.zones,
            fieldsPublished: gpt.fieldsPublished,
            fieldsTotal: gpt.fieldsTotal,
            falseValues: gpt.falseValues,
            latencyMs: gpt.latencyMs,
            pagesRead: gpt.pagesRead,
            pagesFailed: gpt.pagesFailed,
            usage: gpt.usage,
            sig: gpt.sig,
            errors: gpt.errors,
            zoneCodes: gpt.zonesRaw.map((z) => z.zone_code),
          },
          mistral: MISTRAL_BASELINE[v.slug],
          claude: CLAUDE_BASELINE[v.slug],
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.error(`[gpt55-bench] wrote ${OUT}`);
  console.error(`[gpt55-bench] wrote ${RAW_OUT}`);
  if (antiInventionFailed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[gpt55-bench] FATAL", e instanceof Error ? e.message : e);
  process.exit(1);
});
