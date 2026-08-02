/**
 * Cross non-covered municipalities with captured CAS documents whose final
 * deduplicated PV outcome is not INDEXED.
 *
 * This analysis is read-only: it reuses the coverage observation loader, then
 * writes only the requested local report artifacts.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-non-indexe-sur-non-couvertes.ts \
 *     --out=work/coverage/pv-non-indexe-sur-non-couvertes-YYYYMMDDTHHMMSSZ.json \
 *     --markdown=work/coverage/pv-non-indexe-sur-non-couvertes-YYYYMMDDTHHMMSSZ.md
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateObservations,
  loadObservations,
  type CoverageObservation,
  type FinalOutcome,
} from "./pv-couverture-municipale";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface SourceReference {
  readonly source: string;
  readonly sourceKind: string;
}

interface NonIndexedDocument extends SourceReference {
  readonly storage_key: string;
  readonly outcome: FinalOutcome;
  readonly terminal_sources: readonly SourceReference[];
}

interface MunicipalityCrossing {
  readonly slug: string;
  readonly name: string;
  readonly observation_status: "documents captés non indexés" | "captés, sans verdict final non indexé attribuable" | "aucun octet";
  readonly captured_documents: number;
  readonly non_indexed_documents: readonly NonIndexedDocument[];
}

function absolutePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function relativePath(path: string): string {
  return relative(ROOT, path);
}

function outputPath(argument: "--out" | "--markdown", extension: ".json" | ".md"): string {
  const value = process.argv.slice(2).find((entry) => entry.startsWith(`${argument}=`))?.slice(argument.length + 1);
  if (!value) throw new Error(`${argument}=... est requis`);
  const path = absolutePath(value);
  if (!path.startsWith(`${absolutePath("work/coverage")}/`)) throw new Error(`${argument} doit rester sous work/coverage`);
  if (!path.endsWith(extension)) throw new Error(`${argument} doit finir par ${extension}`);
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relativePath(path)}`);
  return path;
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { flag: "wx" });
}

function compareSource(left: SourceReference, right: SourceReference): number {
  return left.source.localeCompare(right.source) || left.sourceKind.localeCompare(right.sourceKind);
}

function sourceReferences(observations: readonly CoverageObservation[]): readonly SourceReference[] {
  const seen = new Map<string, SourceReference>();
  for (const observation of observations) {
    const source = { source: observation.source, sourceKind: observation.sourceKind };
    seen.set(`${source.source}\u0000${source.sourceKind}`, source);
  }
  return [...seen.values()].sort(compareSource);
}

function documentsByMunicipality(
  observations: readonly CoverageObservation[],
  finalByCas: ReadonlyMap<string, FinalOutcome>,
): ReadonlyMap<string, readonly NonIndexedDocument[]> {
  const observationsByCas = new Map<string, CoverageObservation[]>();
  for (const observation of observations) {
    const values = observationsByCas.get(observation.storageKey) ?? [];
    values.push(observation);
    observationsByCas.set(observation.storageKey, values);
  }

  const bySlug = new Map<string, NonIndexedDocument[]>();
  for (const [storageKey, outcome] of finalByCas) {
    if (outcome === "INDEXED") continue;
    const terminalBySlug = new Map<string, CoverageObservation[]>();
    for (const observation of observationsByCas.get(storageKey) ?? []) {
      if (observation.outcome !== outcome || observation.slug === null) continue;
      const values = terminalBySlug.get(observation.slug) ?? [];
      values.push(observation);
      terminalBySlug.set(observation.slug, values);
    }
    for (const [slug, terminalObservations] of terminalBySlug) {
      const terminalSources = sourceReferences(terminalObservations);
      const primary = terminalSources[0];
      if (!primary) throw new Error(`${storageKey}: source terminal requis`);
      const documents = bySlug.get(slug) ?? [];
      documents.push({
        storage_key: storageKey,
        outcome,
        source: primary.source,
        sourceKind: primary.sourceKind,
        terminal_sources: terminalSources,
      });
      bySlug.set(slug, documents);
    }
  }

  return new Map([...bySlug.entries()].map(([slug, documents]) => [slug, documents.sort((left, right) => left.storage_key.localeCompare(right.storage_key))]));
}

function capturedDocumentsByMunicipality(observations: readonly CoverageObservation[]): ReadonlyMap<string, ReadonlySet<string>> {
  const bySlug = new Map<string, Set<string>>();
  for (const observation of observations) {
    if (observation.slug === null) continue;
    const keys = bySlug.get(observation.slug) ?? new Set<string>();
    keys.add(observation.storageKey);
    bySlug.set(observation.slug, keys);
  }
  return bySlug;
}

function outcomeBreakdown(documents: readonly NonIndexedDocument[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const document of documents) counts.set(document.outcome, (counts.get(document.outcome) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function markdown(
  generatedAt: string,
  municipalities: readonly MunicipalityCrossing[],
  uniqueCasKeys: number,
  indexedCasKeys: number,
): string {
  const reviewTargets = municipalities.filter((municipality) => municipality.non_indexed_documents.length > 0);
  const emptyMunicipalities = municipalities.filter((municipality) => municipality.observation_status === "aucun octet");
  const capturedWithoutAttributableTerminal = municipalities.filter((municipality) => municipality.observation_status === "captés, sans verdict final non indexé attribuable");
  const top30 = municipalities.slice(0, 30);
  return [
    "# PV non indexés — municipalités non couvertes",
    "",
    `Généré : ${generatedAt}`,
    "",
    `Clés CAS dédupliquées : **${uniqueCasKeys}**; verdict final \`INDEXED\` : **${indexedCasKeys}**.`,
    `Municipalités non couvertes avec au moins un document capté mais non indexé (cibles de relecture) : **${reviewTargets.length}**.`,
    `Municipalités sans aucune observation attribuée (vraiment vides, à découvrir) : **${emptyMunicipalities.length}**.`,
    `Municipalités avec des observations, mais sans verdict final non indexé attribuable : **${capturedWithoutAttributableTerminal.length}**.`,
    "",
    "## Top 30",
    "",
    "| slug | nom | documents non indexés | répartition par outcome |",
    "| --- | --- | ---: | --- |",
    ...top30.map((municipality) => `| ${municipality.slug} | ${municipality.name} | ${municipality.non_indexed_documents.length} | ${Object.entries(outcomeBreakdown(municipality.non_indexed_documents)).map(([outcome, count]) => `${outcome}=${count}`).join(", ") || "aucun octet"} |`),
    "",
  ].join("\n");
}

function main(): void {
  const output = outputPath("--out", ".json");
  const markdownOutput = outputPath("--markdown", ".md");
  const generatedAt = new Date().toISOString();
  const { observations, municipalities, partitionSlugs, universeKeys } = loadObservations();
  const aggregation = aggregateObservations(observations, municipalities, partitionSlugs, universeKeys);
  const documents = documentsByMunicipality(observations, aggregation.finalByCas);
  const captured = capturedDocumentsByMunicipality(observations);
  const crossedMunicipalities: MunicipalityCrossing[] = [...municipalities]
    .filter(([slug]) => !aggregation.coveredSlugs.has(slug))
    .map(([slug, name]) => {
      const nonIndexedDocuments = documents.get(slug) ?? [];
      const capturedDocuments = captured.get(slug)?.size ?? 0;
      const observationStatus: MunicipalityCrossing["observation_status"] = nonIndexedDocuments.length > 0
        ? "documents captés non indexés"
        : capturedDocuments > 0
          ? "captés, sans verdict final non indexé attribuable"
          : "aucun octet";
      return {
        slug,
        name,
        observation_status: observationStatus,
        captured_documents: capturedDocuments,
        non_indexed_documents: nonIndexedDocuments,
      };
    })
    .sort((left, right) => right.non_indexed_documents.length - left.non_indexed_documents.length || left.slug.localeCompare(right.slug));
  const reviewTargets = crossedMunicipalities.filter((municipality) => municipality.non_indexed_documents.length > 0);
  const emptyMunicipalities = crossedMunicipalities.filter((municipality) => municipality.observation_status === "aucun octet");
  const report = {
    contract: "pv-non-indexe-sur-non-couvertes/v1",
    generated_at: generatedAt,
    read_only_aggregation: true,
    observation_loader: "acquisition/src/pv-couverture-municipale.ts#loadObservations",
    definition: {
      target: "Municipalité absente de coveredSlugs avec au moins une clé CAS dont le verdict final dédupliqué n'est pas INDEXED et dont une observation terminale porte ce slug.",
      empty: "Municipalité sans aucune observation portant son slug; aucun octet n'est déduit d'une absence de verdict.",
      source_selection: "source et sourceKind sont la première provenance terminale par ordre lexical; terminal_sources conserve toutes les provenances terminales verbatim.",
    },
    reference: {
      municipalities: municipalities.size,
      covered_municipalities: aggregation.coveredSlugs.size,
      non_covered_municipalities: crossedMunicipalities.length,
    },
    deduplication: {
      unique_cas_keys: aggregation.finalByCas.size,
      indexed_cas_keys: aggregation.outcomeCounts.get("INDEXED") ?? 0,
    },
    summary: {
      review_target_municipalities: reviewTargets.length,
      really_empty_municipalities: emptyMunicipalities.length,
      captured_without_attributable_terminal_non_indexed: crossedMunicipalities.length - reviewTargets.length - emptyMunicipalities.length,
    },
    municipalities: crossedMunicipalities,
  };
  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(
    generatedAt,
    crossedMunicipalities,
    aggregation.finalByCas.size,
    aggregation.outcomeCounts.get("INDEXED") ?? 0,
  ));
  process.stdout.write(`${JSON.stringify({
    json: relativePath(output),
    markdown: relativePath(markdownOutput),
    review_target_municipalities: reviewTargets.length,
    really_empty_municipalities: emptyMunicipalities.length,
    unique_cas_keys: aggregation.finalByCas.size,
    indexed_cas_keys: aggregation.outcomeCounts.get("INDEXED") ?? 0,
  })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
