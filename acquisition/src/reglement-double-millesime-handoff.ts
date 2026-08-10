/**
 * Builds the WP3 handoff for the immo extraction lane from the committed
 * double-millesime readiness artefact. This is intentionally local-only:
 * it neither reads nor writes object storage.
 *
 * Usage:
 *   npx tsx acquisition/src/reglement-double-millesime-handoff.ts
 *   npx tsx acquisition/src/reglement-double-millesime-handoff.ts --readiness path/to/readiness.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_READINESS_PATH = "work/coverage/reglement-double-millesime-readiness-20260802T145820Z.json";
const DEFAULT_OUTPUT_PATH = "work/coverage/reglement-double-millesime-handoff.json";
const COMMIT_HINT = "0ff0a680";

export interface NoteSpan {
  start: number;
  end: number;
  text: string;
}

export interface AncienVerbatim {
  slug: string;
  en_vigueur_numero: string | null;
  en_vigueur_millesime: string | number | null;
  ancien_numero_verbatim: string | null;
  _note_span: NoteSpan;
}

export interface ReadinessArtifact {
  partition: {
    counts: {
      ANCIEN_VERBATIM: number;
    };
  };
  ancien_verbatim: AncienVerbatim[];
}

export interface HandoffEntry {
  city_slug: string;
  zone_ref: null;
  numero_en_vigueur: string | null;
  numero_ancien: string | null;
  millesime_en_vigueur: string | number | null;
  millesime_ancien: null;
  clause_verbatim: string;
  note_span: {
    start: number;
    end: number;
  };
}

export interface HandoffArtifact {
  contract: "reglement-double-millesime-handoff/v1";
  as_of: string;
  source: {
    path: string;
    sha256: string;
    commit_hint: typeof COMMIT_HINT;
  };
  count: number;
  notice: string;
  entries: HandoffEntry[];
}

const NOTICE = "Champs POSSÉDÉS par geo (WP3). feature_ref / mapping zone↔signal = responsabilité immo (#13), NON fourni. Anti-invention: millésime null si non verbatim. Compteur dérivé de l'artefact committé.";

function assertReadiness(readiness: ReadinessArtifact): void {
  if (!Array.isArray(readiness.ancien_verbatim)) {
    throw new Error("readiness.ancien_verbatim must be an array");
  }
  const expected = readiness.partition?.counts?.ANCIEN_VERBATIM;
  if (!Number.isInteger(expected)) {
    throw new Error("readiness.partition.counts.ANCIEN_VERBATIM must be an integer");
  }
  if (readiness.ancien_verbatim.length !== expected) {
    throw new Error(
      `readiness partition mismatch: ancien_verbatim.length (${readiness.ancien_verbatim.length}) !== ANCIEN_VERBATIM (${expected})`,
    );
  }
}

function toEntry(source: AncienVerbatim, index: number): HandoffEntry {
  if (typeof source.slug !== "string") {
    throw new Error(`ancien_verbatim[${index}].slug must be a string`);
  }
  if (source.en_vigueur_numero !== null && typeof source.en_vigueur_numero !== "string") {
    throw new Error(`ancien_verbatim[${index}].en_vigueur_numero must be a string or null`);
  }
  if (source.ancien_numero_verbatim !== null && typeof source.ancien_numero_verbatim !== "string") {
    throw new Error(`ancien_verbatim[${index}].ancien_numero_verbatim must be a string or null`);
  }
  if (
    source.en_vigueur_millesime !== null
    && typeof source.en_vigueur_millesime !== "string"
    && typeof source.en_vigueur_millesime !== "number"
  ) {
    throw new Error(`ancien_verbatim[${index}].en_vigueur_millesime must be a string, number, or null`);
  }
  const span = source._note_span;
  if (
    !span
    || !Number.isInteger(span.start)
    || !Number.isInteger(span.end)
    || typeof span.text !== "string"
  ) {
    throw new Error(`ancien_verbatim[${index}]._note_span must contain integer start/end and string text`);
  }

  return {
    city_slug: source.slug,
    zone_ref: null,
    numero_en_vigueur: source.en_vigueur_numero,
    numero_ancien: source.ancien_numero_verbatim,
    millesime_en_vigueur: source.en_vigueur_millesime,
    millesime_ancien: null,
    clause_verbatim: span.text,
    note_span: { start: span.start, end: span.end },
  };
}

export function buildHandoff(
  readiness: ReadinessArtifact,
  source: HandoffArtifact["source"],
  asOf = new Date().toISOString(),
): HandoffArtifact {
  assertReadiness(readiness);
  const entries = readiness.ancien_verbatim.map(toEntry);
  const handoff: HandoffArtifact = {
    contract: "reglement-double-millesime-handoff/v1",
    as_of: asOf,
    source,
    count: readiness.ancien_verbatim.length,
    notice: NOTICE,
    entries,
  };
  validateHandoff(handoff, readiness);
  return handoff;
}

export function validateHandoff(handoff: HandoffArtifact, readiness: ReadinessArtifact): void {
  assertReadiness(readiness);
  const count = readiness.ancien_verbatim.length;
  if (handoff.entries.length !== count) {
    throw new Error(`handoff entries mismatch: entries.length (${handoff.entries.length}) !== N (${count})`);
  }
  if (handoff.count !== count) {
    throw new Error(`handoff count mismatch: count (${handoff.count}) !== N (${count})`);
  }

  for (const [index, entry] of handoff.entries.entries()) {
    const source = readiness.ancien_verbatim[index]!;
    if (entry.numero_ancien !== source.ancien_numero_verbatim) {
      throw new Error(`handoff entry ${index} numero_ancien is not verbatim`);
    }
    if (entry.millesime_ancien !== null) {
      throw new Error(`handoff entry ${index} millesime_ancien must be null`);
    }
    if (entry.zone_ref !== null) {
      throw new Error(`handoff entry ${index} zone_ref must be null`);
    }
  }
}

export function buildHandoffFromFile(readinessPath = DEFAULT_READINESS_PATH): HandoffArtifact {
  const resolvedReadinessPath = resolve(ROOT, readinessPath);
  const bytes = readFileSync(resolvedReadinessPath);
  const readiness = JSON.parse(bytes.toString("utf8")) as ReadinessArtifact;
  return buildHandoff(readiness, {
    path: readinessPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    commit_hint: COMMIT_HINT,
  });
}

function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a path`);
  return value;
}

export function main(argv = process.argv.slice(2)): void {
  const readinessPath = argument(argv, "readiness") ?? DEFAULT_READINESS_PATH;
  const outputPath = argument(argv, "out") ?? DEFAULT_OUTPUT_PATH;
  const handoff = buildHandoffFromFile(readinessPath);
  const resolvedOutputPath = resolve(ROOT, outputPath);
  writeFileSync(resolvedOutputPath, `${JSON.stringify(handoff, null, 2)}\n`);

  console.log(`VALIDATION entries.length === N: ${handoff.entries.length} === ${handoff.count}`);
  console.log("VALIDATION numero_ancien matches readiness: true");
  console.log("VALIDATION millesime_ancien === null: true");
  console.log("VALIDATION zone_ref === null: true");
  console.log(`VALIDATION equation: ${handoff.entries.length} == ${handoff.count}`);
  console.log(`WROTE ${outputPath} entries=${handoff.entries.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
