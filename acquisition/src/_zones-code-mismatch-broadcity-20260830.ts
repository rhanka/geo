/**
 * _zones-code-mismatch-broadcity-20260830.ts — READ-ONLY broad-city CODE-MISMATCH
 * scan (SIG served zone codes ↔ deposited NORMS zone codes) over every served
 * `qc-zonage-<slug>` muni. This is the "périmé" (code-mismatch) layer of the
 * zone-SIG-freshness inventory (geo-archi §3).
 *
 * WHAT IT ANSWERS, per muni: does a served SIG zone code exist that has NO matching
 * NORMS code (mont-tremblant: SIG `RA-4xx` vs normes `RA-1xx` → 0 match → mismatch)?
 *
 * REUSE (no re-invention of the canon or the mismatch rule):
 *   - Canon (BOTH sides): `canonZone` from `acquisition/src/lib/zonage-norms.ts`,
 *     which delegates VERBATIM to `canonicalizeZoneCodeForJoin`
 *     (`packages/geo/src/zonage/lotZoneJoin.ts`) — the authoritative GEO join canon
 *     (order-invariant, dash, case, leading-zero, trailing-annotation folds). NOT a
 *     trim+UPPER approximation.
 *   - Served SIG codes: `sigZoneCodesFromGeojsonRaw` (verbatim served strings, same
 *     whitelisted CODE columns as the deposit gate) — the SAME extraction
 *     `diagnose-code-mismatch.ts` cross-checks against.
 *   - NORMS codes: the DEPOSITED product `registry/qc-zonage-norms/
 *     qc-zonage-norms-<slug>.parquet`, `zone_code` column, read via hyparquet —
 *     the exact source `acquisition/src/norms-codes-dump.ts` reads. NOT a 873×
 *     grille-PDF re-parse.
 *
 * mismatch(muni) = ∃ a canon SIG code with NO matching canon normes code (plain
 * canonical set membership — the stricter "périmé" signal; no numeric-vintage
 * bridge). A muni with NO deposited normes parquet → `normes-source-gap`: mismatch
 * NOT assessable (absence of normes ≠ a match; NEVER reported as "0 mismatch").
 *
 * STRICTLY READ-ONLY: no S3 write, no deposit, no mutation. Creds are PROD
 * (`sentropic-geo`, OVH). Outputs:
 *   work/coverage/zones-code-mismatch-broadcity-20260830.{json,md}
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_zones-code-mismatch-broadcity-20260830.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

import { s3Client, getBytes, listObjectEntries } from "./lib/s3.js";
import {
  canonZone,
  resolveGridKey,
  sigZoneCodesFromGeojsonRaw,
  normsKey,
  ZONAGE_GRIDS_PREFIX,
  ZONAGE_NORMS_PREFIX,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SNAPSHOT = "2026-08-30";
const CANON_USED =
  "canonZone (acquisition/src/lib/zonage-norms.ts) → delegates verbatim to " +
  "canonicalizeZoneCodeForJoin (packages/geo/src/zonage/lotZoneJoin.ts)";
const NORMS_SOURCE_DESC =
  "deposited parquet registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet, " +
  "zone_code column (same source as acquisition/src/norms-codes-dump.ts)";
const CITED = ["repentigny", "beaupre", "mont-tremblant"] as const;

// ── Deposited-norms code column detection — replicated VERBATIM from
//    acquisition/src/norms-codes-dump.ts (deterministic column parsing; the canon
//    itself is reused, not re-invented). The deployed schema always carries
//    `zone_code`, but auto-detection keeps older/variant products readable.
const CODE_COL_PATTERNS = [
  /^zone_?code$/i, /^numero_?zone$/i, /^num_?zone$/i, /^no_?zone$/i,
  /^code_?zone$/i, /^zonage$/i, /^zone$/i, /^numerozone$/i, /^grille$/i,
];
function pickCodeCol(cols: string[]): string | null {
  for (const p of CODE_COL_PATTERNS) {
    const hit = cols.find((c) => p.test(c));
    if (hit) return hit;
  }
  return cols.find((c) => /zone/i.test(c)) ?? null;
}

/** Bounded-concurrency map (FAST; avoids serial S3 latency across ~873 munis). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

interface MuniResult {
  slug: string;
  grid_key: string | null;
  n_sig_codes: number;
  n_normes_codes: number | null;
  n_mismatched: number | null;
  mismatched_sig_codes: string[]; // verbatim served (raw) SIG strings, sorted
  mismatch: "yes" | "no" | "n-a";
  normes_source: "deposited" | "source-gap";
  canon_used: string;
  error?: string;
}

async function readNormsCanonCodes(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<{ canon: Set<string>; raw: string[] } | null> {
  const key = normsKey(slug);
  const buf = await getBytes(s3, key);
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const rows = (await parquetReadObjects({ file, compressors })) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { canon: new Set<string>(), raw: [] };
  const cols = Object.keys(rows[0]!);
  const codeCol = pickCodeCol(cols);
  if (!codeCol) throw new Error(`no zone-code column in ${key} (cols=${JSON.stringify(cols)})`);
  const raw = new Set<string>();
  for (const r of rows) {
    const v = r[codeCol];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) raw.add(s);
  }
  const canon = new Set<string>();
  for (const v of raw) {
    const c = canonZone(v);
    if (c) canon.add(c);
  }
  return { canon, raw: [...raw].sort() };
}

async function scanMuni(
  s3: ReturnType<typeof s3Client>,
  slug: string,
  hasDepositedNorms: boolean,
): Promise<MuniResult> {
  const base: MuniResult = {
    slug,
    grid_key: null,
    n_sig_codes: 0,
    n_normes_codes: null,
    n_mismatched: null,
    mismatched_sig_codes: [],
    mismatch: "n-a",
    normes_source: hasDepositedNorms ? "deposited" : "source-gap",
    canon_used: CANON_USED,
  };
  try {
    const gridKey = await resolveGridKey(s3, slug);
    base.grid_key = gridKey;
    if (!gridKey) {
      base.error = "SIG grid key not resolved (neither flat nor nested layout)";
      return base;
    }
    const geojson = (await getBytes(s3, gridKey)).toString("utf8");
    const sigRaw = [...sigZoneCodesFromGeojsonRaw(geojson)]; // verbatim served strings
    const sigCanonSet = new Set(sigRaw.map(canonZone).filter(Boolean));
    base.n_sig_codes = sigCanonSet.size;

    if (!hasDepositedNorms) {
      // normes-source-gap: mismatch NOT assessable. Absence of normes ≠ a match.
      base.normes_source = "source-gap";
      base.mismatch = "n-a";
      return base;
    }

    const norms = await readNormsCanonCodes(s3, slug);
    if (norms === null) {
      base.normes_source = "source-gap";
      base.mismatch = "n-a";
      base.error = "deposited norms parquet unreadable";
      return base;
    }
    base.n_normes_codes = norms.canon.size;
    const mismatchedRaw = sigRaw.filter((r) => {
      const c = canonZone(r);
      return c !== "" && !norms.canon.has(c);
    });
    const mismatchedCanon = new Set(mismatchedRaw.map(canonZone));
    base.mismatched_sig_codes = [...new Set(mismatchedRaw)].sort();
    base.n_mismatched = mismatchedCanon.size;
    base.mismatch = mismatchedCanon.size > 0 ? "yes" : "no";
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
    return base;
  }
}

function servedSlugsFromKeys(keys: string[]): string[] {
  const slugs = new Set<string>();
  for (const key of keys) {
    // Mirrors isServedZoneKey (acquisition/src/lib/s3.ts): flat + nested layouts.
    const m = key.match(
      /^normalized\/ca-qc-zonage\/qc-zonage-([a-z0-9-]+)(?:\.geojson|\/qc-zonage-([a-z0-9-]+)\.geojson)$/,
    );
    if (m && (!m[2] || m[1] === m[2])) slugs.add(m[1]!);
  }
  return [...slugs].sort();
}

function depositedNormsSlugs(keys: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const key of keys) {
    const m = key.match(/^registry\/qc-zonage-norms\/qc-zonage-norms-([a-z0-9-]+)\.parquet$/);
    if (m) slugs.add(m[1]!);
  }
  return slugs;
}

function renderMarkdown(
  results: MuniResult[],
  summary: Record<string, unknown>,
): string {
  const lines: string[] = [];
  lines.push(`# Code-mismatch SIG↔normes — broad-city (couche « périmé » §3)`);
  lines.push("");
  lines.push(`- Snapshot: **${SNAPSHOT}** — READ-ONLY (bucket \`sentropic-geo\`, OVH/PROD)`);
  lines.push(`- Canon (deux côtés): \`${CANON_USED}\``);
  lines.push(`- Source normes: ${NORMS_SOURCE_DESC}`);
  lines.push(
    `- Règle: mismatch(muni) = ∃ code SIG canon SANS code normes canon correspondant ` +
      `(appartenance ensembliste canon; pas de pont numérique de millésime). ` +
      `normes absentes → \`source-gap\` (mismatch NON évaluable, jamais « 0 mismatch »).`,
  );
  lines.push("");
  lines.push(`## Synthèse`);
  lines.push("");
  for (const [k, v] of Object.entries(summary)) lines.push(`- **${k}**: ${v}`);
  lines.push("");

  lines.push(`## Cas cités (geo-archi)`);
  lines.push("");
  for (const slug of CITED) {
    const r = results.find((x) => x.slug === slug);
    if (!r) {
      lines.push(`### ${slug}`);
      lines.push(`- NON servi (absent de \`normalized/ca-qc-zonage/\`).`);
      lines.push("");
      continue;
    }
    lines.push(`### ${slug}`);
    lines.push(`- normes_source: **${r.normes_source}** · mismatch: **${r.mismatch}**`);
    lines.push(`- n_sig_codes=${r.n_sig_codes} · n_normes_codes=${r.n_normes_codes ?? "—"} · n_mismatched=${r.n_mismatched ?? "—"}`);
    if (r.error) lines.push(`- error: ${r.error}`);
    if (r.mismatched_sig_codes.length > 0) {
      const show = r.mismatched_sig_codes.slice(0, 40);
      lines.push(`- SIG codes sans normes correspondante (verbatim): ${show.map((c) => `\`${c}\``).join(", ")}${r.mismatched_sig_codes.length > show.length ? ` … (+${r.mismatched_sig_codes.length - show.length})` : ""}`);
    }
    lines.push("");
  }

  const mism = results.filter((r) => r.mismatch === "yes").sort((a, b) => (b.n_mismatched ?? 0) - (a.n_mismatched ?? 0) || a.slug.localeCompare(b.slug));
  lines.push(`## Munis avec mismatch (${mism.length})`);
  lines.push("");
  lines.push(`| slug | n_sig | n_normes | n_mismatched | échantillon codes SIG sans normes |`);
  lines.push(`| --- | ---: | ---: | ---: | --- |`);
  for (const r of mism) {
    const sample = r.mismatched_sig_codes.slice(0, 8);
    const extra = r.mismatched_sig_codes.length > sample.length ? ` +${r.mismatched_sig_codes.length - sample.length}` : "";
    lines.push(`| ${r.slug} | ${r.n_sig_codes} | ${r.n_normes_codes ?? "—"} | ${r.n_mismatched ?? "—"} | ${sample.map((c) => `\`${c}\``).join(" ")}${extra} |`);
  }
  lines.push("");

  const gaps = results.filter((r) => r.normes_source === "source-gap");
  lines.push(`## normes-source-gap (${gaps.length}) — mismatch NON évaluable`);
  lines.push("");
  lines.push(`Munis servis SANS normes déposées: mismatch/fraîcheur non mesurable (absence de normes ≠ match).`);
  lines.push("");
  const errs = results.filter((r) => r.error);
  if (errs.length > 0) {
    lines.push(`## Erreurs de lecture (${errs.length})`);
    lines.push("");
    for (const r of errs.slice(0, 60)) lines.push(`- ${r.slug}: ${r.error}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const s3 = s3Client();

  console.error(`[scan] listing served zonage keys under ${ZONAGE_GRIDS_PREFIX} …`);
  const gridEntries = await listObjectEntries(s3, ZONAGE_GRIDS_PREFIX);
  const servedSlugs = servedSlugsFromKeys(gridEntries.map((e) => e.key));
  console.error(`[scan] served zonage munis = ${servedSlugs.length}`);

  console.error(`[scan] listing deposited norms under ${ZONAGE_NORMS_PREFIX} …`);
  const normsEntries = await listObjectEntries(s3, ZONAGE_NORMS_PREFIX);
  const normsSlugs = depositedNormsSlugs(normsEntries.map((e) => e.key));
  console.error(`[scan] deposited norms products = ${normsSlugs.size}`);

  const results = await mapLimit(servedSlugs, 12, async (slug) => {
    const r = await scanMuni(s3, slug, normsSlugs.has(slug));
    return r;
  });

  const scanned = results.filter((r) => !r.error || r.grid_key !== null);
  const readErrors = results.filter((r) => r.error && r.grid_key === null);
  const assessable = results.filter((r) => r.normes_source === "deposited" && !r.error);
  const withMismatch = results.filter((r) => r.mismatch === "yes");
  const noMismatch = results.filter((r) => r.mismatch === "no");
  const sourceGap = results.filter((r) => r.normes_source === "source-gap");

  const summary = {
    snapshot: SNAPSHOT,
    read_only: true,
    total_served_munis: servedSlugs.length,
    deposited_norms_products: normsSlugs.size,
    munis_scanned: results.length,
    munis_sig_read_error: readErrors.length,
    munis_assessable_mismatch: assessable.length,
    munis_with_mismatch: withMismatch.length,
    munis_no_mismatch: noMismatch.length,
    munis_normes_source_gap: sourceGap.length,
    canon_used: CANON_USED,
    normes_source: NORMS_SOURCE_DESC,
    mismatch_rule:
      "∃ canon SIG code with NO matching canon normes code (plain canonical set membership; no numeric-vintage bridge)",
  };

  const cited = Object.fromEntries(
    CITED.map((slug) => {
      const r = results.find((x) => x.slug === slug);
      return [slug, r ?? { slug, served: false }];
    }),
  );

  const payload = {
    generated_at: new Date().toISOString(),
    summary,
    cited_cases: cited,
    munis: results.sort((a, b) => a.slug.localeCompare(b.slug)),
  };

  const outDir = resolve(REPO, "work", "coverage");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "zones-code-mismatch-broadcity-20260830.json");
  const mdPath = resolve(outDir, "zones-code-mismatch-broadcity-20260830.md");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(mdPath, renderMarkdown(results, summary));

  console.error(`[scan] wrote ${jsonPath}`);
  console.error(`[scan] wrote ${mdPath}`);
  console.error(
    `[scan] SUMMARY served=${servedSlugs.length} scanned=${results.length} ` +
      `sig-read-err=${readErrors.length} mismatch=${withMismatch.length} ` +
      `no-mismatch=${noMismatch.length} source-gap=${sourceGap.length}`,
  );
  for (const slug of CITED) {
    const r = results.find((x) => x.slug === slug);
    if (!r) {
      console.error(`[scan] CITED ${slug}: NOT served`);
      continue;
    }
    console.error(
      `[scan] CITED ${slug}: normes=${r.normes_source} mismatch=${r.mismatch} ` +
        `n_sig=${r.n_sig_codes} n_normes=${r.n_normes_codes ?? "—"} n_mismatched=${r.n_mismatched ?? "—"} ` +
        `sample=${JSON.stringify(r.mismatched_sig_codes.slice(0, 10))}`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
