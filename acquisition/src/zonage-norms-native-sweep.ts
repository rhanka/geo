/**
 * zonage-norms-native-sweep — $0 VOLUME sweep of the FROZEN native-text grille
 * parsers over EVERY grille PDF already staged locally under
 * `work/zonage-norms/<slug>/grille.pdf`, to catch the stragglers the regional
 * shards downloaded but never deposited.
 *
 * It reuses, verbatim and with ZERO new parsing/normalisation:
 *   - the SAME frozen native parser families as `grille-native-probe.ts`
 *     (numbered / Numéro-Dominance / norme-générale / transposé-colonnes /
 *      transposé / label:value zoneheader) — NO LLM, NO OCR, NO network fetch;
 *   - the SAME strict gates + deposit as `zonage-norms-run.ts` via
 *     `lib/zonage-norms` (crossValidateZoneCodes, shouldRejectForZeroOverlap,
 *      shouldRejectForZeroNormFields, publishedFieldPct, depositParquetOnly).
 *
 * Guaranteed $0 BY CONSTRUCTION: it never imports a vision/OCR extractor, so no
 * paid call is reachable. Deposits are PARQUET-ONLY (no shared-manifest write) so
 * a concurrent stock/mass lane is never raced; reconcile afterwards with
 * `zonage-norms-manifest-merge.ts --apply`.
 *
 * GATE (all must hold to deposit): ≥3 distinct real zone codes, publishedFieldPct
 * ≠ 0, and — when a SIG grille exists on S3 — overlap ≠ 0. verbatim-or-null is
 * inherited whole from the frozen parsers.
 *
 * Skips: any slug already `normes:done` in coverage-matrix.json, and any slug
 * whose parquet already exists in S3 (idempotence + never clobber a finished
 * lane). A fresh HEAD is re-checked immediately before each write.
 *
 * Usage:
 *   npx tsx acquisition/src/zonage-norms-native-sweep.ts            # DRY (report only)
 *   npx tsx acquisition/src/zonage-norms-native-sweep.ts --apply    # deposit
 *   [--report <path>] [--limit N] [--only slugA,slugB]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseZoneHeader,
  isNumberedGrilleSpec,
  parseNumberedGrilleNativePage,
  parseNumeroDominanceHeader,
  parseNumeroDominanceGrillePage,
  parseTransposedColumnsGrille,
  parseTransposedGrilleNativePage,
  looksLikeNormeGeneraleGrille,
  parseNormeGeneraleGrillePage,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import { parseLabelValueGrillePage } from "../../packages/qc-sources/src/sources/grille-zoneheader-parser.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client, listSlugs } from "./lib/s3.js";
import {
  crossValidateZoneCodes,
  depositParquetOnly,
  publishedFieldPct,
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
  normsKey,
  ZONAGE_NORMS_PREFIX,
} from "./lib/zonage-norms.js";
import { exists } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, "..");
const REPO = resolve(ACQ, "..");
const ZN_DIR = join(REPO, "work", "zonage-norms");
const MATRIX = join(REPO, "work", "coverage", "coverage-matrix.json");

/** Anti-invention floor: never deposit a product with fewer real zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** How many of a zone's 8 norm fields carry a published (non-null) value. */
function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges?.avant_min,
    z.marges?.laterale_min,
    z.marges?.arriere_min,
  ];
  return fs.filter((f) => f && (f as { value: number | null }).value !== null).length;
}

/** Run EVERY frozen native family on one page; keep zones with ≥1 published norm. */
function nativeZonesForPage(
  t: string,
  p: number,
  opts: { source_url: string; snapshot: string },
): ZoneNormsT[] {
  const out: ZoneNormsT[] = [];
  try {
    if (parseZoneHeader(t) && isNumberedGrilleSpec(t)) {
      out.push(...parseNumberedGrilleNativePage(t, p, { ...opts, methode: "native-text/grille-spec" }));
    }
  } catch { /* skip */ }
  try {
    if (parseNumeroDominanceHeader(t)) {
      out.push(...parseNumeroDominanceGrillePage(t, p, { ...opts, methode: "native-text/grille-numero-dominance" }));
    }
  } catch { /* skip */ }
  try {
    if (looksLikeNormeGeneraleGrille(t)) {
      out.push(...parseNormeGeneraleGrillePage(t, p, { ...opts, methode: "native-text/grille-norme-generale" }));
    }
  } catch { /* skip */ }
  try {
    out.push(...parseTransposedColumnsGrille(t, p, { ...opts, methode: "native-text/grille-transposee-colonnes" }));
  } catch { /* skip */ }
  try {
    out.push(...parseTransposedGrilleNativePage(t, p, { ...opts, methode: "native-text/grille-transposee" }));
  } catch { /* skip */ }
  try {
    out.push(...parseLabelValueGrillePage(t, p, { ...opts, methode: "native-text/zoneheader" }));
  } catch { /* skip */ }
  return out.filter((z) => publishedCount(z) > 0);
}

/** Merge duplicate zone reads, keeping the row with more published norms. */
function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const key = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(key);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
  }
  return [...byZone.values()];
}

/** Best-effort slug→source_url map merged from every local seed manifest. */
function loadSourceUrlMap(): Map<string, string> {
  const map = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(ZN_DIR).filter((f) => /\.json$/.test(f) && (/^seed/.test(f) || f === "discovered.json" || f === "munis.json"));
  } catch { /* none */ }
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(ZN_DIR, f), "utf8")) as unknown;
      const arr: unknown[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as { munis?: unknown[] }).munis)
          ? ((raw as { munis: unknown[] }).munis)
          : [];
      for (const e of arr) {
        if (!e || typeof e !== "object") continue;
        const o = e as Record<string, unknown>;
        const slug = typeof o["slug"] === "string" ? (o["slug"] as string) : undefined;
        const url =
          (typeof o["url"] === "string" && (o["url"] as string)) ||
          (typeof o["sourceUrl"] === "string" && (o["sourceUrl"] as string)) ||
          (typeof o["source_url"] === "string" && (o["source_url"] as string)) ||
          undefined;
        if (slug && url && !map.has(slug)) map.set(slug, url);
      }
    } catch { /* skip malformed */ }
  }
  return map;
}

interface Outcome {
  slug: string;
  status: "deposited" | "skip-count" | "skip-overlap0" | "skip-fields0" | "skip-nozones" | "skip-deposited" | "error";
  uniqueCodes: number;
  fieldPct: number;
  gridFound: boolean;
  overlap: number;
  sampleCodes: string[];
  reason?: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const limit = get("limit") ? Number(get("limit")) : Infinity;
  const only = get("only") ? new Set(get("only")!.split(",").map((s) => s.trim())) : null;
  const reportPath = get("report") ?? join(REPO, "work", "zonage-norms", "native-sweep-report.json");
  const snapshot = new Date().toISOString().slice(0, 10);

  // 1) matrix: which slugs are already normes:done (skip — served)
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, Record<string, { status?: string }>>;
  };
  const normesDone = (slug: string): boolean => matrix.cities[slug]?.["normes"]?.status === "done";

  // 2) staged candidates: work/zonage-norms/<slug>/grille.pdf
  const dirs = readdirSync(ZN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const candidates: { slug: string; pdf: string }[] = [];
  for (const d of dirs) {
    const pdf = join(ZN_DIR, d.name, "grille.pdf");
    if (!existsSync(pdf)) continue;
    if (only && !only.has(d.name)) continue;
    if (normesDone(d.name)) continue;
    candidates.push({ slug: d.name, pdf });
  }
  candidates.sort((a, b) => a.slug.localeCompare(b.slug));

  // 3) which slugs already have a parquet in S3 (idempotence + never clobber a lane)
  const s3 = s3Client();
  const depositedRests = await listSlugs(s3, ZONAGE_NORMS_PREFIX, ".parquet");
  const depositedSlugs = new Set<string>();
  for (const rest of depositedRests) {
    if (!rest.startsWith("qc-zonage-norms-")) continue;
    const slug = rest.slice("qc-zonage-norms-".length);
    if (!slug.includes("/")) depositedSlugs.add(slug);
  }

  const urlMap = loadSourceUrlMap();

  console.error(
    `[sweep] staged-with-grille.pdf & normes≠done = ${candidates.length} | already-deposited(S3) = ${depositedSlugs.size} | mode = ${apply ? "APPLY" : "DRY"}`,
  );

  const outcomes: Outcome[] = [];
  let processed = 0;
  for (const { slug, pdf } of candidates) {
    if (processed >= limit) break;
    if (depositedSlugs.has(slug)) {
      outcomes.push({ slug, status: "skip-deposited", uniqueCodes: 0, fieldPct: 0, gridFound: false, overlap: 0, sampleCodes: [], reason: "parquet exists" });
      continue;
    }
    processed++;
    try {
      const texts = pageTexts(pdf);
      const raw: ZoneNormsT[] = [];
      const opts = { source_url: urlMap.get(slug) ?? "non-disponible", snapshot };
      texts.forEach((t, i) => raw.push(...nativeZonesForPage(t, i + 1, opts)));
      const zones = mergeByZone(raw);
      const uniqueCodes = new Set(zones.map((z) => z.zone_code)).size;
      const sample = [...new Set(zones.map((z) => z.zone_code))].slice(0, 12);

      if (zones.length === 0) {
        outcomes.push({ slug, status: "skip-nozones", uniqueCodes: 0, fieldPct: 0, gridFound: false, overlap: 0, sampleCodes: [] });
        console.error(`  · ${slug.padEnd(38)} no native zones`);
        continue;
      }
      if (uniqueCodes < MIN_DEPOSIT_ZONE_CODES) {
        outcomes.push({ slug, status: "skip-count", uniqueCodes, fieldPct: publishedFieldPct(zones), gridFound: false, overlap: 0, sampleCodes: sample });
        console.error(`  · ${slug.padEnd(38)} only ${uniqueCodes} code(s) < ${MIN_DEPOSIT_ZONE_CODES}`);
        continue;
      }

      const crossval = await crossValidateZoneCodes(s3, slug, zones);
      const fieldPct = publishedFieldPct(zones);

      if (shouldRejectForZeroOverlap(crossval)) {
        outcomes.push({ slug, status: "skip-overlap0", uniqueCodes, fieldPct, gridFound: crossval.gridFound, overlap: crossval.overlap, sampleCodes: sample, reason: `SIG=${crossval.sigZoneCodes} overlap=0` });
        console.error(`  ✗ ${slug.padEnd(38)} REJET overlap=0 (SIG ${crossval.sigZoneCodes} codes) codes=${uniqueCodes}`);
        continue;
      }
      if (shouldRejectForZeroNormFields(fieldPct)) {
        outcomes.push({ slug, status: "skip-fields0", uniqueCodes, fieldPct, gridFound: crossval.gridFound, overlap: crossval.overlap, sampleCodes: sample, reason: "publishedFieldPct=0" });
        console.error(`  ✗ ${slug.padEnd(38)} REJET fieldPct=0 codes=${uniqueCodes}`);
        continue;
      }

      if (apply) {
        // fresh HEAD immediately before write — a concurrent lane may have deposited
        if (await exists(s3, normsKey(slug))) {
          outcomes.push({ slug, status: "skip-deposited", uniqueCodes, fieldPct, gridFound: crossval.gridFound, overlap: crossval.overlap, sampleCodes: sample, reason: "parquet appeared mid-run" });
          console.error(`  = ${slug.padEnd(38)} appeared mid-run — skip`);
          continue;
        }
        await depositParquetOnly({
          s3,
          slug,
          zones,
          meta: { source_url: opts.source_url, methode: "native-text/grille-native-sweep", snapshot },
          crossval,
        });
      }
      outcomes.push({ slug, status: "deposited", uniqueCodes, fieldPct, gridFound: crossval.gridFound, overlap: crossval.overlap, sampleCodes: sample });
      console.error(
        `  ${apply ? "✓" : "▷"} ${slug.padEnd(38)} codes=${uniqueCodes} field%=${fieldPct} ` +
          `grid=${crossval.gridFound} overlap=${crossval.overlap} recoupSig=${(crossval.recoupSig * 100).toFixed(0)}% :: [${sample.slice(0, 8).join(", ")}]`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcomes.push({ slug, status: "error", uniqueCodes: 0, fieldPct: 0, gridFound: false, overlap: 0, sampleCodes: [], reason: msg.slice(0, 160) });
      console.error(`  ! ${slug.padEnd(38)} ERROR ${msg.slice(0, 120)}`);
    }
  }

  const deposited = outcomes.filter((o) => o.status === "deposited");
  const zonesTotal = deposited.reduce((n, o) => n + o.uniqueCodes, 0);
  const summary = {
    apply,
    snapshot,
    candidates: candidates.length,
    processed,
    deposited: deposited.length,
    depositedZones: zonesTotal,
    skipCount: outcomes.filter((o) => o.status === "skip-count").length,
    skipNoZones: outcomes.filter((o) => o.status === "skip-nozones").length,
    skipOverlap0: outcomes.filter((o) => o.status === "skip-overlap0").length,
    skipFields0: outcomes.filter((o) => o.status === "skip-fields0").length,
    skipDeposited: outcomes.filter((o) => o.status === "skip-deposited").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    depositedSlugs: deposited.map((o) => ({ slug: o.slug, codes: o.uniqueCodes, fieldPct: o.fieldPct, overlap: o.overlap, gridFound: o.gridFound })),
    outcomes,
  };
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.error(
    `\n[sweep] ${apply ? "DEPOSITED" : "WOULD DEPOSIT"} ${deposited.length} muni(s), ${zonesTotal} zones | ` +
      `skip: count=${summary.skipCount} noZones=${summary.skipNoZones} overlap0=${summary.skipOverlap0} fields0=${summary.skipFields0} alreadyDeposited=${summary.skipDeposited} err=${summary.errors}`,
  );
  console.log(JSON.stringify({ ...summary, outcomes: undefined }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
