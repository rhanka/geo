/**
 * Helper de priorisation pour le vertical géo (WP B).
 *
 * Critères de tri (ordre décroissant d'importance) :
 *   1. Qualité des lots : `geojson` > `html` > `pdf` > `none`
 *      (un lot vectoriel est le prérequis minimal pour l'intersection cadastre↔zonage)
 *   2. Nombre de signaux opportunité (fenêtre ≤ 6 mois) : plus de signaux = plus d'urgence
 *   3. Qualité du zonage : `geojson` > `html` > `pdf` > `none`
 *      (zonage vectoriel permet l'automatisation de l'intersection lot↔zone)
 *
 * Le résultat est un tableau d'entrées triées, les villes les plus prioritaires en premier.
 */

import type { GeoSourceInventoryT, GeoDataQualityT } from "./geo-source-inventory.js";

/** Mapping qualité → score numérique (plus haut = plus prioritaire). */
const QUALITY_SCORE: Record<GeoDataQualityT, number> = {
  geojson: 3,
  html: 2,
  pdf: 1,
  none: 0,
};

/** Signal simplifié pour le calcul de priorité géo-vertical. */
export interface SignalRef {
  /** Slug de la ville associée au signal. */
  citySlug: string;
  /** Date de détection ISO-8601 (YYYY-MM-DD ou datetime). */
  detectedAt: string;
}

/** Entrée du résultat de priorisation. */
export interface GeoVerticalPriorityEntry {
  /** L'inventaire géo de la ville. */
  inventory: GeoSourceInventoryT;
  /** Nombre de signaux opportunité dans la fenêtre ≤ 6 mois. */
  recentSignalCount: number;
  /**
   * Score composite :
   *   lotsScore (0-3) × 100 + recentSignalCount + zonageScore (0-3)
   *
   * Ce poids assure que la disponibilité GeoJSON des lots est discriminante
   * sans écraser le critère signal (très faible volume en phase 1).
   */
  compositeScore: number;
}

/** Fenêtre glissante par défaut pour les signaux "récents" (en jours). */
const DEFAULT_WINDOW_DAYS = 183; // ~6 mois

/**
 * Trie les inventaires géo par priorité pour le vertical géo (WP B).
 *
 * @param inventories  - Liste des inventaires GeoSourceInventory à trier.
 * @param signals      - Signaux / opportunités de référence (pour compter les récents).
 * @param referenceDate - Date de référence ISO-8601 (défaut : aujourd'hui). Utile pour les tests.
 * @param windowDays   - Fenêtre de pertinence des signaux en jours (défaut : 183).
 * @returns            Tableau trié par score composite décroissant.
 */
export function prioritizeForGeoVertical(
  inventories: readonly GeoSourceInventoryT[],
  signals: readonly SignalRef[],
  referenceDate?: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): GeoVerticalPriorityEntry[] {
  const refMs = referenceDate
    ? new Date(referenceDate).getTime()
    : Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoffMs = refMs - windowMs;

  return inventories
    .map((inventory): GeoVerticalPriorityEntry => {
      const recentSignalCount = signals.filter((s) => {
        if (s.citySlug !== inventory.citySlug) return false;
        const ts = new Date(s.detectedAt).getTime();
        return ts >= cutoffMs && ts <= refMs;
      }).length;

      const lotsScore = QUALITY_SCORE[inventory.lots.quality];
      const zonageScore = QUALITY_SCORE[inventory.zonage.quality];

      // Lots sont le prérequis dur : poids 100×. Signaux : poids 1× (bascule
      // à volume équivalent de lots). Zonage : tie-breaker final.
      const compositeScore = lotsScore * 100 + recentSignalCount + zonageScore;

      return { inventory, recentSignalCount, compositeScore };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);
}
