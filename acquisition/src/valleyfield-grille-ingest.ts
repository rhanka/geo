/**
 * valleyfield-grille-ingest.ts — bespoke NATIVE-TEXT ingester for the
 * Salaberry-de-Valleyfield "GRILLE DES USAGES ET NORMES PAR ZONE" annexes.
 *
 * WHY a dedicated ingester: Valleyfield publishes its grille as 8 per-land-use
 * "Annexe A" PDFs (A, C, H, I, P, U, REC, CONS) of Règlement 150, one ZONE PER
 * PAGE, in a bespoke 2D layout. The three frozen extractors do NOT parse it:
 *   - native (Sherbrooke horizontal): header anchors miss → 0 rows;
 *   - mistral-ocr: reads ROW LABELS ("Latérales totales minimum (m)") as zone
 *     codes → anti-invention gate rejects (overlap=0);
 *   - vision: the page's own code is "ZONE:  H- 104" (colon + rotated box) which
 *     `expectedZoneFromPage` cannot anchor → "no-zone" on every page.
 * But the PDFs are NATIVE TEXT: `pdftotext -layout` yields the code and every
 * norm value verbatim. This module reads them deterministically ($0, no LLM),
 * maps them to the SAME `ZoneNormsT` shape, cross-validates against the muni's
 * SIG grille, and deposits the SAME `qc-zonage-norms-<slug>.parquet` product via
 * the UNMODIFIED `depositParquetOnly` (parquet-only, no manifest race).
 *
 * ANTI-INVENTION: every `value` is a verbatim token from the page; a row that is
 * absent or non-numeric ("s.o.", "n", "-") yields `value:null` + `raw`. The zone
 * code is read verbatim from the page's "ZONE:" box; nothing is synthesised. When
 * a zone recurs (usages + norms feuillets), the record with MORE published fields
 * wins (never overwrite a value with null).
 *
 * Routes are the muni's OWN portal URLs (ville.valleyfield.qc.ca → CloudFront CDN),
 * enumerated from the public "Zonage et ses amendements" page.
 *
 * Usage (one committed command):
 *   # report only (parse + crossval, NO deposit, NO download if already local):
 *   npx tsx acquisition/src/valleyfield-grille-ingest.ts --report
 *   # download the 8 annexes then deposit the merged norms parquet:
 *   npx tsx acquisition/src/valleyfield-grille-ingest.ts --download --deposit
 *   # parse ONE local annex file (debug):
 *   npx tsx acquisition/src/valleyfield-grille-ingest.ts --pdf <path> --report
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FieldProvenanceT,
  NormFieldT,
  NormUnitT,
  ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client } from "./lib/s3.js";
import { crossValidateZoneCodes, depositParquetOnly } from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SLUG = "salaberry-de-valleyfield";
const WORK = join(REPO, "work", "zonage-norms", SLUG, "annexes");
const CDN = "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/";
const LISTING_URL =
  "https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements";
const UA =
  "sentropic-geo/1.0 (+https://github.com/sentropic; municipal open-data acquisition)";

/** The 8 per-land-use grille annexes, verbatim from the official portal listing. */
const ANNEXES: ReadonlyArray<{ family: string; file: string }> = [
  { family: "A", file: "Reglement-150-codifie-Annexe-A-Zones-A-Agricoles-150-44.pdf" },
  { family: "C", file: "Zones-C-Commerciales-pvc-et-150-51.pdf" },
  { family: "H", file: "Zones-H-Residentielles-pvc-et-150-51.pdf" },
  { family: "I", file: "Zones-I-Industrielles-pvc-et-150-51.pdf" },
  { family: "REC", file: "Zones-REC-Recreatives-150-51.pdf" },
  { family: "U", file: "Zones-U-Utilite-publique-150-51.pdf" },
  { family: "P", file: "Zones-P-Communautaire-150-47.pdf" },
  { family: "CONS", file: "Zones-CONS-Conservation-150-47.pdf" },
];

const SNAPSHOT = new Date().toISOString().slice(0, 10);

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv: string[], k: string): boolean {
  return argv.includes(`--${k}`);
}

// ── pdftotext -layout → per-page texts ───────────────────────────────────────
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

// ── field builders (ANTI-INVENTION: verbatim raw, null beats a guess) ─────────
function present(value: number, raw: string, unit: NormUnitT, prov: FieldProvenanceT): NormFieldT {
  return { value, raw, unit, confidence: 0.95, _provenance: prov };
}
function absent(raw: string, unit: NormUnitT, prov: FieldProvenanceT): NormFieldT {
  return { value: null, raw, unit, confidence: 0, flag: "absent", _provenance: prov };
}

/** Parse a French numeric token ("1,5", "70", "-", "s.o.") → number | null. */
function num(tok: string | undefined): number | null {
  if (!tok) return null;
  const t = tok.trim();
  if (t === "" || t === "-" || t === "–" || /^s\.?o\.?$/i.test(t) || /^n\/?a$/i.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * From a labelled grille row, return the FIRST value column as a "min/max" pair.
 * The tail after the label carries an optional unit marker "(m)"/"(m²)" then the
 * value tokens (repeated once per usage column — the leftmost is taken, a
 * consistent, documented choice). A "5/10" token splits into {min:5, max:10};
 * "70/-" → {min:70, max:null}; a bare "8" → {min:8, max:null}.
 */
function firstValue(line: string, labelRe: RegExp): { raw: string; min: number | null; max: number | null } | null {
  const m = line.match(labelRe);
  if (!m) return null;
  let tail = line.slice((m.index ?? 0) + m[0].length);
  tail = tail.replace(/\((?:m²|m2|m|ha)\)/gi, " "); // drop the unit marker(s)
  // First value token: digits (French comma) or a dash, optionally "/second".
  const tok = tail.match(/(-|\d+(?:[.,]\d+)?)(?:\s*\/\s*(-|\d+(?:[.,]\d+)?))?/);
  if (!tok) return null;
  return { raw: (tok[2] ? `${tok[1]}/${tok[2]}` : tok[1] ?? "").trim(), min: num(tok[1]), max: num(tok[2]) };
}

// Case-insensitive on the prefix: most families are uppercase (H-104) but the
// CONS annex prints "ZONE:  Cons- 147-1" in mixed case. The code is uppercased so
// it matches the SIG layer's canonical "CONS-147-1" (anti-invention: verbatim
// digits, only the letter case is normalised).
const ZONE_CODE_RE = /ZONE\s*:\s*([A-Za-z]{1,4})\s*-\s*(\d{1,4}(?:-\d{1,3})?)/i;

const LABELS = {
  hauteur: /Hauteur\s+en\s+m[èe]tre\s+min\s*\/\s*max/i,
  frontage: /Largeur\s+minimum/i,
  superficie: /Superficie\s+d.implantation\s+min\s*\/\s*max/i,
  avant: /Avant\s+minimum/i,
  laterale: /Lat[ée]rale\s+minimum/i,
  arriere: /Arri[èe]re\s+minimum/i,
  densite: /Rapport\s+espace\s+b[âa]timent\s*\/\s*terrain\s+max/i,
} as const;

interface ParsedZone {
  zone: ZoneNormsT;
  publishedCount: number;
}

/** Parse ONE grille page into a ZoneNorms (or null if it carries no zone code). */
function parsePage(text: string, sourceUrl: string, pageNo: number): ParsedZone | null {
  const codeM = text.match(ZONE_CODE_RE);
  if (!codeM) return null;
  const zoneCode = `${codeM[1]}-${codeM[2]}`.toUpperCase();
  const lines = text.split(/\r?\n/);
  const prov: FieldProvenanceT = {
    source_url: sourceUrl,
    methode: "native-text/valleyfield-annexe-grille",
    snapshot: SNAPSHOT,
    page: `p${pageNo} ZONE ${zoneCode}`,
  };

  const pick = (labelRe: RegExp): { raw: string; min: number | null; max: number | null } | null => {
    for (const ln of lines) {
      const v = firstValue(ln, labelRe);
      if (v) return v;
    }
    return null;
  };

  const hauteur = pick(LABELS.hauteur);
  const frontage = pick(LABELS.frontage);
  const superficie = pick(LABELS.superficie);
  const avant = pick(LABELS.avant);
  const laterale = pick(LABELS.laterale);
  const arriere = pick(LABELS.arriere);
  const densite = pick(LABELS.densite);

  const mk = (
    v: { raw: string; min: number | null; max: number | null } | null,
    which: "min" | "max",
    unit: NormUnitT,
  ): NormFieldT | null => {
    if (!v) return null;
    const n = which === "min" ? v.min : v.max;
    return n !== null ? present(n, v.raw, unit, prov) : absent(v.raw, unit, prov);
  };

  const zone: ZoneNormsT = {
    zone_code: zoneCode,
    zone_page: `p${pageNo}`,
    usages: [],
    densite: densite ? mk(densite, "min", "ratio") : null,
    hauteur_min: hauteur ? mk(hauteur, "min", "m") : null,
    hauteur_max: hauteur ? mk(hauteur, "max", "m") : null,
    marges: {
      avant_min: avant ? mk(avant, "min", "m") : null,
      laterale_min: laterale ? mk(laterale, "min", "m") : null,
      arriere_min: arriere ? mk(arriere, "min", "m") : null,
    },
    frontage_min: frontage ? mk(frontage, "min", "m") : null,
    superficie_min: superficie ? mk(superficie, "min", "m2") : null,
  };

  const fields = [
    zone.densite,
    zone.hauteur_min,
    zone.hauteur_max,
    zone.frontage_min,
    zone.superficie_min,
    zone.marges.avant_min,
    zone.marges.laterale_min,
    zone.marges.arriere_min,
  ];
  const publishedCount = fields.filter((f) => f && f.value !== null).length;
  return { zone, publishedCount };
}

async function downloadAnnex(file: string): Promise<string> {
  if (!existsSync(WORK)) mkdirSync(WORK, { recursive: true });
  const local = join(WORK, file);
  if (existsSync(local)) return local;
  const url = `${CDN}${file}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA, accept: "application/pdf,*/*" } });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!(buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    throw new Error(`not a PDF: ${url}`);
  }
  writeFileSync(local, buf);
  console.error(`[dl] ${file} ${(buf.length / 1e6).toFixed(1)} Mo`);
  return local;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const download = has(argv, "download");
  const deposit = has(argv, "deposit");
  const singlePdf = arg(argv, "pdf");

  // Resolve the annex PDF paths (single-file debug OR the 8-family set).
  const files: Array<{ family: string; path: string; url: string }> = [];
  if (singlePdf) {
    files.push({ family: "single", path: singlePdf, url: singlePdf });
  } else {
    for (const a of ANNEXES) {
      const local = join(WORK, a.file);
      if (download) await downloadAnnex(a.file);
      if (!existsSync(local)) {
        console.error(`[skip] missing local annex (${a.family}) — pass --download: ${local}`);
        continue;
      }
      files.push({ family: a.family, path: local, url: `${CDN}${a.file}` });
    }
  }
  if (files.length === 0) throw new Error("no annex PDFs available (pass --download)");

  // Parse + merge by zone_code (more published fields wins).
  const byZone = new Map<string, ParsedZone & { url: string; family: string }>();
  const perFamily: Record<string, number> = {};
  for (const f of files) {
    const pages = pageTexts(f.path);
    let found = 0;
    for (let i = 0; i < pages.length; i++) {
      const parsed = parsePage(pages[i] ?? "", f.url, i + 1);
      if (!parsed) continue;
      found++;
      const key = parsed.zone.zone_code;
      const prev = byZone.get(key);
      if (!prev || parsed.publishedCount > prev.publishedCount) {
        byZone.set(key, { ...parsed, url: f.url, family: f.family });
      }
    }
    perFamily[f.family] = (perFamily[f.family] ?? 0) + found;
    console.error(`[parse] ${f.family}: ${found} zone pages (${pages.length} pages)`);
  }

  const zones: ZoneNormsT[] = [...byZone.values()].map((z) => z.zone);
  const distinct = new Set(zones.map((z) => z.zone_code));
  // Per-field published stats.
  let totalFields = 0;
  let published = 0;
  for (const z of byZone.values()) {
    totalFields += 8;
    published += z.publishedCount;
  }
  const fieldPct = totalFields ? Math.round((published / totalFields) * 1000) / 10 : 0;
  console.error(`[merge] distinct zones=${distinct.size} publishedFieldPct=${fieldPct}%`);
  console.error(`[sample] ${zones.slice(0, 8).map((z) => `${z.zone_code}(h=${z.hauteur_max?.value ?? "-"},av=${z.marges.avant_min?.value ?? "-"})`).join(" ")}`);

  // Cross-validate against the SIG zones layer (real overlap gate).
  const s3 = s3Client();
  const crossval = await crossValidateZoneCodes(s3, SLUG, zones);
  console.error(
    `[crossval] grid=${crossval.gridFound} sig=${crossval.sigZoneCodes} extracted=${crossval.extractedZoneCodes} ` +
      `overlap=${crossval.overlap} recoupExtracted=${(crossval.recoupExtracted * 100).toFixed(0)}% recoupSig=${(crossval.recoupSig * 100).toFixed(0)}%`,
  );
  if (crossval.extractedNotInSig.length > 0) {
    console.error(`[crossval] extracted-not-in-SIG sample: ${crossval.extractedNotInSig.join(", ")}`);
  }

  // Gates (mirror zonage-norms-run's anti-invention floor).
  const gatesOk = distinct.size >= 3 && !(crossval.gridFound && crossval.overlap === 0) && fieldPct > 0;
  if (!deposit) {
    console.log(
      JSON.stringify(
        {
          slug: SLUG,
          deposited: false,
          reportOnly: true,
          distinctZones: distinct.size,
          publishedFieldPct: fieldPct,
          perFamily,
          crossval: { gridFound: crossval.gridFound, sig: crossval.sigZoneCodes, overlap: crossval.overlap, recoupSig: Math.round(crossval.recoupSig * 1000) / 10 },
          gatesOk,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!gatesOk) {
    throw new Error(`refuse deposit: gates not met (distinct=${distinct.size}, overlap=${crossval.overlap}, fieldPct=${fieldPct})`);
  }

  const { result } = await depositParquetOnly({
    s3,
    slug: SLUG,
    zones,
    meta: {
      source_url: LISTING_URL,
      reglement: "150",
      methode: "native-text/valleyfield-annexe-grille",
      snapshot: SNAPSHOT,
    },
    crossval,
  });
  console.log(
    JSON.stringify(
      {
        slug: SLUG,
        deposited: true,
        key: result.key,
        rows: result.rows,
        uniqueZoneCodes: result.uniqueZoneCodes,
        publishedFieldPct: result.publishedFieldPct,
        crossval: { sig: crossval.sigZoneCodes, overlap: crossval.overlap, recoupSig: Math.round(crossval.recoupSig * 1000) / 10 },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
