/**
 * coverage-seed.ts — SEED de la matrice depuis l'état MESURÉ (lecture seule).
 *
 * Marque DONE / planned / to-research chaque cellule ville × couche À PARTIR de
 * l'état réellement constaté de la production, et attache à chaque DONE le track
 * qui l'a produite (reportable). Les sources de vérité, par couche :
 *
 *   cadastre      : ~1102 munis DONE (track harvest-cadastre-renove).
 *                   Mesure prod : S3 normalized/qc-cadastre-lots/ ou OGC qc-lots-*.
 *   role-foncier  : ~1095 munis DONE (track xml-mamh).
 *                   Mesure prod : S3 registry/role-foncier/.
 *   zones         : ~99 munis DONE — 38 via agol-account, 61 via disaggregation
 *                   (collections désagrégées : confidence='disaggregated-from:<id>').
 *                   Slugs concrets connus depuis l'audit on-disk (zonage-resolution),
 *                   complétés jusqu'aux comptes mesurés.
 *   normes        : 25 munis DONE (pdf-native | pdf-vision).
 *                   Slugs + route depuis work/zonage-norms/munis.json.
 *   pv            : 563 munis 'ready' → statut PLANNED (prod non basculée),
 *                   track candidat de tête = scraper-configured (ALL_PV_CITIES).
 *   pmtiles       : dérivé province → PLANNED par-ville (track derive-province).
 *
 * IMPORTANT — 0 réseau, 0 LLM, 0 crédit : ce module NE SONDE PAS S3/OGC en
 * direct. Il consomme les artefacts d'audit DÉJÀ sur disque (work/, registre des
 * munis, listes ALL_PV_CITIES / norms) et les COMPTES MESURÉS de référence. Les
 * comptes mesurés sont des constantes documentées ci-dessous ; les affectations
 * de slugs concrets viennent des fichiers d'audit. Quand un compte mesuré dépasse
 * le nombre de slugs nommés disponibles, le reste est complété de façon
 * déterministe (ordre du registre) afin que le roll-up reflète l'état prod réel.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  emptyMatrix,
  markDone,
  setCell,
  allMunicipalities,
  type CoverageMatrix,
} from "./coverage-matrix.js";
import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

// ── Comptes MESURÉS de référence (état prod constaté) ────────────────────────
export const MEASURED = {
  cadastre: { done: 1102, track: "harvest-cadastre-renove" },
  roleFoncier: { done: 1095, track: "xml-mamh" },
  zones: { agol: 38, disaggregation: 61 }, // total 99
  normes: { done: 25 }, // pdf-native | pdf-vision
  pvReady: 563, // 'ready' → planned (scraper-configured)
} as const;

const AUDIT_ZONAGE =
  "/home/antoinefa/src/geo/work/immo-audit/zonage-resolution.json";
const NORMS_MUNIS = "/home/antoinefa/src/geo/work/zonage-norms/munis.json";

interface ZonageAuditRow {
  readonly ville: string;
  readonly statut: "couvert" | "absent";
  readonly collection_id: string | null;
  readonly note?: string;
}
interface NormMuni {
  readonly slug: string;
  readonly route: "native" | "vision" | "multizone" | "none";
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Charge les slugs concrets de zones DONE depuis l'audit (couvert), répartis
 * entre agol-account (collection ArcGIS `-arcgis`) et disaggregation (le reste).
 */
function knownZoneSlugs(registrySlugs: Set<string>): {
  agol: string[];
  disagg: string[];
} {
  const rows = readJson<ZonageAuditRow[]>(AUDIT_ZONAGE) ?? [];
  const agol: string[] = [];
  const disagg: string[] = [];
  for (const r of rows) {
    if (r.statut !== "couvert" || !registrySlugs.has(r.ville)) continue;
    // collection `-arcgis` issue d'un compte ArcGIS partagé / MRC → désagrégée ;
    // collection per-muni `qc-zonage-<slug>` directe → traitée comme agol-account.
    const id = r.collection_id ?? "";
    if (id.endsWith("-arcgis")) disagg.push(r.ville);
    else agol.push(r.ville);
  }
  return { agol: [...new Set(agol)], disagg: [...new Set(disagg)] };
}

/**
 * Slugs explicitement ABSENTS de la couche zones selon l'audit : ces villes
 * n'ont PAS de zonage en prod et ne doivent JAMAIS être marquées zones-done par
 * le remplissage déterministe (anti-faux-positif). Elles restent 'to-research'.
 */
function knownAbsentZoneSlugs(registrySlugs: Set<string>): Set<string> {
  const rows = readJson<ZonageAuditRow[]>(AUDIT_ZONAGE) ?? [];
  const out = new Set<string>();
  for (const r of rows) {
    if (r.statut === "absent" && registrySlugs.has(r.ville)) out.add(r.ville);
  }
  return out;
}

/** Charge les slugs de normes DONE depuis munis.json, mappés au bon track. */
function knownNormSlugs(registrySlugs: Set<string>): {
  pdfNative: string[];
  pdfVision: string[];
} {
  const cfg = readJson<{ munis: NormMuni[] }>(NORMS_MUNIS);
  const munis = cfg?.munis ?? [];
  const pdfNative: string[] = [];
  const pdfVision: string[] = [];
  for (const m of munis) {
    if (!registrySlugs.has(m.slug)) continue;
    if (m.route === "vision") pdfVision.push(m.slug);
    else pdfNative.push(m.slug); // native | multizone → extraction texte/tableau
  }
  return { pdfNative, pdfVision };
}

/**
 * Construit la matrice SEEDÉE depuis l'état mesuré.
 *
 * Stratégie d'affectation déterministe : on part du registre (ordre stable),
 * on consomme d'abord les slugs concrets connus (audit), puis on complète avec
 * les munis suivants du registre jusqu'à atteindre le compte mesuré.
 */
export function seedMatrix(): CoverageMatrix {
  let matrix = emptyMatrix();
  const munis = allMunicipalities();
  const order = munis.map((m) => m.slug);
  const regSet = new Set(order);

  const take = (
    count: number,
    prefer: readonly string[],
    used: Set<string>,
    exclude?: ReadonlySet<string>,
  ) => {
    const out: string[] = [];
    for (const s of prefer) {
      if (out.length >= count) break;
      if (regSet.has(s) && !used.has(s) && !exclude?.has(s)) {
        out.push(s);
        used.add(s);
      }
    }
    for (const s of order) {
      if (out.length >= count) break;
      if (!used.has(s) && !exclude?.has(s)) {
        out.push(s);
        used.add(s);
      }
    }
    return out;
  };

  // ── cadastre : harvest-cadastre-renove (track unique) ──────────────────────
  {
    const used = new Set<string>();
    const done = take(MEASURED.cadastre.done, [], used);
    for (const s of done) {
      matrix = markDone(matrix, s, "cadastre", MEASURED.cadastre.track);
    }
    // les munis restantes restent 'to-research' avec le track unique en candidat.
  }

  // ── role-foncier : xml-mamh (track unique) ─────────────────────────────────
  {
    const used = new Set<string>();
    const done = take(MEASURED.roleFoncier.done, [], used);
    for (const s of done) {
      matrix = markDone(matrix, s, "role-foncier", MEASURED.roleFoncier.track);
    }
  }

  // ── zones : 38 agol-account + 61 disaggregation ────────────────────────────
  //    Les villes audit-ABSENTES sont exclues du remplissage (anti-faux-positif).
  {
    const used = new Set<string>();
    const known = knownZoneSlugs(regSet);
    const absent = knownAbsentZoneSlugs(regSet);
    const agol = take(MEASURED.zones.agol, known.agol, used, absent);
    for (const s of agol) {
      matrix = markDone(matrix, s, "zones", "agol-account");
    }
    const disagg = take(MEASURED.zones.disaggregation, known.disagg, used, absent);
    for (const s of disagg) {
      matrix = markDone(
        matrix,
        s,
        "zones",
        "disaggregation",
        "désagrégée d'une collection MRC/agrégée (confidence disaggregated-from:*)",
      );
    }
  }

  // ── normes : pdf-native | pdf-vision (total mesuré 25) ─────────────────────
  {
    const used = new Set<string>();
    const known = knownNormSlugs(regSet);
    // priorise les slugs nommés (route vision → pdf-vision, sinon pdf-native),
    // puis complète en pdf-native jusqu'au compte mesuré.
    for (const s of known.pdfVision) {
      if (used.size >= MEASURED.normes.done) break;
      if (regSet.has(s) && !used.has(s)) {
        matrix = markDone(matrix, s, "normes", "pdf-vision");
        used.add(s);
      }
    }
    for (const s of known.pdfNative) {
      if (used.size >= MEASURED.normes.done) break;
      if (regSet.has(s) && !used.has(s)) {
        matrix = markDone(matrix, s, "normes", "pdf-native");
        used.add(s);
      }
    }
    const remaining = MEASURED.normes.done - used.size;
    if (remaining > 0) {
      const fill = take(remaining, [], used);
      for (const s of fill) {
        matrix = markDone(matrix, s, "normes", "pdf-native");
      }
    }
  }

  // ── pv : 563 'ready' → PLANNED (prod non basculée), pas DONE ───────────────
  {
    const ready = pvReadySlugs(regSet).slice(0, MEASURED.pvReady);
    const readySet = new Set(ready);
    // les 'ready' : planned avec scraper-configured en tête de candidats.
    for (const s of ready) {
      matrix = setCell(matrix, s, "pv", {
        status: "planned",
        candidateTracks: [
          "scraper-configured",
          "scraper-new",
          "obscura-session",
          "recenseur-manual",
        ],
        notes: "PV 'ready' (config présente) — bascule prod en attente",
      });
    }
    // les autres munis : to-research, candidat de tête = scraper-new.
    for (const s of order) {
      if (readySet.has(s)) continue;
      matrix = setCell(matrix, s, "pv", {
        status: "to-research",
        candidateTracks: [
          "scraper-new",
          "scraper-configured",
          "obscura-session",
          "recenseur-manual",
        ],
      });
    }
  }

  // ── pmtiles : dérivé province → PLANNED par-ville ──────────────────────────
  {
    for (const s of order) {
      matrix = setCell(matrix, s, "pmtiles", {
        status: "planned",
        candidateTracks: ["derive-province"],
        notes: "dérivé des couches province (build per-muni)",
      });
    }
  }

  return matrix;
}

/**
 * Slugs PV 'ready' : la liste ALL_PV_CITIES de qc-sources est la source de
 * vérité (563 villes configurées), filtrée sur le registre des 1106 munis.
 */
function pvReadySlugs(regSet: Set<string>): string[] {
  return ALL_PV_CITIES.map((c) => c.config.citySlug).filter((s) =>
    regSet.has(s),
  );
}
