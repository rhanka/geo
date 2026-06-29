/**
 * Golden fixture for the OCR-VISION grille extractor — pilot muni
 * Saint-Stanislas-de-Kostka, Règlement de zonage 330-2018, Annexe A
 * "GRILLES DES USAGES ET NORMES PAR ZONE" (VERTICAL, 1 zone/page, native-text
 * but un-tabular under pdftotext — the exact case OCR-vision exists for).
 *
 * The `passA` / `passB` blobs below are the VERBATIM JSON the live Mistral vision
 * model (`mistral-medium-latest`) returned for each page on 2026-06-21 — captured
 * once, committed, and replayed in tests so CI never touches the network. They are
 * what the model actually emits, INCLUDING the cross-pass surface divergences we
 * designed the guards around:
 *   - FR decimal comma vs dot ("7,5" pass A ↔ "7.5" pass B for A-3) — the two
 *     reads MEAN the same number, so semantic concordance must publish 7.5.
 *   - an OCR mark on a superscript ("7.5'" ↔ "7.5" for A-5) — same number.
 *   - `hauteur_metres` legitimately empty in some pages → both passes null.
 *
 * Source PDF (page suffix = page index in the annex):
 *   https://st-stanislas-de-kostka.ca/assets/files/upload/annexes-reglement330.pdf
 */

import type { VisionRawExtraction } from "./grille-vision-extractor.js";

export const GRILLE_SSKK_SOURCE_URL =
  "https://st-stanislas-de-kostka.ca/assets/files/upload/annexes-reglement330.pdf";
export const GRILLE_SSKK_SNAPSHOT = "2026-06-21";

/** One captured page = its two independent vision passes. */
export interface GrilleVisionFixturePage {
  zone: string;
  page: number;
  passA: VisionRawExtraction;
  passB: VisionRawExtraction;
}

/** Helper to keep the fixture literals terse and typed. */
function raw(
  zone: string,
  fields: VisionRawExtraction["fields"],
): VisionRawExtraction {
  return { zone_code: zone, usages: [], fields };
}

/**
 * Pages A-2 … A-6 of the annex, exactly as the model read them on 2026-06-21.
 * (Eye-verified ground truth: avant 7.5 m¹, latérale 3 m, arrière 7.5 m,
 * frontage 45 m, superficie 2787 m², hauteur 1/2 étages; A-2 & A-5 have an EMPTY
 * "hauteur en mètres" cell, A-3/A-4/A-6 carry "6".)
 */
export const GRILLE_SSKK_VISION_PAGES: ReadonlyArray<GrilleVisionFixturePage> = [
  {
    zone: "A-2",
    page: 2,
    passA: raw("A-2", {
      hauteur_etages: "1/2",
      hauteur_metres: null,
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
    passB: raw("A-2", {
      hauteur_etages: "1/2",
      hauteur_metres: null,
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
  },
  {
    zone: "A-3",
    page: 3,
    // FR comma vs dot divergence — designed-for case.
    passA: raw("A-3", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7,5",
      marge_laterale_min: "3",
      marge_arriere_min: "7,5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0,3",
    }),
    passB: raw("A-3", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
  },
  {
    zone: "A-4",
    page: 4,
    passA: raw("A-4", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
    passB: raw("A-4", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7,5",
      marge_laterale_min: "3",
      marge_arriere_min: "7,5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0,3",
    }),
  },
  {
    zone: "A-5",
    page: 5,
    // OCR mark on the superscript ("7.5'") vs clean "7.5" — same number.
    passA: raw("A-5", {
      hauteur_etages: "1/2",
      hauteur_metres: null,
      marge_avant_min: "7.5'",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5'",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
    passB: raw("A-5", {
      hauteur_etages: "1/2",
      hauteur_metres: null,
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
  },
  {
    zone: "A-6",
    page: 6,
    passA: raw("A-6", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7.5",
      marge_laterale_min: "3",
      marge_arriere_min: "7.5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0.3",
    }),
    passB: raw("A-6", {
      hauteur_etages: "1/2",
      hauteur_metres: "6",
      marge_avant_min: "7,5",
      marge_laterale_min: "3",
      marge_arriere_min: "7,5",
      frontage_min: "45",
      superficie_min: "2787",
      densite: "0,3",
    }),
  },
];

/** Look up one fixture page by zone. */
export function ssKkPage(zone: string): GrilleVisionFixturePage {
  const p = GRILLE_SSKK_VISION_PAGES.find((x) => x.zone === zone);
  if (!p) throw new Error(`fixture: no page for zone ${zone}`);
  return p;
}

/**
 * A SYNTHETIC divergence pair (NOT from the real run) — two passes that read a
 * genuinely DIFFERENT number for the front margin. Used to prove the concordance
 * guard refuses (null + flag) rather than silently picking one.
 */
export const GRILLE_SSKK_DIVERGENT: GrilleVisionFixturePage = {
  zone: "A-DIV",
  page: 99,
  passA: raw("A-DIV", {
    hauteur_etages: "1/2",
    hauteur_metres: null,
    marge_avant_min: "7.5",
    marge_laterale_min: "3",
    marge_arriere_min: "7.5",
    frontage_min: "45",
    superficie_min: "2787",
    densite: "0.3",
  }),
  passB: raw("A-DIV", {
    hauteur_etages: "1/2",
    hauteur_metres: null,
    marge_avant_min: "9.5", // ← different NUMBER → must refuse
    marge_laterale_min: "3",
    marge_arriere_min: "7.5",
    frontage_min: "45",
    superficie_min: "2787",
    densite: "0.3",
  }),
};

/**
 * A SYNTHETIC décalage/implausibility pair: the front-margin column has been read
 * as an `m²` value (the §6c unit-type trap) and a height has been read as 120 m
 * (out of the 1–60 plausibility window). Both passes AGREE, so only the
 * unit/plausibility guards can catch them.
 */
export const GRILLE_SSKK_TRAP: GrilleVisionFixturePage = {
  zone: "A-TRAP",
  page: 98,
  passA: raw("A-TRAP", {
    hauteur_etages: "1/2",
    hauteur_metres: "120 m", // ← out of [1,60] → refuse (hors-plage)
    marge_avant_min: "415 m²", // ← area unit on a length field → refuse (unite-incoherente)
    marge_laterale_min: "3",
    marge_arriere_min: "7.5",
    frontage_min: "45",
    superficie_min: "2787",
    densite: "0.3",
  }),
  passB: raw("A-TRAP", {
    hauteur_etages: "1/2",
    hauteur_metres: "120 m",
    marge_avant_min: "415 m²",
    marge_laterale_min: "3",
    marge_arriere_min: "7.5",
    frontage_min: "45",
    superficie_min: "2787",
    densite: "0.3",
  }),
};
