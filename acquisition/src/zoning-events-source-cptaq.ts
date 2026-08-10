/**
 * Source adapter for CPTAQ agricultural de-zoning dossiers.
 *
 * A CPTAQ dossier is an independent source, not an inference from a municipal
 * PV.  The committed gisement supplies the capture-backed dossier URL, its
 * number, date, exact source span, and any verbatim municipal-zone mentions.
 * This adapter deliberately emits nothing when that evidence is absent.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runZoningEventsDryRun,
  s3ServedZoneCodesReader,
  type DetectedEventCandidate,
  type ZoningEventSourceAdapter,
} from "./zoning-events-detect-emit.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const COVERAGE = resolve(ROOT, "work", "coverage");
const GISEMENT_FILE = /^cptaq-(?:dossiers|gisement)(?:-[a-z0-9-]+)?\.json$/u;

export interface CptaqDossierSource {
  readonly city_slug: string;
  /** The source taxonomy is fixed and must be explicit in the gisement. */
  readonly category: "cptaq";
  /** Stable URL of the CPTAQ dossier, never a municipal PV URL. */
  readonly dossier_url: string;
  /** CPTAQ dossier number, extracted from the captured source. */
  readonly dossier_number: string;
  /** Source-grounded event date in YYYY-MM-DD. */
  readonly date_iso: string;
  readonly bylaw_numero?: string | null;
  /** Verbatim span from the dossier proving this entry. */
  readonly extrait_brut: string;
  readonly zone_mentions?: readonly { readonly mention_brute: string; readonly page: number | null }[];
}

export type CptaqDossierObservationState =
  | "dossier-cptaq-absent-du-gisement"
  | "dossier-cptaq-drop-sans-span"
  | "dossier-cptaq-drop-ancre-non-verbatim"
  | "dossier-cptaq-drop-champ-invalide";

export interface CptaqDossierObservation {
  readonly city_slug: string;
  readonly state: CptaqDossierObservationState;
  readonly dossier_url: string | null;
  readonly dossier_number: string | null;
  readonly reason: string;
}

export interface CptaqDossierAdapter extends ZoningEventSourceAdapter {
  readonly observations: readonly CptaqDossierObservation[];
}

export interface CptaqDossierAdapterOptions {
  /** Injectable in unit tests; production discovers committed coverage gisements. */
  readonly sources?: readonly CptaqDossierSource[];
  readonly gisementPaths?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dossierToken(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function sourceFromUnknown(value: unknown): CptaqDossierSource | null {
  if (!isRecord(value) || value.category !== "cptaq") return null;
  const citySlug = nonEmpty(value.city_slug);
  const dossierUrl = nonEmpty(value.dossier_url);
  const dossierNumber = nonEmpty(value.dossier_number);
  const dateIso = nonEmpty(value.date_iso);
  const extraitBrut = nonEmpty(value.extrait_brut);
  if (citySlug === null || dossierUrl === null || dossierNumber === null || dateIso === null || extraitBrut === null) return null;
  const zoneMentions = Array.isArray(value.zone_mentions)
    ? value.zone_mentions.flatMap((mention) => {
      if (!isRecord(mention)) return [];
      const mentionBrute = nonEmpty(mention.mention_brute);
      const page = mention.page;
      return mentionBrute !== null && (page === null || (typeof page === "number" && Number.isInteger(page) && page > 0))
        ? [{ mention_brute: mentionBrute, page }]
        : [];
    })
    : [];
  return {
    city_slug: citySlug,
    category: "cptaq",
    dossier_url: dossierUrl,
    dossier_number: dossierNumber,
    date_iso: dateIso,
    bylaw_numero: typeof value.bylaw_numero === "string" && value.bylaw_numero.trim() ? value.bylaw_numero.trim() : null,
    extrait_brut: extraitBrut,
    zone_mentions: zoneMentions,
  };
}

function sourcesFromGisement(path: string): CptaqDossierSource[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const rawSources = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.dossiers)
      ? parsed.dossiers
      : [];
  return rawSources.map(sourceFromUnknown).filter((source): source is CptaqDossierSource => source !== null);
}

function defaultGisementPaths(): string[] {
  if (!existsSync(COVERAGE)) return [];
  return readdirSync(COVERAGE)
    .filter((name) => GISEMENT_FILE.test(name))
    .map((name) => resolve(COVERAGE, name))
    .sort((left, right) => left.localeCompare(right));
}

function candidateFromSource(source: CptaqDossierSource): { candidate: DetectedEventCandidate | null; observation: CptaqDossierObservation | null } {
  const dossierUrl = nonEmpty(source.dossier_url);
  const dossierNumber = nonEmpty(source.dossier_number);
  const extraitBrut = nonEmpty(source.extrait_brut);
  const dateIso = nonEmpty(source.date_iso);
  if (dossierUrl === null || dossierNumber === null || dateIso === null || !isIsoDate(dateIso)) {
    return {
      candidate: null,
      observation: {
        city_slug: source.city_slug,
        state: "dossier-cptaq-drop-champ-invalide",
        dossier_url: dossierUrl,
        dossier_number: dossierNumber,
        reason: "dossier_url, dossier_number et date_iso YYYY-MM-DD sont requis",
      },
    };
  }
  if (extraitBrut === null) {
    return {
      candidate: null,
      observation: {
        city_slug: source.city_slug,
        state: "dossier-cptaq-drop-sans-span",
        dossier_url: dossierUrl,
        dossier_number: dossierNumber,
        reason: "extrait_brut verbatim absent",
      },
    };
  }
  if (!dossierToken(extraitBrut).includes(dossierToken(dossierNumber))) {
    return {
      candidate: null,
      observation: {
        city_slug: source.city_slug,
        state: "dossier-cptaq-drop-ancre-non-verbatim",
        dossier_url: dossierUrl,
        dossier_number: dossierNumber,
        reason: "le n° dossier n'apparait pas dans l'extrait_brut verbatim",
      },
    };
  }
  return {
    candidate: {
      source_ref: dossierUrl,
      detection_anchor: dossierNumber,
      type: "cptaq",
      date_iso: dateIso,
      bylaw_numero: source.bylaw_numero ?? null,
      zone_mentions: source.zone_mentions ?? [],
      extrait_brut: extraitBrut,
      url_pdf: dossierUrl,
    },
    observation: null,
  };
}

/**
 * Convert only category=`cptaq` source-backed dossiers into neutral events.
 * It never reads immo data, fetches a dossier, or emits an approximate zone.
 */
export function cptaqDossierAdapter(options: CptaqDossierAdapterOptions = {}): CptaqDossierAdapter {
  const sources = options.sources ?? (options.gisementPaths ?? defaultGisementPaths()).flatMap(sourcesFromGisement);
  const observations: CptaqDossierObservation[] = [];
  return {
    name: "cptaq-dossiers",
    get observations() { return observations; },
    async detect(citySlug) {
      const matching = sources.filter((source) => source.city_slug === citySlug);
      if (matching.length === 0) {
        observations.push({
          city_slug: citySlug,
          state: "dossier-cptaq-absent-du-gisement",
          dossier_url: null,
          dossier_number: null,
          reason: "aucun dossier category=cptaq dans le gisement CPTAQ disponible",
        });
        return [];
      }
      const unique = new Map<string, DetectedEventCandidate>();
      for (const source of matching) {
        const { candidate, observation } = candidateFromSource(source);
        if (observation !== null) observations.push(observation);
        if (candidate !== null) unique.set(`${candidate.source_ref}\u0000${candidate.detection_anchor}`, candidate);
      }
      return [...unique.values()].sort((left, right) => (
        left.source_ref.localeCompare(right.source_ref) || left.detection_anchor.localeCompare(right.detection_anchor)
      ));
    },
  };
}

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeObservations(outputDirectory: string, observations: readonly CptaqDossierObservation[]): void {
  const output = resolve(outputDirectory, "cptaq-observations.json");
  if (!output.startsWith(`${ROOT}/`)) throw new Error(`sortie hors dépôt: ${output}`);
  writeFileSync(output, `${JSON.stringify({ contract: "qc-zoning-events-cptaq-observations/v1", observations }, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function main(): Promise<void> {
  const citiesRaw = argumentValue("--cities");
  if (!citiesRaw) throw new Error("--cities=slug-a,slug-b est requis");
  const outputDirectory = argumentValue("--out") ?? "work/coverage/qc-zoning-events-dryrun-cptaq";
  const adapter = cptaqDossierAdapter();
  const result = await runZoningEventsDryRun({
    cities: citiesRaw.split(",").map((city) => city.trim()).filter(Boolean),
    adapter,
    servedZoneCodes: s3ServedZoneCodesReader(),
    outputDirectory,
  });
  writeObservations(outputDirectory, adapter.observations);
  process.stdout.write(`${JSON.stringify({ ...result, cptaq_observations: adapter.observations })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
