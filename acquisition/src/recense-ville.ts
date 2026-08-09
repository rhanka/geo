/**
 * recense-ville.ts — PHASE DE RECHERCHE INITIALE (recenseur), par ville.
 *
 * Pour une ville donnée, ce recenseur :
 *   1. DÉTECTE sa plateforme en sondant son site officiel — via
 *      `recensePlatformForCity` (geo/catalog) + l'annuaire `websiteForSlug`
 *      (geo-sources-americas, MAMH). HTTP seulement, AUCUN LLM, AUCUN crédit.
 *   2. CATALOGUE ses sources connues (présence dans ALL_PV_CITIES pour les PV,
 *      dans l'audit zonage on-disk pour les zones, dans les configs de normes),
 *      + déduit les tracks plausibles de la plateforme détectée.
 *   3. REMPLIT, par couche, la liste PRIORISÉE de candidateTracks et VALIDE la
 *      1re voie réaliste (premier track dont les indices sont réunis).
 *
 * "Gratuit" : une seule requête HTTP par ville (la détection de plateforme).
 * Tout le reste est catalogue/lecture disque. `fetchImpl` est injectable
 * (ADR-0007) pour les tests hermétiques.
 *
 * Sortie : un `CityRecensement` par ville (plateforme + tracks candidats validés
 * par couche), directement applicable à la matrice (cf. applyRecensement).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recensePlatformForCity,
  type PlatformDetectionResult,
  type CityNotInDirectoryResult,
} from "@sentropic/geo/catalog/recense-platform.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import {
  COVERAGE_LAYERS,
  COVERAGE_TRACKS,
  type CoverageLayer,
  type TrackPlatform,
} from "./coverage-tracks.js";
import { type CoverageMatrix, setCell } from "./coverage-matrix.js";

type DetectedPlatform = PlatformDetectionResult["platform"];

// Repo-relative (resolved from this module's location, cwd-independent).
const HERE = dirname(fileURLToPath(import.meta.url)); // acquisition/src
const AUDIT_ZONAGE = resolve(HERE, "../../work/immo-audit/zonage-resolution.json");
const NORMS_MUNIS = resolve(HERE, "../../work/zonage-norms/munis.json");

/** Résultat du recensement d'une couche pour une ville. */
export interface LayerRecensement {
  readonly layer: CoverageLayer;
  /** Tracks candidats priorisés (ids), filtrés/réordonnés par les indices trouvés. */
  readonly candidateTracks: readonly string[];
  /** 1re voie réaliste validée (id) — `null` si seules les voies de repli restent. */
  readonly firstViableTrack: string | null;
  /** Pourquoi cette voie (preuve : config présente, plateforme détectée, etc.). */
  readonly evidence: string;
}

/** Résultat du recensement d'une ville (les 6 couches). */
export interface CityRecensement {
  readonly slug: string;
  readonly siteUrl: string | null;
  readonly platform: DetectedPlatform;
  readonly platformEvidence: string;
  readonly recensedAt: string;
  readonly layers: readonly LayerRecensement[];
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── indices catalogue (lecture disque, mémoïsés) ─────────────────────────────
let PV_SLUGS: Set<string> | null = null;
function pvConfiguredSlugs(): Set<string> {
  if (!PV_SLUGS)
    PV_SLUGS = new Set(ALL_PV_CITIES.map((c) => c.config.citySlug));
  return PV_SLUGS;
}

interface ZonageAuditRow {
  readonly ville: string;
  readonly statut: "couvert" | "absent";
  readonly collection_id: string | null;
}
let ZONE_COVERED: Map<string, string> | null = null; // slug → track
function zoneCoveredSlugs(): Map<string, string> {
  if (!ZONE_COVERED) {
    ZONE_COVERED = new Map();
    const rows = readJson<ZonageAuditRow[]>(AUDIT_ZONAGE) ?? [];
    for (const r of rows) {
      if (r.statut !== "couvert") continue;
      const id = r.collection_id ?? "";
      ZONE_COVERED.set(r.ville, id.endsWith("-arcgis") ? "disaggregation" : "agol-account");
    }
  }
  return ZONE_COVERED;
}

interface NormMuni {
  readonly slug: string;
  readonly route: "native" | "vision" | "multizone" | "none";
}
let NORM_SLUGS: Map<string, string> | null = null; // slug → track
function normSlugs(): Map<string, string> {
  if (!NORM_SLUGS) {
    NORM_SLUGS = new Map();
    const cfg = readJson<{ munis: NormMuni[] }>(NORMS_MUNIS);
    for (const m of cfg?.munis ?? []) {
      NORM_SLUGS.set(m.slug, m.route === "vision" ? "pdf-vision" : "pdf-native");
    }
  }
  return NORM_SLUGS;
}

/** Mappe une plateforme détectée vers les ids de tracks qu'elle débloque. */
function platformTrackIds(p: DetectedPlatform): readonly string[] {
  const map: Partial<Record<DetectedPlatform, readonly string[]>> = {
    arcgis: ["agol-account"],
    ckan: ["ckan"],
    jmap: ["jmap"],
    gonet: ["gonet"],
    pdf: ["pdf-georef-t1", "pdf-vectorize-t2", "pdf-raster-t3", "pdf-scan-t4"],
    unknown: [],
  };
  return map[p] ?? [];
}

/**
 * Recense une couche : priorise les tracks de la couche en remontant ceux que
 * les indices (config présente, plateforme détectée) rendent réalistes, puis
 * conserve les autres comme repli. Renvoie la 1re voie réaliste validée.
 */
function recenseLayer(
  layer: CoverageLayer,
  slug: string,
  platform: DetectedPlatform,
): LayerRecensement {
  const all = COVERAGE_TRACKS[layer].map((t) => t.id);
  const boosted = new Set<string>();
  let firstViable: string | null = null;
  let evidence = "aucun indice direct — voies de repli universelles disponibles";

  // 1) indices catalogue spécifiques à la couche
  if (layer === "pv" && pvConfiguredSlugs().has(slug)) {
    boosted.add("scraper-configured");
    firstViable = "scraper-configured";
    evidence = "config PV présente (ALL_PV_CITIES)";
  } else if (layer === "zones" && zoneCoveredSlugs().has(slug)) {
    const tr = zoneCoveredSlugs().get(slug)!;
    boosted.add(tr);
    firstViable = tr;
    evidence = `zonage couvert via ${tr} (audit on-disk)`;
  } else if (layer === "normes" && normSlugs().has(slug)) {
    const tr = normSlugs().get(slug)!;
    boosted.add(tr);
    firstViable = tr;
    evidence = `grille de normes connue via ${tr} (config norms)`;
  } else if (layer === "cadastre" || layer === "role-foncier" || layer === "pmtiles") {
    // couches province : track unique toujours en tête.
    firstViable = all[0] ?? null;
    evidence = "couche province (track unique)";
  }

  // 2) indices plateforme (boostent les tracks correspondants)
  for (const id of platformTrackIds(platform)) {
    if (all.includes(id)) {
      boosted.add(id);
      if (!firstViable) {
        firstViable = id;
        evidence = `plateforme '${platform}' détectée → ${id}`;
      }
    }
  }

  // 3) ordre final : boostés (ordre taxonomie) puis le reste (ordre taxonomie)
  const ordered = [
    ...all.filter((id) => boosted.has(id)),
    ...all.filter((id) => !boosted.has(id)),
  ];

  return { layer, candidateTracks: ordered, firstViableTrack: firstViable, evidence };
}

/**
 * Recense une ville : 1 requête HTTP (détection plateforme) + catalogue. Renvoie
 * le recensement complet (6 couches). `fetchImpl` injectable (hermétique).
 */
export async function recenseVille(
  slug: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CityRecensement> {
  const detection: PlatformDetectionResult | CityNotInDirectoryResult =
    await recensePlatformForCity(slug, websiteForSlug, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      timeoutMs: opts.timeoutMs ?? 8000,
    });

  const platform = detection.platform;
  const siteUrl = detection.siteUrl;
  const platformEvidence = detection.success
    ? detection.evidence
    : (detection.errorMessage ?? "détection échouée");

  const layers = COVERAGE_LAYERS.map((layer) =>
    recenseLayer(layer, slug, platform),
  );

  return {
    slug,
    siteUrl,
    platform,
    platformEvidence,
    recensedAt: new Date().toISOString(),
    layers,
  };
}

/**
 * Applique un recensement à la matrice : met à jour candidateTracks + la date de
 * recensement de chaque couche, SANS rétrograder une cellule déjà 'done'/'planned'
 * (le recensement renseigne le plan, il ne défait pas l'état mesuré).
 */
export function applyRecensement(
  matrix: CoverageMatrix,
  rec: CityRecensement,
): CoverageMatrix {
  let next = matrix;
  for (const l of rec.layers) {
    const cur = next.cities[rec.slug]?.[l.layer];
    if (!cur) continue;
    next = setCell(next, rec.slug, l.layer, {
      candidateTracks: l.candidateTracks,
      lastResearchAt: rec.recensedAt,
      // statut inchangé : on n'écrase pas l'état seedé.
    });
  }
  return next;
}

/** Plateforme détectée → libellé court pour l'affichage. */
export function platformLabel(p: TrackPlatform | DetectedPlatform): string {
  return p;
}
