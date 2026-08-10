/**
 * Stamp the prior zoning by-law evidence measured by the committed local
 * double-millésime readiness artefact. This runner is local-only: it neither
 * fetches documents nor accesses object storage.
 *
 * Usage:
 *   npx tsx acquisition/src/reglement-stamp-ancien-from-readiness.ts
 *   npx tsx acquisition/src/reglement-stamp-ancien-from-readiness.ts --dry-run
 *   npx tsx acquisition/src/reglement-stamp-ancien-from-readiness.ts --strip
 *   npx tsx acquisition/src/reglement-stamp-ancien-from-readiness.ts \
 *     --readiness=work/coverage/reglement-double-millesime-readiness-20260802T145820Z.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = resolve(ROOT, "acquisition/config/reglement-provenance.json");
const DEFAULT_READINESS_PATH = resolve(
  ROOT,
  "work/coverage/reglement-double-millesime-readiness-20260802T145820Z.json",
);

type JsonRecord = Record<string, unknown>;

export interface AncienReadinessEntry {
  readonly slug: string;
  readonly ancien_numero_verbatim: string;
  readonly _note_span: {
    readonly text: string;
  };
}

export interface StampResult {
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly changedSlugs: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, where: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: chaîne requise`);
  return value;
}

function requiredCount(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${where}: entier naturel requis`);
  }
  return value;
}

function registrySlugs(registry: unknown): JsonRecord {
  return requiredRecord(requiredRecord(registry, "registre").slugs, "registre.slugs");
}

export function readAncienReadiness(readiness: unknown): readonly AncienReadinessEntry[] {
  const root = requiredRecord(readiness, "readiness");
  const ancienVerbatim = root.ancien_verbatim;
  if (!Array.isArray(ancienVerbatim)) throw new Error("readiness.ancien_verbatim: tableau requis");

  const count = requiredCount(
    requiredRecord(requiredRecord(root.partition, "readiness.partition").counts, "readiness.partition.counts")
      .ANCIEN_VERBATIM,
    "readiness.partition.counts.ANCIEN_VERBATIM",
  );
  const entries = ancienVerbatim.map((raw, index): AncienReadinessEntry => {
    const entry = requiredRecord(raw, `readiness.ancien_verbatim[${index}]`);
    return {
      slug: requiredString(entry.slug, `readiness.ancien_verbatim[${index}].slug`),
      ancien_numero_verbatim: requiredString(
        entry.ancien_numero_verbatim,
        `readiness.ancien_verbatim[${index}].ancien_numero_verbatim`,
      ),
      _note_span: {
        text: requiredString(
          requiredRecord(entry._note_span, `readiness.ancien_verbatim[${index}]._note_span`).text,
          `readiness.ancien_verbatim[${index}]._note_span.text`,
        ),
      },
    };
  });

  if (entries.length !== count) {
    throw new Error(
      `readiness incohérent: ancien_verbatim.length ${entries.length} !== ANCIEN_VERBATIM ${count}`,
    );
  }
  if (new Set(entries.map((entry) => entry.slug)).size !== entries.length) {
    throw new Error("readiness incohérent: slug dupliqué dans ancien_verbatim");
  }
  return entries;
}

function validationResult(slugs: JsonRecord, entries: readonly AncienReadinessEntry[], changedSlugs: number): StampResult {
  const expectedBySlug = new Map(entries.map((entry) => [entry.slug, entry.ancien_numero_verbatim]));
  const stamped = Object.entries(slugs).filter(([, rawEntry]) => {
    const entry = requiredRecord(rawEntry, "registre.slugs.*");
    return entry.reglement_ancien_numero !== null && entry.reglement_ancien_numero !== undefined;
  });

  if (stamped.length !== entries.length) {
    throw new Error(`validation échouée: ${stamped.length} reglement_ancien_numero non-null !== N ${entries.length}`);
  }
  for (const [slug, rawEntry] of stamped) {
    const expected = expectedBySlug.get(slug);
    const actual = requiredRecord(rawEntry, `registre.slugs.${slug}`).reglement_ancien_numero;
    if (expected === undefined || actual !== expected) {
      throw new Error(`validation échouée: ${slug}.reglement_ancien_numero ne correspond pas au readiness`);
    }
  }

  return {
    expectedCount: entries.length,
    actualCount: stamped.length,
    changedSlugs,
  };
}

/**
 * Mutates only readiness-listed slugs, after all anti-drift checks pass.
 * This makes an identical second pass a no-op and completes any partial prior pass.
 */
export function stampAncienFromReadiness(registry: unknown, readiness: unknown): StampResult {
  const slugs = registrySlugs(registry);
  const entries = readAncienReadiness(readiness);
  const targets = entries.map((entry) => {
    const target = requiredRecord(slugs[entry.slug], `registre.slugs.${entry.slug}`);
    if (Object.hasOwn(target, "reglement_ancien_numero")
      && target.reglement_ancien_numero !== entry.ancien_numero_verbatim) {
      throw new Error(
        `anti-drift: ${entry.slug}.reglement_ancien_numero diffère du readiness; refus d'écraser`,
      );
    }
    return { entry, target };
  });

  let changedSlugs = 0;
  for (const { entry, target } of targets) {
    const changed = target.reglement_ancien_numero !== entry.ancien_numero_verbatim
      || target.reglement_ancien_millesime !== null
      || target.reglement_ancien_source !== entry._note_span.text;
    target.reglement_ancien_numero = entry.ancien_numero_verbatim;
    target.reglement_ancien_millesime = null;
    target.reglement_ancien_source = entry._note_span.text;
    if (changed) changedSlugs += 1;
  }
  return validationResult(slugs, entries, changedSlugs);
}

/** Remove all three prior-by-law fields from every register slug. */
export function stripAncienFields(registry: unknown): number {
  const slugs = registrySlugs(registry);
  let changedSlugs = 0;
  for (const [slug, rawEntry] of Object.entries(slugs)) {
    const entry = requiredRecord(rawEntry, `registre.slugs.${slug}`);
    const changed = Object.hasOwn(entry, "reglement_ancien_numero")
      || Object.hasOwn(entry, "reglement_ancien_millesime")
      || Object.hasOwn(entry, "reglement_ancien_source");
    delete entry.reglement_ancien_numero;
    delete entry.reglement_ancien_millesime;
    delete entry.reglement_ancien_source;
    if (changed) changedSlugs += 1;
  }
  return changedSlugs;
}

interface Options {
  readonly readinessPath: string;
  readonly dryRun: boolean;
  readonly strip: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  let readinessPath = DEFAULT_READINESS_PATH;
  let dryRun = false;
  let strip = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--strip") {
      strip = true;
    } else if (argument.startsWith("--readiness=")) {
      readinessPath = resolve(ROOT, argument.slice("--readiness=".length));
    } else if (argument === "--readiness") {
      const supplied = argv[index + 1];
      if (supplied === undefined || supplied.startsWith("--")) throw new Error("--readiness requiert un chemin local");
      readinessPath = resolve(ROOT, supplied);
      index += 1;
    } else {
      throw new Error(`option inconnue: ${argument}`);
    }
  }
  return { readinessPath, dryRun, strip };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const registry = readJson(REGISTRY_PATH);
  const readiness = readJson(options.readinessPath);
  // Always inspect the artefact, including --strip, so its partition guard is never bypassed.
  const entries = readAncienReadiness(readiness);

  if (options.strip) {
    const changedSlugs = stripAncienFields(registry);
    if (!options.dryRun) writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    console.log(`${options.dryRun ? "DRY-RUN" : "STRIP"}: ${changedSlugs} slug(s) changé(s); 3 champs retirés de tous les slugs`);
    console.log(`READINESS: N = ${entries.length}`);
    return;
  }

  const result = stampAncienFromReadiness(registry, readiness);
  if (!options.dryRun) writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`${options.dryRun ? "DRY-RUN" : "STAMP"}: ${result.changedSlugs}/${result.expectedCount} slug(s) changé(s)`);
  console.log(`VALIDATION reglement_ancien_numero: ${result.actualCount} == N (${result.expectedCount})`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
