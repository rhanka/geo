/**
 * diagnose-code-mismatch.ts — committed, $0 diagnostic for the "champs hauts mais
 * overlap SIG = 0" family (deux-montagnes / saint-cuthbert / shefford …).
 *
 * WHY. Several munis have a grille whose norm FIELDS extract correctly (high
 * publishedFieldPct) yet whose zone CODES recoup the SIG grille at overlap=0, so
 * the anti-invention gate (`shouldRejectForZeroOverlap`) rejects the deposit. That
 * is NOT invention — the norms are real — it is a CODE-FORMAT canonicalisation gap:
 * the extracted code and the SIG code denote the SAME physical zone but are written
 * differently (space vs dash, a secteur suffix, a leading prefix, casing…). This
 * tool lays the two code SETS side by side so the exact format delta is visible,
 * WITHOUT re-running any paid OCR: it reads the codes from the staged grille PDF's
 * text layer via the frozen deterministic native parsers, and the SIG codes from
 * the muni's `qc-zonage-<slug>.geojson` on S3.
 *
 * It NEVER deposits and NEVER mutates anything — read-only.
 *
 * Usage (the grille PDF is already staged at work/zonage-norms/<slug>/grille.pdf):
 *   npx tsx acquisition/src/diagnose-code-mismatch.ts --slug deux-montagnes
 *   npx tsx acquisition/src/diagnose-code-mismatch.ts --slug deux-montagnes,saint-cuthbert
 *   # print every raw code on both sides (default caps the listings):
 *   npx tsx acquisition/src/diagnose-code-mismatch.ts --slug shefford --full
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import {
  extractGrilleDocument,
} from "../../packages/qc-sources/src/sources/reglements-zonage-sherbrooke.js";
import {
  parseTransposedGrilleNativePage,
  parseTransposedColumnsGrille,
  looksLikeTransposedColumnsGrille,
  parseNumberedGrilleNativePage,
  parseZoneHeader,
  isNumberedGrilleSpec,
  columnsHeaderZones,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import { parseLabelValueGrillePage } from "../../packages/qc-sources/src/sources/grille-zoneheader-parser.js";

import { s3Client, getBytes } from "./lib/s3.js";
import {
  canonZone,
  resolveGridKey,
  SIG_ZONE_CODE_FIELDS,
} from "./lib/zonage-norms.js";
import { canonicalizeZoneCodeForJoin } from "../../packages/geo/src/zonage/lotZoneJoin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SNAPSHOT = new Date().toISOString().slice(0, 10);

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv: string[], k: string): boolean {
  return argv.includes(`--${k}`);
}

/** `pdftotext -layout` → per-page texts (page break = \f). */
function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed on ${pdfPath}: ${r.stderr?.slice(0, 160)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function publishedCount(z: ZoneNormsT): number {
  return [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ].filter((f) => f && f.value !== null).length;
}

interface NativeExtraction {
  family: string;
  zones: ZoneNormsT[];
}

/**
 * Run EVERY deterministic native ($0) parser over the staged PDF and keep the one
 * family that yields the most distinct zones carrying a published norm field. This
 * mirrors the runner's native-first behaviour closely enough to recover the codes
 * the run extracted for the transposed-columns / numbered / zoneheader families —
 * the ones that hit "champs hauts, overlap=0".
 */
function extractNative(pdfPath: string): NativeExtraction {
  const pages = pageTexts(pdfPath);
  const meta = { source_url: "diagnostic://local", snapshot: SNAPSHOT };

  const families: NativeExtraction[] = [];

  // A) transposed COLUMNS (Sept-Îles / Saint-Tite / Valcourt / Côte-Nord family).
  {
    const byZone = new Map<string, ZoneNormsT>();
    for (let i = 0; i < pages.length; i++) {
      const t = pages[i] ?? "";
      if (!looksLikeTransposedColumnsGrille(t)) continue;
      for (const zn of parseTransposedColumnsGrille(t, i + 1, { ...meta, methode: "diag/cols" })) {
        const key = canonZone(zn.zone_code);
        const prev = byZone.get(key);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
      }
    }
    families.push({ family: "transposed-columns", zones: [...byZone.values()] });
  }

  // B) transposed number+usage split header (MRC de La Matapédia / Mitis family).
  {
    const byZone = new Map<string, ZoneNormsT>();
    for (let i = 0; i < pages.length; i++) {
      for (const zn of parseTransposedGrilleNativePage(pages[i] ?? "", i + 1, { ...meta, methode: "diag/mat" })) {
        const key = canonZone(zn.zone_code);
        const prev = byZone.get(key);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
      }
    }
    families.push({ family: "transposed-matapedia", zones: [...byZone.values()] });
  }

  // C) numbered "grille des spécifications" (Nicolet family, one zone per page).
  {
    const byZone = new Map<string, ZoneNormsT>();
    for (let i = 0; i < pages.length; i++) {
      const t = pages[i] ?? "";
      if (!(parseZoneHeader(t) && isNumberedGrilleSpec(t))) continue;
      for (const zn of parseNumberedGrilleNativePage(t, i + 1, { ...meta, methode: "diag/num" })) {
        const key = canonZone(zn.zone_code);
        const prev = byZone.get(key);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
      }
    }
    families.push({ family: "numbered-grille-spec", zones: [...byZone.values()] });
  }

  // D) one-zone-per-page "label : value" grille (durham-sud / lachute family).
  {
    const byZone = new Map<string, ZoneNormsT>();
    for (let i = 0; i < pages.length; i++) {
      for (const zn of parseLabelValueGrillePage(pages[i] ?? "", i + 1, { ...meta, methode: "diag/zh" })) {
        const key = canonZone(zn.zone_code);
        const prev = byZone.get(key);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
      }
    }
    families.push({ family: "zoneheader-label-value", zones: [...byZone.values()] });
  }

  // E) native HORIZONTAL header-anchored cluster (Sherbrooke family).
  {
    const res = extractGrilleDocument(pages.join("\f"), meta);
    families.push({ family: "native-horizontal", zones: res.zones });
  }

  // Pick the family with the most zones that publish ≥1 norm field.
  const score = (e: NativeExtraction): number =>
    e.zones.filter((z) => publishedCount(z) > 0).length;
  families.sort((a, b) => score(b) - score(a) || b.zones.length - a.zones.length);
  return families[0] ?? { family: "none", zones: [] };
}

/** Distinct RAW SIG codes from the geojson, over the same whitelist the gate uses. */
function sigRawCodes(geojson: string): string[] {
  const out = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  const features = (parsed as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  // Union every whitelisted field that looks like a real code column (majority of
  // its distinct values are short code-shaped strings) — same spirit as the gate.
  const byField = new Map<string, Set<string>>();
  for (const f of features) {
    const props = (f as { properties?: Record<string, unknown> | null })?.properties ?? {};
    for (const name of SIG_ZONE_CODE_FIELDS) {
      const v = props[name];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      let vals = byField.get(name);
      if (!vals) {
        vals = new Set<string>();
        byField.set(name, vals);
      }
      vals.add(s);
    }
  }
  const codeShaped = (s: string): boolean =>
    s.length > 0 && s.length <= 24 && s.split(/\s+/).length <= 3;
  for (const values of byField.values()) {
    let plausible = 0;
    for (const v of values) if (codeShaped(v)) plausible++;
    if (plausible * 2 < values.size) continue;
    for (const v of values) out.add(v);
  }
  return [...out].sort();
}

function uniqSorted(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

/** For a code not matched, find the closest SIG code by canon-without-separators. */
function looseKey(code: string): string {
  return canonZone(code).replace(/-/g, "");
}

/**
 * CANDIDATE canon under test: strip a trailing "(...)" presentational annotation
 * (e.g. "H34-327 (VLO)") BEFORE the frozen canonZone. `plausibleCode` already
 * drops this annotation for column detection; the comparison canon does NOT — so a
 * SIG code that carries the annotation never matches a clean extracted code. This
 * probes whether annotation-stripping alone recovers overlap (a pure format delta),
 * WITHOUT touching the numeric core (never fuses distinct codes).
 */
function canonStripAnnotation(code: string): string {
  const core = code.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return canonZone(core);
}

/** Dump the raw pdftotext header lines that carry ≥3 zone-code columns (to check
 *  the extractor is reading the RIGHT band vs a stray usage-class enumeration). */
function dumpHeaders(pdfPath: string): void {
  const pages = pageTexts(pdfPath);
  for (let i = 0; i < pages.length; i++) {
    const lines = (pages[i] ?? "").split(/\r?\n/);
    for (let j = 0; j < lines.length; j++) {
      const zs = columnsHeaderZones(lines[j]!);
      if (zs.length >= 3) {
        // eslint-disable-next-line no-console
        console.error(`p${i + 1} L${j}: [${zs.map((z) => z.code).join(" | ")}]  << ${lines[j]!.trim().slice(0, 160)}`);
      }
    }
  }
}

async function diagnoseSlug(
  slug: string,
  full: boolean,
  headers: boolean,
  sigProps: boolean,
): Promise<void> {
  const pdf = join(REPO, "work", "zonage-norms", slug, "grille.pdf");
  const out: Record<string, unknown> = { slug, pdf };

  if (!existsSync(pdf)) {
    out["error"] = `missing staged grille PDF: ${pdf}`;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (headers) dumpHeaders(pdf);
  if (sigProps) {
    const s3p = s3Client();
    const gk = await resolveGridKey(s3p, slug);
    if (gk) {
      const gj = JSON.parse((await getBytes(s3p, gk)).toString("utf8")) as {
        features?: { properties?: Record<string, unknown> }[];
      };
      const keys = new Map<string, Set<string>>();
      for (const f of gj.features ?? []) {
        for (const [k, v] of Object.entries(f.properties ?? {})) {
          if (v === null || v === undefined) continue;
          const set = keys.get(k) ?? new Set<string>();
          if (set.size < 12) set.add(String(v).slice(0, 40));
          keys.set(k, set);
        }
      }
      for (const [k, set] of keys) {
        // eslint-disable-next-line no-console
        console.error(`SIGPROP ${k}: ${[...set].join(" | ")}`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.error(`SIGPROP: no grid resolved for ${slug}`);
    }
  }

  const ext = extractNative(pdf);
  const extractedRaw = uniqSorted(ext.zones.map((z) => z.zone_code));
  const extractedCanon = uniqSorted(extractedRaw.map(canonZone));

  const s3 = s3Client();
  const gridKey = await resolveGridKey(s3, slug);
  let sigRaw: string[] = [];
  if (gridKey) {
    const geojson = (await getBytes(s3, gridKey)).toString("utf8");
    sigRaw = sigRawCodes(geojson);
  }
  const sigCanon = uniqSorted(sigRaw.map(canonZone));
  const sigCanonSet = new Set(sigCanon);

  // Join-side canon (the lockstep partner). Both MUST agree code-for-code so the
  // gate's overlap equals the realized lot⋈norms join. Any divergence is a bug.
  const joinDivergences = uniqSorted([...extractedRaw, ...sigRaw])
    .map((c) => ({ raw: c, gate: canonZone(c), join: canonicalizeZoneCodeForJoin(c) }))
    .filter((r) => r.gate !== r.join)
    .slice(0, 40);

  // Overlap under the CURRENT canon.
  const overlapNow = extractedCanon.filter((c) => sigCanonSet.has(c));
  const notInSig = extractedCanon.filter((c) => !sigCanonSet.has(c));

  // Loose overlap (canon ignoring separators) — reveals a pure format delta.
  const sigLoose = new Map<string, string>(); // looseKey -> sample sig raw
  for (const c of sigRaw) if (!sigLoose.has(looseKey(c))) sigLoose.set(looseKey(c), c);
  const looseMatches: { extracted: string; sig: string }[] = [];
  for (const c of extractedRaw) {
    if (sigCanonSet.has(canonZone(c))) continue; // already matched
    const hit = sigLoose.get(looseKey(c));
    if (hit) looseMatches.push({ extracted: c, sig: hit });
  }

  // CANDIDATE canon (annotation-stripped) overlap — the key hypothesis probe.
  const extAnnCanon = new Set(extractedRaw.map(canonStripAnnotation));
  const sigAnnCanon = new Set(sigRaw.map(canonStripAnnotation));
  const overlapAnnStrip = [...extAnnCanon].filter((c) => sigAnnCanon.has(c));

  // FUSION SAFETY: does stripping the annotation collapse ≥2 DISTINCT sig codes
  // (that already differ under the CURRENT canon) onto one key? Those would be a
  // forbidden fusion. A core reached only by annotation-only variants is safe.
  const sigByStrip = new Map<string, Set<string>>();
  for (const c of sigRaw) {
    const k = canonStripAnnotation(c);
    const s = sigByStrip.get(k) ?? new Set<string>();
    s.add(canonZone(c)); // distinct under the CURRENT canon
    sigByStrip.set(k, s);
  }
  const fusionRisks: { core: string; distinctCurrentCanon: string[] }[] = [];
  for (const [k, s] of sigByStrip) {
    if (s.size > 1) fusionRisks.push({ core: k, distinctCurrentCanon: [...s] });
  }
  const annStripExamples: { extracted: string; sig: string }[] = [];
  {
    const sigByAnn = new Map<string, string>();
    for (const c of sigRaw) if (!sigByAnn.has(canonStripAnnotation(c))) sigByAnn.set(canonStripAnnotation(c), c);
    for (const c of extractedRaw) {
      if (sigCanonSet.has(canonZone(c))) continue; // already matched under current canon
      const hit = sigByAnn.get(canonStripAnnotation(c));
      if (hit && hit !== c) annStripExamples.push({ extracted: c, sig: hit });
    }
  }

  const cap = (xs: string[]): string[] => (full ? xs : xs.slice(0, 40));

  out["family"] = ext.family;
  out["gridKey"] = gridKey ?? null;
  out["counts"] = {
    extractedRaw: extractedRaw.length,
    extractedCanon: extractedCanon.length,
    sigRaw: sigRaw.length,
    sigCanon: sigCanon.length,
    overlapNow: overlapNow.length,
    looseMatchesGainedIfBridged: looseMatches.length,
    overlapIfAnnotationStripped: overlapAnnStrip.length,
    annStripGained: annStripExamples.length,
    sigDistinctCurrentCanon: sigCanon.length,
    sigDistinctAfterAnnStrip: sigAnnCanon.size,
    annStripFusionRiskCount: fusionRisks.length,
  };
  out["extractedRawSample"] = cap(extractedRaw);
  out["extractedCanonSample"] = cap(extractedCanon);
  out["sigRawSample"] = cap(sigRaw);
  out["sigCanonSample"] = cap(sigCanon);
  out["extractedNotInSigCanon"] = cap(notInSig);
  out["looseFormatBridgeExamples"] = looseMatches.slice(0, full ? looseMatches.length : 40);
  out["annotationStripBridgeExamples"] = annStripExamples.slice(0, full ? annStripExamples.length : 40);
  out["annStripFusionRisks"] = fusionRisks.slice(0, full ? fusionRisks.length : 40);
  out["gateVsJoinCanonDivergences"] = joinDivergences;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slugArg = arg(argv, "slug");
  if (!slugArg) throw new Error("--slug <slug[,slug...]> is required");
  const full = has(argv, "full");
  const headers = has(argv, "headers");
  const sigProps = has(argv, "sig-props");
  const slugs = slugArg.split(",").map((s) => s.trim()).filter(Boolean);
  for (const slug of slugs) {
    await diagnoseSlug(slug, full, headers, sigProps);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
