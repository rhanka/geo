/**
 * recompose-zones-pdf-svg.ts — fallback SVG pour GeoPDF ArcGIS Pro/QGIS
 * dont le driver OGR PDF ne lit pas les couches vectorielles.
 *
 * Voie validée sur Amos:
 *   1. gdalinfo/gdalsrsinfo lit le GeoTransform + CRS du PDF.
 *   2. mutool convert -F svg expose la linework de carte en chemins SVG.
 *   3. pdftotext -bbox-layout donne les labels et positions page PDF.
 *   4. On garde les chemins fermés noirs épais non-identité (limites fortes de zones).
 *   5. Point-in-polygon en coordonnées page: un seul vrai code par polygone.
 *   6. Conversion page → WGS84 via GeoTransform, puis publication optionnelle S3.
 *
 * Anti-invention: aucun polygone n'est émis sans label source unique.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import proj4 from "proj4";

import { BUCKET, putBytes, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNI_REGISTRY = resolve(
  REPO,
  "packages/qc-sources/src/geo/municipalities.qc.json",
);
const S3_PREFIX = "normalized/ca-qc-zonage/";

interface MuniEntry {
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

interface GdalInfo {
  geoTransform: number[] | null;
  pixelSize: [number, number] | null;
  projDef: string | null;
  creator: string | null;
}

interface ResolvedGdalInfo {
  geoTransform: number[];
  pixelSize: [number, number];
  projDef: string;
}

interface PdfLabel {
  text: string;
  x: number;
  y: number;
}

interface SvgPathCandidate {
  pageRing: Array<[number, number]>;
  area: number;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bboxCentroid(pts: Array<[number, number]>): [number, number] | null {
  if (pts.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function runGdalinfo(pdfPath: string): GdalInfo {
  const out = execSync(`gdalinfo "${pdfPath}" 2>&1`, {
    encoding: "utf8",
    timeout: 30_000,
  });
  const gtMatch = out.match(
    /GeoTransform\s*=\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)\s*\n\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)/m,
  );
  const sizeMatch = out.match(/Size is (\d+),\s*(\d+)/);
  const creatorMatch = out.match(/CREATOR\s*=\s*(.+)/);

  let projDef: string | null = null;
  try {
    const srs = execSync(`gdalsrsinfo "${pdfPath}" 2>/dev/null`, {
      encoding: "utf8",
      timeout: 15_000,
    });
    projDef = srs.match(/PROJ\.4\s*:\s*(.+)/)?.[1]?.trim() ?? null;
  } catch {
    projDef = null;
  }

  return {
    geoTransform: gtMatch
      ? [
          parseFloat(gtMatch[1]!),
          parseFloat(gtMatch[2]!),
          parseFloat(gtMatch[3]!),
          parseFloat(gtMatch[4]!),
          parseFloat(gtMatch[5]!),
          parseFloat(gtMatch[6]!),
        ]
      : null,
    pixelSize: sizeMatch
      ? [parseInt(sizeMatch[1]!, 10), parseInt(sizeMatch[2]!, 10)]
      : null,
    projDef,
    creator: creatorMatch?.[1]?.trim() ?? null,
  };
}

function readPdfLabels(pdfPath: string): PdfLabel[] {
  let xml = "";
  try {
    xml = execSync(`pdftotext -bbox-layout "${pdfPath}" - 2>/dev/null`, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch {
    return [];
  }

  const labels: PdfLabel[] = [];
  const wordRe =
    /xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([^<]+)<\/word>/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(xml)) !== null) {
    const text = (m[5] ?? "").trim();
    if (!isZoneCodeLabel(text)) continue;
    labels.push({
      text,
      x: (parseFloat(m[1]!) + parseFloat(m[3]!)) / 2,
      y: (parseFloat(m[2]!) + parseFloat(m[4]!)) / 2,
    });
  }
  return labels;
}

function isZoneCodeLabel(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 24) return false;
  if (/^\d+$/.test(t)) return false;
  if (/^[A-Z]{1,3}$/i.test(t)) return false;
  if (/^[A-Z]\d[A-Z]$/i.test(t)) return false; // code postal tronqué, ex J9T.
  return /^(?:[A-Z]{1,4}[-.]?\d{1,4}[A-Za-z]?|\d{1,4}-[A-Za-z]{1,5})$/i.test(t);
}

function ensureSvg(pdfPath: string, tmpDir: string): string {
  mkdirSync(tmpDir, { recursive: true });
  const pattern = join(tmpDir, "page.svg");
  execFileSync("mutool", ["convert", "-F", "svg", "-o", pattern, pdfPath], {
    timeout: 60_000,
    stdio: "pipe",
  });
  const produced = join(tmpDir, "page1.svg");
  return existsSync(produced) ? produced : pattern;
}

function attr(raw: string, name: string): string | null {
  return raw.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

function numbers(raw: string): number[] {
  return [...raw.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)].map(
    (m) => Number(m[0]),
  );
}

function tokenizePath(d: string): string[] {
  return d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
}

function transformPoint(
  p: [number, number],
  tf: [number, number, number, number, number, number],
): [number, number] {
  const [a, b, c, d, e, f] = tf;
  return [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f];
}

function parseTransform(raw: string | null): [number, number, number, number, number, number] {
  if (!raw) return [1, 0, 0, 1, 0, 0];
  const m = raw.match(/matrix\(([^)]*)\)/);
  if (!m) return [1, 0, 0, 1, 0, 0];
  const ns = numbers(m[1]!);
  if (ns.length !== 6) return [1, 0, 0, 1, 0, 0];
  return ns as [number, number, number, number, number, number];
}

function parseSvgPathRing(
  d: string,
  tf: [number, number, number, number, number, number],
): Array<[number, number]> {
  const toks = tokenizePath(d);
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const pts: Array<[number, number]> = [];
  const isCmd = (t: string): boolean => /^[a-zA-Z]$/.test(t);
  const next = (): number => Number(toks[i++]);
  const add = (nx: number, ny: number): void => {
    x = nx;
    y = ny;
    pts.push(transformPoint([x, y], tf));
  };

  while (i < toks.length) {
    if (isCmd(toks[i]!)) cmd = toks[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();

    if (c === "M") {
      let first = true;
      while (i < toks.length && !isCmd(toks[i]!)) {
        let nx = next();
        let ny = next();
        if (rel) {
          nx += x;
          ny += y;
        }
        add(nx, ny);
        if (first) {
          sx = x;
          sy = y;
          first = false;
        }
        cmd = rel ? "l" : "L";
      }
    } else if (c === "L") {
      while (i < toks.length && !isCmd(toks[i]!)) {
        let nx = next();
        let ny = next();
        if (rel) {
          nx += x;
          ny += y;
        }
        add(nx, ny);
      }
    } else if (c === "H") {
      while (i < toks.length && !isCmd(toks[i]!)) {
        let nx = next();
        if (rel) nx += x;
        add(nx, y);
      }
    } else if (c === "V") {
      while (i < toks.length && !isCmd(toks[i]!)) {
        let ny = next();
        if (rel) ny += y;
        add(x, ny);
      }
    } else if (c === "C") {
      while (i < toks.length && !isCmd(toks[i]!)) {
        let x1 = next();
        let y1 = next();
        let x2 = next();
        let y2 = next();
        let x3 = next();
        let y3 = next();
        if (rel) {
          x1 += x;
          y1 += y;
          x2 += x;
          y2 += y;
          x3 += x;
          y3 += y;
        }
        const x0 = x;
        const y0 = y;
        for (const t of [0.25, 0.5, 0.75, 1]) {
          const mt = 1 - t;
          add(
            mt ** 3 * x0 + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
            mt ** 3 * y0 + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3,
          );
        }
      }
    } else if (c === "Z") {
      add(sx, sy);
    } else {
      break;
    }
  }

  return pts;
}

function ringArea(ring: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return Math.abs(a / 2);
}

function extractSvgCandidates(svgPath: string): SvgPathCandidate[] {
  const svg = readFileSync(svgPath, "utf8");
  const body = svg.includes("</defs>") ? svg.slice(svg.indexOf("</defs>") + 7) : svg;
  const paths = [...body.matchAll(/<path\b([^>]*)>/g)].map((m) => m[1]!);
  const candidates: SvgPathCandidate[] = [];

  for (const raw of paths) {
    if (attr(raw, "stroke") !== "#000000") continue;
    if (attr(raw, "stroke-width") !== "3") continue;
    const d = attr(raw, "d");
    if (!d || !/[Zz]/.test(d)) continue;

    const tf = parseTransform(attr(raw, "transform"));
    // ArcGIS Pro map content is transformed around the page center. Identity paths
    // in these PDFs are legend/table furniture and must not receive zone labels.
    if (Math.abs(tf[0] - 1) < 1e-7 && Math.abs(tf[1]) < 1e-7 && Math.abs(tf[2]) < 1e-7) {
      continue;
    }

    const ring = parseSvgPathRing(d, tf);
    if (ring.length < 4) continue;
    const area = ringArea(ring);
    if (area < 50) continue;
    candidates.push({ pageRing: ring, area });
  }

  return candidates;
}

function pageToWgs84(
  page: [number, number],
  pixelSize: [number, number],
  gt: number[],
  projDef: string,
): [number, number] {
  const [pixW, pixH] = pixelSize;
  const col = (page[0] / pixW) * pixW;
  const row = (page[1] / pixH) * pixH;
  const crsX = gt[0]! + col * gt[1]! + row * gt[2]!;
  const crsY = gt[3]! + col * gt[4]! + row * gt[5]!;
  const ll = proj4(projDef, "+proj=longlat +datum=WGS84 +no_defs", [crsX, crsY]);
  return [ll[0]!, ll[1]!];
}

function assignAndBuildGeoJSON(
  slug: string,
  pdfSource: string,
  candidates: SvgPathCandidate[],
  labels: PdfLabel[],
  gdal: ResolvedGdalInfo,
): FeatureCollection {
  const features: Feature<Polygon>[] = [];

  for (const cand of candidates) {
    const pagePoly: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[...cand.pageRing, cand.pageRing[0]!]],
      },
    };
    const matches = new Set<string>();
    for (const label of labels) {
      if (booleanPointInPolygon([label.x, label.y], pagePoly, { ignoreBoundary: true })) {
        matches.add(label.text);
      }
    }
    if (matches.size !== 1) continue;

    const zoneCode = [...matches][0]!;
    const wgsRing = cand.pageRing
      .map((p) => pageToWgs84(p, gdal.pixelSize, gdal.geoTransform, gdal.projDef))
      .filter((p): p is [number, number] => p !== null);
    if (wgsRing.length !== cand.pageRing.length) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[...wgsRing, wgsRing[0]!]],
      },
      properties: {
        zone_code: zoneCode,
        kind: "zone",
        affectation: null,
        num_zone: null,
        source: `pdf-svg-stroke-${slug}`,
        confidence: 0.85,
        provenance: `pdf-svg-stroke:${pdfSource}`,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const slug = args["slug"] as string | undefined;
  const pdfArg = args["pdf"] as string | undefined;
  const dryRun = args["dry-run"] === true;
  const spatialKm = parseFloat((args["spatial-km"] as string) || "30");
  const minCodes = parseInt((args["min-codes"] as string) || "10", 10);

  if (!slug || !pdfArg) {
    console.error(
      "Usage: npx tsx src/recompose-zones-pdf-svg.ts --slug <slug> --pdf <path> [--dry-run]",
    );
    process.exit(2);
  }
  const pdfPath = resolve(pdfArg);
  if (!existsSync(pdfPath)) {
    console.error(`[svg] PDF introuvable: ${pdfPath}`);
    process.exit(2);
  }

  const munis = JSON.parse(readFileSync(MUNI_REGISTRY, "utf8")) as MuniEntry[];
  const muni = munis.find((m) => m.slug === slug);
  if (!muni) {
    console.error(`[svg] slug inconnu: ${slug}`);
    process.exit(2);
  }

  console.error(`[svg] slug=${slug} (${muni.name}) pdf=${pdfPath}${dryRun ? " [DRY-RUN]" : ""}`);
  const gdal = runGdalinfo(pdfPath);
  if (!gdal.geoTransform || !gdal.pixelSize || !gdal.projDef) {
    console.error("[svg] ÉCHEC: GeoTransform/PixelSize/PROJ.4 absent.");
    process.exit(1);
  }
  console.error(`[svg] creator=${gdal.creator ?? "?"} pix=${gdal.pixelSize.join("x")}`);

  const tmpDir = `/tmp/geo-svg-${slug}-${Date.now()}`;
  const svgPath = ensureSvg(pdfPath, tmpDir);
  const candidates = extractSvgCandidates(svgPath);
  const labels = readPdfLabels(pdfPath);
  console.error(`[svg] candidats chemins=${candidates.length} labels_code=${labels.length}`);

  const outGj = assignAndBuildGeoJSON(slug, pdfPath, candidates, labels, {
    geoTransform: gdal.geoTransform,
    pixelSize: gdal.pixelSize,
    projDef: gdal.projDef,
  });
  const uniqueCodes = new Set(
    outGj.features.map((f) => String(f.properties?.["zone_code"] ?? "")).filter(Boolean),
  );
  console.error(`[svg] features=${outGj.features.length} codes_uniques=${uniqueCodes.size}`);
  console.error(`[svg] exemples=${[...uniqueCodes].slice(0, 12).join(", ")}`);

  if (uniqueCodes.size < minCodes) {
    console.error(`[svg] REJET: trop peu de codes uniques (${uniqueCodes.size} < ${minCodes}).`);
    process.exit(0);
  }

  const samplePts: Array<[number, number]> = [];
  for (const f of outGj.features) {
    const ring = (f.geometry as Polygon).coordinates[0] ?? [];
    if (ring.length > 0) samplePts.push(...(ring as Array<[number, number]>));
  }
  const center = bboxCentroid(samplePts);
  if (!center) {
    console.error("[svg] REJET: centroïde impossible.");
    process.exit(1);
  }
  const distKm = haversineKm(center, [muni.lon, muni.lat]);
  console.error(`[svg] spatial=${distKm.toFixed(1)}km du registre (seuil=${spatialKm})`);
  if (distKm > spatialKm) {
    console.error("[svg] REJET: extraction hors territoire.");
    process.exit(1);
  }

  const s3Key = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const localOut = join(tmpDir, `qc-zonage-${slug}.geojson`);
  writeFileSync(localOut, JSON.stringify(outGj));
  console.error(`[svg] local=${localOut}`);
  console.error(`[svg] s3=${s3Key}`);

  if (dryRun) {
    console.error("[svg] DRY-RUN: pas d'écriture S3.");
    return;
  }

  const s3 = s3Client();
  await putBytes(s3, s3Key, JSON.stringify(outGj), "application/geo+json");
  console.error(`[svg] PUBLIÉ ✓ s3://${BUCKET}/${s3Key}`);
}

main().catch((e: unknown) => {
  console.error("[svg] FATAL:", e);
  process.exit(1);
});
