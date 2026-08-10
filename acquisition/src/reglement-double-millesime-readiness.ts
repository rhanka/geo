/**
 * Measure whether the local règlement provenance register identifies a prior
 * zoning by-law verbatim. This is a local, read-only readiness measure: it
 * never follows the URLs in the register and never accesses object storage.
 *
 * Usage:
 *   npx tsx acquisition/src/reglement-double-millesime-readiness.ts
 *   npx tsx acquisition/src/reglement-double-millesime-readiness.ts \
 *     --out=work/coverage/reglement-double-millesime-readiness-YYYYMMDDTHHMMSSZ.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const REGLEMENT_PROVENANCE_PATH = "acquisition/config/reglement-provenance.json";
const MUNICIPALITIES_PATH = "packages/qc-sources/src/geo/municipalities.qc.json";
const COVERAGE_DIRECTORY = "work/coverage";

export const DOUBLE_MILLESIME_BUCKETS = [
  "ANCIEN_VERBATIM",
  "REZONAGE_AMBIGU",
  "EN_VIGUEUR_SEUL",
] as const;

export type DoubleMillesimeBucket = (typeof DOUBLE_MILLESIME_BUCKETS)[number];

export interface NoteSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface DoubleMillesimeClassification {
  readonly bucket: DoubleMillesimeBucket;
  readonly ancienNumeroVerbatim: string | null;
  readonly noteSpan: NoteSpan | null;
  readonly millesimeNull: boolean;
}

interface ReglementProvenanceEntry {
  readonly reglement_numero: string | null;
  readonly reglement_millesime: unknown;
  readonly reglement_page_source: number | null;
  readonly reglement_url: string | null;
  readonly _note: string;
}

interface ProvenanceRegister {
  readonly slugs: Record<string, ReglementProvenanceEntry>;
}

interface InputDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

const ACTION_VERB = String.raw`(?:abrog(?:e|é|ée|és|ées|ant|ante|ants|antes|er)|rempla(?:c|ç)(?:e|é|ée|és|ées|ant|ante|ants|antes|er))`;
const ACTION_NOUN = String.raw`(?:abrogation|remplacement)`;
const ACTION_SIGNAL = String.raw`(?:abrog\p{L}*|rempla(?:c|ç)\p{L}*)`;
const NUMBER = String.raw`(?:(?=[A-Za-z0-9._/-]*\d)[A-Za-z0-9]+(?:[._/-][A-Za-z0-9]+)*|[A-Za-z]+\s+\d[A-Za-z0-9]*(?:[._/-][A-Za-z0-9]+)*)`;
const NUMBER_LABEL = String.raw`(?:n\s*[oº°]|n(?:um(?:é|e)ro)?\.?|#)`;
const RULE = String.raw`r[èe]glement(?:\s+de\s+zonage)?`;
const RULE_WITH_NUMBER = String.raw`${RULE}\s*(?:${NUMBER_LABEL}\s*)?(?<ancien>${NUMBER})`;

/*
 * A prior number is accepted only when the note itself puts it in a
 * replacement/abrogation clause. The bounded gap admits formulations such as
 * "remplace les règlements suivants : - règlement de zonage no 242-89" while
 * refusing a bare number elsewhere in a note.
 */
const PRIOR_BASE_PREFIX_CLAUSE = new RegExp(
  String.raw`\b${ACTION_VERB}\b(?!\s*(?:\)|:|--|,?\s*p\s*\d))(?:(?![.;]).){0,120}?\b${RULE_WITH_NUMBER}`,
  "giu",
);
const PRIOR_BASE_NOUN_CLAUSE = new RegExp(
  String.raw`\b${ACTION_NOUN}\b\s+(?:du|de\s+la|des|d['’])\s+${RULE_WITH_NUMBER}`,
  "giu",
);
const PRIOR_BASE_SUFFIX_CLAUSE = new RegExp(
  String.raw`\b${RULE_WITH_NUMBER}(?:(?![.;]).){0,100}?\b(?:est|sont|était|étaient|sera|seront|is|are|was|were)\s+${ACTION_VERB}\b`,
  "giu",
);
const REZONAGE_SIGNAL = new RegExp(String.raw`\b(?:${ACTION_SIGNAL}|ancien(?:ne)?s?)\b`, "iu");
const NEGATED_REZONAGE_SIGNAL = new RegExp(String.raw`\bsans\s+(?:clause\s+de\s+)?${ACTION_SIGNAL}\b`, "giu");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: chaîne requise`);
  return value;
}

function optionalString(value: unknown, where: string): string | null {
  if (value === null) return null;
  return requiredString(value, where);
}

function noteText(value: unknown, where: string): string {
  if (value === null || value === undefined) return "";
  return requiredString(value, where);
}

function absolutePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function readSmallFile(path: string): Buffer {
  const absolute = absolutePath(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de ${MAX_INPUT_BYTES}`);
  return readFileSync(absolute);
}

function readJson(path: string): unknown {
  return JSON.parse(readSmallFile(path).toString("utf8")) as unknown;
}

function describeInput(path: string): InputDescriptor {
  const bytes = readSmallFile(path);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function readRegister(): ProvenanceRegister {
  const root = requiredRecord(readJson(REGLEMENT_PROVENANCE_PATH), REGLEMENT_PROVENANCE_PATH);
  const slugs = requiredRecord(root.slugs, `${REGLEMENT_PROVENANCE_PATH}.slugs`);
  const parsed: Record<string, ReglementProvenanceEntry> = {};
  for (const [slug, rawEntry] of Object.entries(slugs)) {
    const entry = requiredRecord(rawEntry, `${REGLEMENT_PROVENANCE_PATH}.slugs.${slug}`);
    parsed[slug] = {
      reglement_numero: optionalString(entry.reglement_numero, `${REGLEMENT_PROVENANCE_PATH}.slugs.${slug}.reglement_numero`),
      reglement_millesime: entry.reglement_millesime,
      reglement_page_source: entry.reglement_page_source === null ? null : Number(entry.reglement_page_source),
      reglement_url: optionalString(entry.reglement_url, `${REGLEMENT_PROVENANCE_PATH}.slugs.${slug}.reglement_url`),
      _note: noteText(entry._note, `${REGLEMENT_PROVENANCE_PATH}.slugs.${slug}._note`),
    };
  }
  return { slugs: parsed };
}

function readMunicipalityCount(): number {
  const municipalities = readJson(MUNICIPALITIES_PATH);
  if (!Array.isArray(municipalities)) throw new Error(`${MUNICIPALITIES_PATH}: tableau requis`);
  return municipalities.length;
}

/**
 * Classify from the exact note text only. No number is manufactured: a prior
 * number comes from the named capture group in the matched note substring.
 */
function normalizedReglementNumber(value: string): string {
  return value.toLocaleLowerCase("fr-CA").replace(/[^a-z0-9]/gu, "");
}

function priorBaseMatches(note: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  for (const pattern of [PRIOR_BASE_PREFIX_CLAUSE, PRIOR_BASE_NOUN_CLAUSE, PRIOR_BASE_SUFFIX_CLAUSE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(note)) !== null) {
      if (/\barticle\b/iu.test(match[0])) continue;
      if (/\barticle\b/iu.test(note.slice(Math.max(0, match.index - 80), match.index))) continue;
      if (/^\s*rempla(?:c|ç)\p{L}*\s*,/iu.test(match[0])) continue;
      matches.push(match);
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

export function classifyReglementNote(
  note: string,
  reglementMillesime: unknown,
  enVigueurNumero: string | null = null,
): DoubleMillesimeClassification {
  for (const match of priorBaseMatches(note)) {
    const ancienNumeroVerbatim = match.groups?.ancien;
    if (ancienNumeroVerbatim === undefined) throw new Error("motif de base antérieure sans numéro capturé");
    if (enVigueurNumero !== null && normalizedReglementNumber(ancienNumeroVerbatim) === normalizedReglementNumber(enVigueurNumero)) {
      continue;
    }
    return {
      bucket: "ANCIEN_VERBATIM",
      ancienNumeroVerbatim,
      noteSpan: {
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      },
      millesimeNull: reglementMillesime === null,
    };
  }

  const noteWithoutNegatedSignal = note.replace(NEGATED_REZONAGE_SIGNAL, "");
  return {
    bucket: REZONAGE_SIGNAL.test(noteWithoutNegatedSignal) ? "REZONAGE_AMBIGU" : "EN_VIGUEUR_SEUL",
    ancienNumeroVerbatim: null,
    noteSpan: null,
    millesimeNull: reglementMillesime === null,
  };
}

function timestampForFilename(asOf: Date): string {
  return asOf.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

function outputPath(): string {
  const supplied = process.argv.find((argument) => argument.startsWith("--out="));
  const path = supplied === undefined
    ? `${COVERAGE_DIRECTORY}/reglement-double-millesime-readiness-${timestampForFilename(new Date())}.json`
    : supplied.slice("--out=".length);
  const absolute = absolutePath(path);
  const coverageRoot = absolutePath(COVERAGE_DIRECTORY);
  if (!absolute.startsWith(`${coverageRoot}/`) || !absolute.endsWith(".json")) {
    throw new Error(`sortie hors ${COVERAGE_DIRECTORY} ou non JSON: ${path}`);
  }
  return absolute;
}

function main(): void {
  const asOf = new Date().toISOString();
  const register = readRegister();
  const rows = Object.entries(register.slugs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slug, entry]) => {
      const classification = classifyReglementNote(entry._note, entry.reglement_millesime, entry.reglement_numero);
      return {
        slug,
        bucket: classification.bucket,
        millesime_null: classification.millesimeNull,
        ...(classification.ancienNumeroVerbatim === null ? {} : {
          en_vigueur_numero: entry.reglement_numero,
          en_vigueur_millesime: entry.reglement_millesime,
          ancien_numero_verbatim: classification.ancienNumeroVerbatim,
          _note_span: classification.noteSpan,
        }),
      };
    });

  const counts = Object.fromEntries(DOUBLE_MILLESIME_BUCKETS.map((bucket) => [
    bucket,
    rows.filter((row) => row.bucket === bucket).length,
  ])) as Record<DoubleMillesimeBucket, number>;
  const partitionSum = DOUBLE_MILLESIME_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0);
  if (partitionSum !== rows.length) {
    throw new Error(`partition invalide: ${partitionSum} != ${rows.length}`);
  }

  const anciens = rows
    .filter((row) => row.bucket === "ANCIEN_VERBATIM")
    .map((row) => ({
      slug: row.slug,
      en_vigueur_numero: row.en_vigueur_numero ?? null,
      en_vigueur_millesime: row.en_vigueur_millesime ?? null,
      ancien_numero_verbatim: row.ancien_numero_verbatim!,
      _note_span: row._note_span!,
    }));
  const millesimeNull = rows.filter((row) => row.millesime_null).length;
  const report = {
    contract: "reglement-double-millesime-readiness/v1",
    as_of: asOf,
    read_only_local: true,
    inputs: {
      reglement_provenance: describeInput(REGLEMENT_PROVENANCE_PATH),
      municipalities_catalog: {
        ...describeInput(MUNICIPALITIES_PATH),
        municipalities: readMunicipalityCount(),
      },
    },
    universe: {
      reglement_provenance_entries: rows.length,
      denominator: "reglement_provenance_entries",
    },
    partition: {
      counts,
      equation: `ANCIEN_VERBATIM (${counts.ANCIEN_VERBATIM}) + REZONAGE_AMBIGU (${counts.REZONAGE_AMBIGU}) + EN_VIGUEUR_SEUL (${counts.EN_VIGUEUR_SEUL}) = ${partitionSum}`,
      total: rows.length,
      validated: true,
    },
    flags: {
      MILLESIME_NULL: millesimeNull,
    },
    ancien_verbatim: anciens,
    rows,
  };

  const output = outputPath();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.partition.equation}\n`);
  process.stdout.write(`MILLESIME_NULL = ${millesimeNull}\n`);
  process.stdout.write(`Matrice JSON: ${relative(ROOT, output)}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
