/**
 * deposit-category-grille.ts -- deposit a `qc-zonage-norms-<slug>.parquet` for a
 * municipality whose zoning by-law defines its implantation norms PER CATEGORY of
 * zone (a "chapeau" section per zone type) rather than as a per-zone-code grille
 * des spécifications. Saint-Côme-Linière (règl. 148-06 consolidé 2021, Chapitre 6)
 * is the first such case.
 *
 * WHY a dedicated (small) helper and not `zonage-norms-run.ts`: the frozen grille
 * extractors all key on a per-zone header band / grille matrix. A category-organised
 * by-law has none — its norms live in prose category tables (§6.3 résidentiel,
 * §6.5 commercial, …). This helper consumes an AUDITABLE, human-reviewed category
 * map (`acquisition/config/norms-category-map/<slug>.json`) that captures those
 * tables VERBATIM and records, per category, ONLY the norm fields that are UNIFORM
 * across every use-type sub-row of the category (a value that does not depend on
 * which permitted use is built). It then propagates those verbatim values onto each
 * INDIVIDUAL SIG zone code by its letter prefix, honouring explicit per-zone
 * surcharges from the by-law.
 *
 * ANTI-INVENTION: every deposited value is copied VERBATIM from the config (itself a
 * verbatim transcription of the by-law table, with the §ref as `basis`). A field
 * that is not uniform across the category — or absent from the zoning by-law
 * entirely (lot superficie/frontage/densité live in the LOTISSEMENT by-law) — is
 * `null`, never guessed. Each row carries a `norme_derivation` transparency column
 * ("categorie-§6.x[+surcharge]") and provenance `_reglement`/`_source_url`. The
 * zone-code SET is taken from the muni's own SIG grille, so overlap is 100% by
 * construction (no fabricated code).
 *
 * Usage (npx tsx, from acquisition/):
 *   tsx src/deposit-category-grille.ts --slug saint-come-liniere
 *   tsx src/deposit-category-grille.ts --slug saint-come-liniere --dry-run
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";
import {
  NORM_FIELDS,
  canonZone,
  canonZoneCodeServe,
  normsKey,
  resolveGridKey,
  sigZoneCodesFromGeojsonRaw,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, "..");

/** Anti-invention floor (mirrors zonage-norms-run.ts). */
const MIN_DEPOSIT_ZONE_CODES = 3;

interface NormDef {
  value: number | null;
  raw: string;
  unit: string | null;
  confidence: number;
  basis?: string;
}

interface CategoryDef {
  section: string;
  uniform_norms: Record<string, NormDef>;
}

interface CategoryMap {
  slug: string;
  reglement: string;
  source_url: string;
  snapshot: string;
  methode: string;
  prefix_to_category: Record<string, string>;
  categories: Record<string, CategoryDef>;
  surcharges_par_zone?: Record<string, Record<string, NormDef>>;
}

interface Args {
  slug: string;
  configPath: string;
  dryRun: boolean;
  outPath: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const slug = get("slug");
  if (!slug) throw new Error("required: --slug <slug>");
  return {
    slug,
    configPath: get("config") ?? join(ACQ, "config", "norms-category-map", `${slug}.json`),
    dryRun: argv.includes("--dry-run"),
    outPath:
      get("out") ??
      resolve(ACQ, "..", "work", "zonage-norms", slug, "grille-categorielle-verbatim.json"),
  };
}

/** Leading maximal alpha run of a code ("RA-21"->"RA", "A-200"->"A", "P-60"->"P"). */
function prefixOf(code: string): string {
  const m = /^[A-Za-z]+/.exec(code.trim());
  return m ? m[0].toUpperCase() : "";
}

/** Parquet schema: the deployed 40-column norms schema + a `norme_derivation`
 *  transparency column (extra columns flow through publish-norms-grilles and the
 *  lot⋈norms join verbatim). */
function buildSchema(): { schema: ParquetSchema; columns: string[] } {
  const utf8 = { type: "UTF8", optional: true, compression: "SNAPPY" } as const;
  const dbl = { type: "DOUBLE", optional: true, compression: "SNAPPY" } as const;
  const fields: Record<string, unknown> = {
    zone_code: utf8,
    zone_page: utf8,
    usages: utf8,
  };
  for (const f of NORM_FIELDS) {
    fields[`${f}_value`] = dbl;
    fields[`${f}_raw`] = utf8;
    fields[`${f}_unit`] = utf8;
    fields[`${f}_confidence`] = dbl;
  }
  fields["_source_url"] = utf8;
  fields["_reglement"] = utf8;
  fields["_methode"] = utf8;
  fields["_snapshot"] = utf8;
  fields["norme_derivation"] = utf8;
  return { schema: new ParquetSchema(fields as never), columns: Object.keys(fields) };
}

/** Apply one norm def onto a flat row (mirrors lib flattenField semantics: a null
 *  value stores raw/unit/confidence but omits `_value`). */
function applyNorm(row: Record<string, unknown>, field: string, def: NormDef): void {
  row[`${field}_value`] = def.value === null ? undefined : def.value;
  row[`${field}_raw`] = def.raw || undefined;
  row[`${field}_unit`] = def.unit ?? undefined;
  row[`${field}_confidence`] = def.confidence;
}

function publishedValueCount(row: Record<string, unknown>): number {
  let n = 0;
  for (const f of NORM_FIELDS) if (row[`${f}_value`] !== undefined) n++;
  return n;
}

async function writeParquet(rows: Record<string, unknown>[]): Promise<Buffer> {
  const { schema, columns } = buildSchema();
  const dir = await mkdtemp(join(tmpdir(), "cat-grille-"));
  const path = join(dir, "out.parquet");
  try {
    const writer = await ParquetWriter.openFile(schema, path);
    for (const r of rows) {
      const out: Record<string, unknown> = {};
      for (const c of columns) {
        const v = r[c];
        out[c] = v === null || v === undefined ? undefined : v;
      }
      await writer.appendRow(out);
    }
    await writer.close();
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(await readFile(args.configPath, "utf8")) as CategoryMap;
  if (cfg.slug !== args.slug) {
    throw new Error(`config slug "${cfg.slug}" != --slug "${args.slug}"`);
  }

  const s3 = s3Client();
  const gridKey = await resolveGridKey(s3, args.slug);
  if (!gridKey) throw new Error(`no SIG grille on S3 for ${args.slug} (cannot source zone codes)`);
  const geojson = (await getBytes(s3, gridKey)).toString("utf8");
  const rawCodes = [...sigZoneCodesFromGeojsonRaw(geojson)].filter((c) => c && c.trim());
  if (rawCodes.length < MIN_DEPOSIT_ZONE_CODES) {
    throw new Error(`SIG grille exposes only ${rawCodes.length} codes (< ${MIN_DEPOSIT_ZONE_CODES})`);
  }
  console.error(`[cat-grille] SIG grille ${gridKey}: ${rawCodes.length} distinct zone codes`);

  // Canonical surcharge index.
  const surchargeByCanon = new Map<string, Record<string, NormDef>>();
  for (const [zc, norms] of Object.entries(cfg.surcharges_par_zone ?? {})) {
    surchargeByCanon.set(canonZone(zc), norms);
  }

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const perCategory = new Map<string, number>();
  const uncategorized: string[] = [];
  const surchargedApplied: string[] = [];

  for (const raw of rawCodes) {
    const zoneCode = canonZoneCodeServe(raw);
    const canon = canonZone(zoneCode);
    if (seen.has(canon)) continue;
    seen.add(canon);

    const prefix = prefixOf(zoneCode);
    const catKey = cfg.prefix_to_category[prefix];
    const cat = catKey ? cfg.categories[catKey] : undefined;

    const row: Record<string, unknown> = {
      zone_code: zoneCode,
      _source_url: cfg.source_url,
      _reglement: cfg.reglement,
      _methode: cfg.methode,
      _snapshot: cfg.snapshot,
    };

    let derivation: string;
    if (!cat) {
      uncategorized.push(zoneCode);
      derivation = `non-catégorisé (préfixe ${prefix} absent de la carte) — ligne de grille sans normes`;
    } else {
      for (const [field, def] of Object.entries(cat.uniform_norms)) applyNorm(row, field, def);
      derivation = `categorie-${cat.section} (${catKey}; préfixe ${prefix})`;
      perCategory.set(catKey, (perCategory.get(catKey) ?? 0) + 1);
      const surcharge = surchargeByCanon.get(canon);
      if (surcharge) {
        for (const [field, def] of Object.entries(surcharge)) applyNorm(row, field, def);
        derivation += `+surcharge-zone(${Object.keys(surcharge).join(",")})`;
        surchargedApplied.push(zoneCode);
      }
    }
    row["zone_page"] = derivation;
    row["norme_derivation"] = derivation;
    rows.push(row);
  }

  rows.sort((a, b) => String(a["zone_code"]).localeCompare(String(b["zone_code"])));

  const withNorms = rows.filter((r) => publishedValueCount(r) > 0).length;
  const totalValues = rows.length * NORM_FIELDS.length;
  const publishedValues = rows.reduce((n, r) => n + publishedValueCount(r), 0);
  const pct = totalValues ? Math.round((publishedValues / totalValues) * 1000) / 10 : 0;

  // Anti-invention self-checks.
  if (rows.length < MIN_DEPOSIT_ZONE_CODES) throw new Error(`only ${rows.length} rows (< ${MIN_DEPOSIT_ZONE_CODES})`);
  if (publishedValues === 0) throw new Error("0 published norm values — refusing to deposit (anti-invention)");
  if (uncategorized.length > 0) {
    console.error(`[cat-grille] WARN ${uncategorized.length} uncategorized codes: ${uncategorized.join(",")}`);
  }

  console.error(
    `[cat-grille] rows=${rows.length} withNorms=${withNorms} publishedFieldPct=${pct}% ` +
      `surcharged=${surchargedApplied.join(",") || "none"}`,
  );
  for (const [k, n] of [...perCategory].sort()) console.error(`[cat-grille]   ${k}: ${n} zones`);

  // Local audit artifact (committable).
  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(
    args.outPath,
    JSON.stringify(
      {
        slug: args.slug,
        reglement: cfg.reglement,
        source_url: cfg.source_url,
        snapshot: cfg.snapshot,
        methode: cfg.methode,
        sig_grille_key: gridKey,
        num_zones: rows.length,
        num_with_norms: withNorms,
        published_field_pct: pct,
        surcharges_applied: surchargedApplied,
        uncategorized,
        rows,
      },
      null,
      2,
    ),
  );
  console.error(`[cat-grille] audit written: ${args.outPath}`);

  if (args.dryRun) {
    console.error("[cat-grille] --dry-run: not uploading parquet");
    return;
  }

  const parquet = await writeParquet(rows);
  const key = normsKey(args.slug);
  await putBytes(s3, key, parquet, "application/octet-stream");
  console.error(`[cat-grille] deposited s3://${BUCKET}/${key} (${parquet.length} bytes)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
