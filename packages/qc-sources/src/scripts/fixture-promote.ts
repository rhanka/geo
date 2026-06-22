/**
 * `fixture promote` — Lot L5, SPEC_PERSISTENCE_S3_FIRST §3.
 *
 * Promote a real S3 raw object (an HTML PV index + the extracted PV text) into a
 * minimal GOLDEN fixture `.ts` file, carrying an honest provenance header.
 *
 * GUIDING RULE (spec §3):
 *   "The golden fixture is born from a parser FAILURE, not from onboarding."
 *
 * Concretely, the operator promotes a candidate when the live parser misbehaves
 * on a NEW structural family (a CMS layout no existing golden covers) or on a NEW
 * detection edge case. This script runs the REAL pure parser
 * (`parsePvIndex` + `detectZonageChange`) against the candidate and records the
 * OBSERVED outcome verbatim in the generated header — so the fixture documents the
 * exact behaviour (success or gap) it was created to pin down. No fabrication: the
 * emitted HTML/text are the verbatim bytes from S3.
 *
 * Git keeps only ONE golden per structural family (see GOLDEN_FIXTURES.md). The
 * extended corpus lives on S3 under `fixtures/{family}/…` (spec §1.4) for the
 * optional `make test-corpus` integration suite.
 *
 * Usage (via Make):
 *   make fixture-promote \
 *     CITY=<slug> CITY_LABEL="<Label>" \
 *     INDEX_URL=<url> INDEX_HTML=<path-or-s3-key> \
 *     PV_URL=<url>   PV_TEXT=<path-or-s3-key> \
 *     [OUT=<path>]
 *
 * Inputs may be local files (a developer working from a saved capture) or S3 keys
 * (`raw/{city}/{kind}/cas/{sha}.html` + the matching `parsed/.../text.txt`). When
 * an S3 client is wired in, `readSource()` is the single seam to extend; today it
 * reads local files and leaves S3 reads as an explicit, honest TODO.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  type ZonageChangeDetectionT,
  detectZonageChange,
  parsePvIndex,
} from "../sources/proces-verbaux-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// Structural family taxonomy (the golden-set axis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A structural family is a recurring municipal-site INDEX layout. The golden set
 * keeps exactly one fixture per family; a candidate whose family is already
 * covered does NOT warrant a new golden (its data lives on S3 instead).
 *
 * `markers` are substrings matched against the index HTML, most specific first.
 */
export interface StructuralFamily {
  id: string;
  label: string;
  markers: string[];
}

export const STRUCTURAL_FAMILIES: readonly StructuralFamily[] = [
  {
    id: "wordpress-elementor-accordion",
    label: "WordPress / Elementor accordion (elementor-accordion-*)",
    markers: ["elementor-accordion", "elementor-tab-title"],
  },
  {
    id: "wordpress-fusion-accordion",
    label: "WordPress / Avada-Fusion accordion (fusion-panel / panel-collapse)",
    markers: ["fusion-panel", "fusion-accordian", "panel-collapse collapse"],
  },
  {
    id: "wordpress-visual-composer",
    label: "WordPress / WPBakery Visual Composer (vc_tta-accordion + sc_button)",
    markers: ["vc_tta-accordion", "vc_tta-panel", "sc_button"],
  },
  {
    id: "wp-block-collapsible",
    label: "WordPress Gutenberg blocks + act-collapsible (wp-block-file)",
    markers: ["act-collapsible", "wp-block-file"],
  },
  {
    id: "october-cms-document-card",
    label: "October-CMS municipal theme — document cards (c-document-card / c-small-document-card)",
    markers: ["c-small-document-card", "c-document-card", "c-documents__item"],
  },
  {
    id: "bootstrap-panel",
    label: "Bootstrap panel accordion (panel panel-default / download.php)",
    markers: ["panel panel-default", "pull-right rotate-plus"],
  },
  {
    id: "drupal-files-table",
    label: "Drupal table layout (/sites/default/files/ relative links)",
    markers: ["/sites/default/files/", "bloc_de_texte"],
  },
  {
    id: "custom-accordion",
    label: "Custom hand-rolled accordion (accordeon__/accordion__ classes)",
    markers: ["accordeon__content", "accordion__sub-rows", "seances-conseil-list"],
  },
  {
    id: "custom-session-list",
    label: "Custom CMS session list (session-item / seances-list / pv-list)",
    markers: ["session-item", "seances-list", "pv-list", "avis_public_item"],
  },
  {
    id: "static-table",
    label: "Static HTML table of PDF links (<table> rows, no CMS classes)",
    markers: ["<table"],
  },
  {
    id: "youtube-paired",
    label: "PV index pairing PDF links with YouTube session videos (youtu.be)",
    markers: ["youtu.be", "youtube.com/watch"],
  },
] as const;

/** Catch-all family used when no structural marker matches the index HTML. */
export const FLAT_HTML_FAMILY: StructuralFamily = {
  id: "flat-html-list",
  label: "Flat HTML list of <a> PDF links (no recognisable CMS structure)",
  markers: [],
};

/** Pick the first family whose markers appear in the index HTML; fallback = flat list. */
export function detectStructuralFamily(indexHtml: string): StructuralFamily {
  for (const fam of STRUCTURAL_FAMILIES) {
    if (fam.markers.length === 0) continue;
    if (fam.markers.some((m) => indexHtml.includes(m))) return fam;
  }
  return FLAT_HTML_FAMILY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Naming
// ─────────────────────────────────────────────────────────────────────────────

/** "vaudreuil-dorion" → "PV_VAUDREUIL_DORION" (const prefix used by fixtures). */
export function slugToConstPrefix(citySlug: string): string {
  const upper = citySlug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `PV_${upper}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run the REAL parser against the candidate (the "parser failure" evidence)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParserOutcome {
  indexItemCount: number;
  /** True when the parser visibly failed (no index links extracted). */
  parserFailed: boolean;
  detection: ZonageChangeDetectionT;
}

export function summarizeParserOutcome(args: {
  indexHtml: string;
  baseUrl: string;
  pvText: string;
}): ParserOutcome {
  const items = parsePvIndex(args.indexHtml, args.baseUrl);
  const detection = detectZonageChange(args.pvText);
  return {
    indexItemCount: items.length,
    parserFailed: items.length === 0,
    detection,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate the golden fixture .ts source
// ─────────────────────────────────────────────────────────────────────────────

/** Escape a string so it is safe inside a backtick template literal. */
function escapeTemplate(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export interface BuildGoldenArgs {
  citySlug: string;
  cityLabel: string;
  family: StructuralFamily;
  indexUrl: string;
  indexHtml: string;
  pvUrl: string;
  pvText: string;
  rawMeta: {
    indexSha256: string;
    pvSha256: string;
    /** ISO datetime of the S3 fetch (RawDocumentRecord.fetchedAt). */
    fetchedAt: string;
  };
}

export function buildGoldenFixture(args: BuildGoldenArgs): string {
  const prefix = slugToConstPrefix(args.citySlug);
  const outcome = summarizeParserOutcome({
    indexHtml: args.indexHtml,
    baseUrl: args.indexUrl,
    pvText: args.pvText,
  });
  const fetchedDate = args.rawMeta.fetchedAt.slice(0, 10);
  const d = outcome.detection;

  const header = `/**
 * GOLDEN procès-verbaux fixture for ${args.cityLabel} — unit tests.
 *
 * STRUCTURAL FAMILY: ${args.family.id}
 *   ${args.family.label}
 *
 * This is a GOLDEN fixture (one per structural family). It was promoted from a
 * real S3 raw object via \`make fixture-promote\` because the live parser hit a
 * NEW family or detection edge case (SPEC_PERSISTENCE_S3_FIRST §3 — "the golden
 * fixture is born from a parser failure, not from onboarding").
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL bytes below are copied verbatim from PUBLIC documents. Nothing is
 * fabricated. Only excerpts are kept to bound the fixture size.
 *   - Index HTML: ${args.indexUrl}
 *     sha256: ${args.rawMeta.indexSha256}
 *   - PV document: ${args.pvUrl}
 *     sha256: ${args.rawMeta.pvSha256}
 *   Fetched: ${fetchedDate}
 *
 * OBSERVED PARSER OUTCOME at promotion time (run the real parser, record it):
 *   parsePvIndex      → ${outcome.indexItemCount} item(s)${outcome.parserFailed ? "  ⚠ PARSER FAILED (zero items)" : ""}
 *   detectZonageChange:
 *     avisDeMotion     = ${d.avisDeMotion}
 *     changementZonage = ${d.changementZonage}
 *     reglementNumbers = [${d.reglementNumbers.map((r) => `"${r}"`).join(", ")}]
 *     zoneRefs         = [${d.zoneRefs.map((r) => `"${r}"`).join(", ")}]
 *     densiteAutorisee = ${d.densiteAutorisee === null ? "null" : `"${d.densiteAutorisee}"`}
 *
 * Pin the assertions of the companion test to the OBSERVED outcome above. If the
 * outcome shows a gap (e.g. zero règlement numbers on a real zonage change), the
 * test should assert the CURRENT behaviour and a TODO should track the parser fix.
 */`;

  const body = `
/** Verbatim index HTML excerpt (${args.family.id} family). Source: ${args.indexUrl} */
export const ${prefix}_INDEX_HTML = \`${escapeTemplate(args.indexHtml.trim())}\`;

/** Verbatim PV text excerpt. Source: ${args.pvUrl} */
export const ${prefix}_TEXT = \`${escapeTemplate(args.pvText.trim())}\`;
`;

  return `${header}\n${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI wrapper (thin: argv + file IO)
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Read a source given a path-or-key. Local files are read directly. S3 keys
 * (`raw/…`, `parsed/…`) are an explicit, honest TODO until the ObjectStore port
 * is wired into this script.
 */
function readSource(pathOrKey: string): string {
  if (/^(raw|parsed|graph)\//.test(pathOrKey)) {
    throw new Error(
      `[fixture-promote] S3 key '${pathOrKey}' not yet supported by this script. ` +
        `Download the object first (make s3 cat KEY=… > local.html) and pass the local path. ` +
        `Wire the ObjectStore port into readSource() to read S3 directly.`,
    );
  }
  return readFileSync(pathOrKey, "utf8");
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`[fixture-promote] missing required env ${name}`);
  }
  return v;
}

function main(): void {
  const citySlug = reqEnv("CITY");
  const cityLabel = process.env.CITY_LABEL?.trim() || citySlug;
  const indexUrl = reqEnv("INDEX_URL");
  const pvUrl = reqEnv("PV_URL");

  const indexHtml = readSource(reqEnv("INDEX_HTML"));
  const pvText = readSource(reqEnv("PV_TEXT"));

  const family = detectStructuralFamily(indexHtml);
  const fixture = buildGoldenFixture({
    citySlug,
    cityLabel,
    family,
    indexUrl,
    indexHtml,
    pvUrl,
    pvText,
    rawMeta: {
      indexSha256: process.env.INDEX_SHA256?.trim() || sha256Hex(indexHtml),
      pvSha256: process.env.PV_SHA256?.trim() || sha256Hex(pvText),
      fetchedAt: process.env.FETCHED_AT?.trim() || new Date().toISOString(),
    },
  });

  const outPath =
    process.env.OUT?.trim() ||
    `packages/radar-sources/src/sources/proces-verbaux-${citySlug}.fixture.ts`;

  const outcome = summarizeParserOutcome({ indexHtml, baseUrl: indexUrl, pvText });
  console.error(
    `[fixture-promote] family=${family.id} indexItems=${outcome.indexItemCount} ` +
      `avisDeMotion=${outcome.detection.avisDeMotion} ` +
      `changementZonage=${outcome.detection.changementZonage}` +
      (outcome.parserFailed ? "  ⚠ PARSER FAILED" : ""),
  );

  if (process.env.STDOUT === "1") {
    process.stdout.write(fixture);
  } else {
    writeFileSync(outPath, fixture, "utf8");
    console.error(`[fixture-promote] wrote ${outPath}`);
  }
}

// Run only when executed directly (not when imported by the test).
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /fixture-promote\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main();
}
