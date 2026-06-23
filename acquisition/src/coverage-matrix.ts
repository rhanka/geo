/**
 * coverage-matrix.ts — MODÈLE D'ÉTAT par ville × couche + store JSON.
 *
 * État cible : les 1106 municipalités × 6 couches. Pour chaque cellule on
 * conserve son statut ('done'|'planned'|'to-research'), le track qui l'a faite
 * (`doneTrack`) le cas échéant, la liste PRIORISÉE des tracks candidats (ids de
 * `coverage-tracks.ts`), la date du dernier recensement et des notes.
 *
 * Le store est un simple JSON sous `work/coverage/coverage-matrix.json`,
 * régénérable et diff-able. Aucun réseau, aucun LLM : pure lecture/écriture
 * disque + lecture du registre des 1106 munis et de la taxonomie.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  COVERAGE_LAYERS,
  type CoverageLayer,
  trackIdsFor,
} from "./coverage-tracks.js";
import municipalitiesRaw from "../../packages/qc-sources/src/geo/municipalities.qc.json" with { type: "json" };

/** Statut d'une cellule ville × couche. */
export type CoverageStatus = "done" | "planned" | "to-research";

/** État d'une couche pour une ville. */
export interface CellState {
  readonly status: CoverageStatus;
  /** Id du track ayant produit la donnée (présent ssi status === 'done'). */
  readonly doneTrack?: string;
  /** Tracks candidats priorisés (ids de coverage-tracks), voie à tenter en tête. */
  readonly candidateTracks: readonly string[];
  /** ISO date du dernier recensement (recense-ville). */
  readonly lastResearchAt?: string;
  /** Notes libres (provenance, anomalies, id de collection, etc.). */
  readonly notes?: string;
}

/** État complet d'une ville (les 6 couches). */
export type CityCoverage = Record<CoverageLayer, CellState>;

/** Le store complet : slug → couverture. */
export interface CoverageMatrix {
  readonly $schema: "qc-coverage-matrix/v1";
  readonly generatedAt: string;
  /** Nombre de municipalités cibles (1106). */
  readonly municipalityCount: number;
  readonly cities: Record<string, CityCoverage>;
}

/** Une municipalité minimale lue du registre. */
export interface RegistryMuni {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

const MUNICIPALITIES = municipalitiesRaw as readonly RegistryMuni[];

export const MATRIX_PATH =
  "/home/antoinefa/src/geo/work/coverage/coverage-matrix.json";

/** Les 1106 municipalités cibles (slug + name + mrc). */
export function allMunicipalities(): readonly RegistryMuni[] {
  return MUNICIPALITIES;
}

/**
 * Construit une matrice VIERGE : chaque ville × couche démarre en
 * 'to-research', candidateTracks = la liste priorisée complète de la couche.
 * C'est l'état de départ avant SEED (cf. coverage-seed.ts) et avant recensement.
 */
export function emptyMatrix(): CoverageMatrix {
  const cities: Record<string, CityCoverage> = {};
  for (const m of MUNICIPALITIES) {
    const cov = {} as CityCoverage;
    for (const layer of COVERAGE_LAYERS) {
      cov[layer] = {
        status: "to-research",
        candidateTracks: trackIdsFor(layer),
      };
    }
    cities[m.slug] = cov;
  }
  return {
    $schema: "qc-coverage-matrix/v1",
    generatedAt: new Date().toISOString(),
    municipalityCount: MUNICIPALITIES.length,
    cities,
  };
}

/** Charge la matrice depuis le disque (ou `null` si absente). */
export function loadMatrix(path: string = MATRIX_PATH): CoverageMatrix | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CoverageMatrix;
}

/** Écrit la matrice sur disque (crée le dossier si besoin). */
export function saveMatrix(
  matrix: CoverageMatrix,
  path: string = MATRIX_PATH,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(matrix, null, 2) + "\n", "utf8");
}

/** Met à jour une cellule (renvoie une nouvelle matrice, immuable). */
export function setCell(
  matrix: CoverageMatrix,
  slug: string,
  layer: CoverageLayer,
  next: Partial<CellState>,
): CoverageMatrix {
  const city = matrix.cities[slug];
  if (!city) return matrix;
  const prev = city[layer];
  const merged: CellState = {
    status: next.status ?? prev.status,
    candidateTracks: next.candidateTracks ?? prev.candidateTracks,
    ...(next.doneTrack !== undefined
      ? { doneTrack: next.doneTrack }
      : prev.doneTrack !== undefined
        ? { doneTrack: prev.doneTrack }
        : {}),
    ...(next.lastResearchAt !== undefined
      ? { lastResearchAt: next.lastResearchAt }
      : prev.lastResearchAt !== undefined
        ? { lastResearchAt: prev.lastResearchAt }
        : {}),
    ...(next.notes !== undefined
      ? { notes: next.notes }
      : prev.notes !== undefined
        ? { notes: prev.notes }
        : {}),
  };
  return {
    ...matrix,
    cities: {
      ...matrix.cities,
      [slug]: { ...city, [layer]: merged },
    },
  };
}

/** Marque une cellule DONE via un track donné (reportable sur son track). */
export function markDone(
  matrix: CoverageMatrix,
  slug: string,
  layer: CoverageLayer,
  doneTrack: string,
  notes?: string,
): CoverageMatrix {
  return setCell(matrix, slug, layer, {
    status: "done",
    doneTrack,
    ...(notes !== undefined ? { notes } : {}),
  });
}
