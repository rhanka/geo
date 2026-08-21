/**
 * _zones-bareslug-preprod-reprobe-20260821.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * RE-PROBE des 220 slugs bare-slug contre le bucket PREPROD `sentropic-geo-preprod`.
 *
 * POURQUOI. La sonde antérieure (commit f2459f44) a joint les 220 munis contre le
 * bucket PROD `sentropic-geo` et les a trouvés servis NULLE PART. Mais c'était le
 * MAUVAIS bucket : le cutover immo-preprod lit la geo-api PREPROD, qui pointe sur
 * `GEO_DATA_URI = s3://sentropic-geo-preprod/normalized`
 * (deploy/k8s/overlays/preprod/patch-serving.yaml). Le `preprod-served-ids.txt`
 * source du diff i-arch est le LISTING OGC PREPROD. Les 220 sont donc probablement
 * servis NU dans `sentropic-geo-preprod`, pas `sentropic-geo`.
 *
 * COMMENT (ciblage bucket). La lib s3 résout le bucket PAR DÉFAUT depuis
 * `acquisition/config/s3-target.json` (= `sentropic-geo` prod) et son GARDE porte sur
 * l'ENDPOINT (s3.ts:127), pas sur le bucket. Les lectures (`getBytes`, `getJson`,
 * `getGeoJsonFeatureCollection`, `exists`, `listObjectEntries`) acceptent un
 * paramètre `bucket` optionnel. Le bucket PREPROD est sur le MÊME endpoint OVH →
 * le garde d'endpoint passe. On passe donc `bucket = "sentropic-geo-preprod"`.
 *
 * STRICTEMENT LECTURE SEULE : HEAD + GET + LIST uniquement. Aucune écriture, aucun
 * dépôt, aucun cluster.
 *
 * SI LES CREDS N'ONT PAS ACCÈS à `sentropic-geo-preprod` (AccessDenied /
 * NoSuchBucket / auth) : on imprime l'ERREUR EXACTE et on sort en code 1 SANS
 * fabriquer de résultat par-slug. Anti-invention.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-bareslug-preprod-reprobe-20260821.ts
 *
 * ÉCRIT (local) : work/coverage/zones-bareslug-preprod-reprobe-20260821.{json,md}
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  exists,
  getGeoJsonFeatureCollection,
  listObjectEntries,
  s3Client,
} from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

const PREPROD_BUCKET = "sentropic-geo-preprod";
const SUBDIR_PREFIX = "normalized/ca-qc-zonage/";
const WORKLIST = "work/coverage/zones-bareslug-alias-worklist-20260821.json";
const OUT_JSON = "work/coverage/zones-bareslug-preprod-reprobe-20260821.json";
const OUT_MD = "work/coverage/zones-bareslug-preprod-reprobe-20260821.md";
const SAMPLE_MAX = 8;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function isAccessOrBucketError(error: unknown): boolean {
  const detail = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = String(detail?.name ?? detail?.Code ?? "");
  const status = detail?.$metadata?.httpStatusCode;
  return (
    /AccessDenied|NoSuchBucket|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|AllAccessDisabled|Unauthorized/i.test(name) ||
    status === 403 ||
    status === 404 ||
    status === 401
  );
}

async function mapLimit<T, U>(items: readonly T[], limit: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

interface WorklistFile {
  count_asserted?: number;
  slugs: string[];
}

interface SlugRow {
  slug: string;
  found: Record<string, boolean>;
  served_somewhere: boolean;
  bare_served: boolean;
  canon_served: boolean;
  bare_key: string | null;
}

interface SampleRow {
  slug: string;
  key: string;
  ok: boolean;
  feature_count: number | null;
  has_zone_code: boolean | null;
  first_feature_property_keys: string[] | null;
  sample_zone_codes: string[] | null;
  error: string | null;
}

const LAYOUT_KEY = (slug: string): Record<string, string> => ({
  root_bare_flat: `normalized/${slug}.geojson`,
  root_bare_nested: `normalized/${slug}/${slug}.geojson`,
  subdir_bare_flat: `normalized/ca-qc-zonage/${slug}.geojson`,
  subdir_bare_nested: `normalized/ca-qc-zonage/${slug}/${slug}.geojson`,
  root_canon_flat: `normalized/qc-zonage-${slug}.geojson`,
  root_canon_nested: `normalized/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  subdir_canon_flat: `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`,
  subdir_canon_nested: `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
});
const BARE_LAYOUTS = ["root_bare_flat", "root_bare_nested", "subdir_bare_flat", "subdir_bare_nested"] as const;
const CANON_LAYOUTS = ["root_canon_flat", "root_canon_nested", "subdir_canon_flat", "subdir_canon_nested"] as const;
const ALL_LAYOUTS = [...BARE_LAYOUTS, ...CANON_LAYOUTS] as const;

async function readZonageSample(s3: S3Client, slug: string, key: string): Promise<SampleRow> {
  try {
    const fc = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> }>(s3, key, PREPROD_BUCKET);
    const features = fc.features ?? [];
    const first = features[0]?.properties ?? {};
    const firstKeys = Object.keys(first);
    const hasZoneCode = firstKeys.includes("zone_code");
    const codes: string[] = [];
    for (const f of features) {
      const v = f?.properties?.["zone_code"];
      if (typeof v === "string" && v.length > 0 && !codes.includes(v)) codes.push(v);
      if (codes.length >= 3) break;
    }
    return {
      slug,
      key,
      ok: true,
      feature_count: features.length,
      has_zone_code: hasZoneCode,
      first_feature_property_keys: firstKeys,
      sample_zone_codes: codes,
      error: null,
    };
  } catch (error) {
    return {
      slug,
      key,
      ok: false,
      feature_count: null,
      has_zone_code: null,
      first_feature_property_keys: null,
      sample_zone_codes: null,
      error: (error as Error).message ?? String(error),
    };
  }
}

function classifyPrefix(keys: string[]): {
  canon_flat: Set<string>;
  canon_nested: Set<string>;
  bare_flat: Set<string>;
  bare_nested: Set<string>;
  other: string[];
} {
  const canon_flat = new Set<string>();
  const canon_nested = new Set<string>();
  const bare_flat = new Set<string>();
  const bare_nested = new Set<string>();
  const other: string[] = [];
  const flatRe = /^([a-z0-9-]+)\.geojson$/;
  const nestedRe = /^([a-z0-9-]+)\/([a-z0-9-]+)\.geojson$/;
  for (const k of keys) {
    if (!k.endsWith(".geojson")) continue;
    const rest = k.slice(SUBDIR_PREFIX.length);
    const mf = flatRe.exec(rest);
    if (mf) {
      const s = mf[1]!;
      if (s.startsWith("qc-zonage-")) canon_flat.add(s.slice("qc-zonage-".length));
      else bare_flat.add(s);
      continue;
    }
    const mn = nestedRe.exec(rest);
    if (mn && mn[1] === mn[2]) {
      const s = mn[1]!;
      if (s.startsWith("qc-zonage-")) canon_nested.add(s.slice("qc-zonage-".length));
      else bare_nested.add(s);
      continue;
    }
    other.push(rest);
  }
  return { canon_flat, canon_nested, bare_flat, bare_nested, other };
}

function renderMd(summary: Record<string, unknown>, rows: SlugRow[], samples: SampleRow[]): string {
  const t = summary["target_220"] as Record<string, number>;
  const pt = summary["preprod_subdir_totals"] as Record<string, number>;
  const layoutDist = summary["layout_distribution_220"] as Record<string, number>;
  const L: string[] = [];
  L.push(`# Bare-slug 220 — re-probe PREPROD \`${PREPROD_BUCKET}\` (lecture seule)`);
  L.push("");
  L.push(`- Généré : ${summary["generated_at_utc"]}`);
  L.push(`- Endpoint (garde) : ${summary["endpoint"]} — bucket ciblé : \`${PREPROD_BUCKET}\` (override du défaut prod \`sentropic-geo\`)`);
  L.push(`- Worklist : \`${WORKLIST}\` (${summary["slug_count"]} slugs)`);
  L.push(`- Preuve accès preprod : ${summary["preprod_access_ok"] ? "OK" : "ÉCHEC"}`);
  L.push("");
  L.push(`## Verdict`);
  L.push("");
  L.push(`${summary["verdict"]}`);
  L.push("");
  L.push(`## Des 220 : où sont-ils servis dans ${PREPROD_BUCKET} ?`);
  L.push("");
  L.push(`| statut | n |`);
  L.push(`|---|---|`);
  L.push(`| bare-served (any bare layout) | ${t["bare_served"]} |`);
  L.push(`| canon-served (any canon layout) | ${t["canon_served"]} |`);
  L.push(`| servi quelque part | ${t["served_somewhere"]} |`);
  L.push(`| absent partout | ${t["absent_everywhere"]} |`);
  L.push("");
  L.push(`### Distribution par layout (sur les 220, HEAD)`);
  L.push("");
  L.push(`| layout | n |`);
  L.push(`|---|---|`);
  for (const k of ALL_LAYOUTS) L.push(`| ${k} | ${layoutDist[k] ?? 0} |`);
  L.push("");
  L.push(`## Totaux PREPROD sous \`${SUBDIR_PREFIX}\` (comparer au prod 808 canon_flat)`);
  L.push("");
  L.push(`| famille | n |`);
  L.push(`|---|---|`);
  L.push(`| canon_flat (qc-zonage-<slug>.geojson) | ${pt["canon_flat"]} |`);
  L.push(`| canon_nested | ${pt["canon_nested"]} |`);
  L.push(`| bare_flat (<slug>.geojson) | ${pt["bare_flat"]} |`);
  L.push(`| bare_nested | ${pt["bare_nested"]} |`);
  L.push(`| other geojson | ${pt["other"]} |`);
  L.push(`| keys listés (prefix) | ${pt["keys_listed"]} |`);
  L.push("");
  L.push(`## Échantillon nature-zonage (${samples.length} slugs bare-served, dont beloeil)`);
  L.push("");
  L.push(`| slug | key | features | zone_code ? | sample zone_code | props (1re feature) |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const s of samples) {
    const props = s.first_feature_property_keys ? s.first_feature_property_keys.join(", ") : (s.error ?? "");
    const codes = s.sample_zone_codes ? s.sample_zone_codes.join(", ") : "";
    L.push(
      `| ${s.slug} | \`${s.key}\` | ${s.feature_count ?? "—"} | ${s.has_zone_code === null ? "ERR" : s.has_zone_code} | ${codes} | ${props} |`,
    );
  }
  L.push("");
  L.push(`## Par-slug (220)`);
  L.push("");
  L.push(`| slug | bare | canon | served | bare_key |`);
  L.push(`|---|---|---|---|---|`);
  for (const r of rows) {
    L.push(`| ${r.slug} | ${r.bare_served} | ${r.canon_served} | ${r.served_somewhere} | ${r.bare_key ? `\`${r.bare_key}\`` : ""} |`);
  }
  L.push("");
  return L.join("\n");
}

async function main(): Promise<void> {
  requireS3();
  const s3: S3Client = s3Client();
  const worklist = JSON.parse(readFileSync(WORKLIST, "utf8")) as WorklistFile;
  const slugs = worklist.slugs.slice();
  if (!Array.isArray(slugs) || slugs.length === 0) throw new Error(`worklist vide: ${WORKLIST}`);

  // ── Preuve d'accès + totaux : LIST du préfixe ca-qc-zonage sur PREPROD.
  //    C'est aussi le contrôle d'accès : un AccessDenied/NoSuchBucket lève ICI.
  let entries;
  try {
    entries = await listObjectEntries(s3, SUBDIR_PREFIX, PREPROD_BUCKET);
  } catch (error) {
    const e = error as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const isAccess = isAccessOrBucketError(error);
    // Capitalisation de la PREUVE d'échec (principe fondateur : rien uniquement en
    // local). On dépose un enregistrement d'accès-refusé — SANS aucun résultat
    // par-slug fabriqué — pour que l'audit trouve la trace à l'emplacement attendu.
    const denial = {
      contract: "zones-bareslug-preprod-reprobe/diagnostic",
      generated_at_utc: new Date().toISOString(),
      read_only: true,
      endpoint: "https://s3.bhs.io.cloud.ovh.net",
      default_bucket_overridden_from: "sentropic-geo",
      target_bucket: PREPROD_BUCKET,
      preprod_access_ok: false,
      access_error: {
        name: e.name ?? e.Code ?? null,
        http_status: e.$metadata?.httpStatusCode ?? null,
        message: e.message ?? String(error),
        classified_as_access_or_bucket_error: isAccess,
      },
      worklist: WORKLIST,
      slug_count: slugs.length,
      subdir_prefix: SUBDIR_PREFIX,
      verdict: isAccess
        ? `STOP — creds SANS accès à ${PREPROD_BUCKET} (${e.name ?? e.Code ?? "?"} ${e.$metadata?.httpStatusCode ?? ""}). ` +
          `Escalade geo-archi (accès preprod/cluster). Aucun résultat par-slug fabriqué ou inféré.`
        : `STOP — erreur non-accès sur ${PREPROD_BUCKET}: ${e.message ?? String(error)}.`,
      rows: [] as SlugRow[],
      sample: [] as SampleRow[],
      note: "Le join par-slug/nature-zonage/totaux n'a PAS été exécuté : la LIST du préfixe a échoué avant tout HEAD/GET.",
    };
    mkdirSync("work/coverage", { recursive: true });
    writeFileSync(OUT_JSON, `${JSON.stringify(denial, null, 1)}\n`);
    const md: string[] = [];
    md.push(`# Bare-slug 220 — re-probe PREPROD \`${PREPROD_BUCKET}\` (lecture seule) — ACCÈS REFUSÉ`);
    md.push("");
    md.push(`- Généré : ${denial.generated_at_utc}`);
    md.push(`- Endpoint (garde) : ${denial.endpoint} — bucket ciblé : \`${PREPROD_BUCKET}\` (override du défaut prod \`sentropic-geo\`, même endpoint OVH → garde d'endpoint passe)`);
    md.push(`- Worklist : \`${WORKLIST}\` (${slugs.length} slugs)`);
    md.push(`- **Preuve accès preprod : ÉCHEC**`);
    md.push("");
    md.push(`## Erreur exacte`);
    md.push("");
    md.push(`| champ | valeur |`);
    md.push(`|---|---|`);
    md.push(`| name | ${denial.access_error.name ?? "?"} |`);
    md.push(`| http_status | ${denial.access_error.http_status ?? "?"} |`);
    md.push(`| message | ${denial.access_error.message} |`);
    md.push(`| classé accès/bucket | ${denial.access_error.classified_as_access_or_bucket_error} |`);
    md.push("");
    md.push(`## Verdict`);
    md.push("");
    md.push(denial.verdict);
    md.push("");
    md.push(`> ${denial.note}`);
    md.push("");
    writeFileSync(OUT_MD, md.join("\n"));
    process.stderr.write(
      `\n[reprobe] ACCÈS PREPROD ÉCHEC — bucket=${PREPROD_BUCKET}\n` +
        `  name=${e.name ?? e.Code ?? "?"} httpStatus=${e.$metadata?.httpStatusCode ?? "?"}\n` +
        `  message=${e.message ?? String(error)}\n` +
        (isAccess
          ? `  → creds SANS accès preprod (ou bucket absent). STOP, escalade geo-archi. Aucun résultat fabriqué.\n`
          : `  → erreur non-accès. STOP.\n`) +
        `  → preuve capitalisée: ${OUT_JSON} + ${OUT_MD}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const keys = entries.map((e) => e.key);
  const cls = classifyPrefix(keys);
  const preprodSubdirTotals = {
    keys_listed: keys.length,
    canon_flat: cls.canon_flat.size,
    canon_nested: cls.canon_nested.size,
    bare_flat: cls.bare_flat.size,
    bare_nested: cls.bare_nested.size,
    other: cls.other.length,
  };

  // ── Par-slug : HEAD des 8 layouts (racine + subdir × bare/canon × flat/nested).
  const rows: SlugRow[] = await mapLimit(slugs, 8, async (slug) => {
    const L = LAYOUT_KEY(slug);
    const found: Record<string, boolean> = {};
    for (const n of ALL_LAYOUTS) found[n] = await exists(s3, L[n]!, PREPROD_BUCKET);
    const bareHit = BARE_LAYOUTS.find((n) => found[n]);
    const bare_served = BARE_LAYOUTS.some((n) => found[n]);
    const canon_served = CANON_LAYOUTS.some((n) => found[n]);
    const served_somewhere = ALL_LAYOUTS.some((n) => found[n]);
    return {
      slug,
      found,
      served_somewhere,
      bare_served,
      canon_served,
      bare_key: bareHit ? L[bareHit]! : null,
    };
  });

  const layoutDistribution: Record<string, number> = {};
  for (const n of ALL_LAYOUTS) layoutDistribution[n] = rows.filter((r) => r.found[n]).length;

  const target220 = {
    served_somewhere: rows.filter((r) => r.served_somewhere).length,
    bare_served: rows.filter((r) => r.bare_served).length,
    canon_served: rows.filter((r) => r.canon_served).length,
    absent_everywhere: rows.filter((r) => !r.served_somewhere).length,
  };

  // ── Échantillon nature-zonage : ~8 slugs bare-served, beloeil en tête si présent.
  const bareServed = rows.filter((r) => r.bare_served && r.bare_key);
  const ordered = [
    ...bareServed.filter((r) => r.slug === "beloeil"),
    ...bareServed.filter((r) => r.slug !== "beloeil"),
  ];
  const sampleTargets = ordered.slice(0, SAMPLE_MAX);
  const samples: SampleRow[] = [];
  for (const r of sampleTargets) samples.push(await readZonageSample(s3, r.slug, r.bare_key!));

  const verdict =
    target220.bare_served === slugs.length
      ? `(A) LES ${slugs.length} bare-served en real-zonage dans ${PREPROD_BUCKET} → id-form, aliasables sur preprod.`
      : target220.bare_served > 0
        ? `(mixte) ${target220.bare_served}/${slugs.length} bare-served, ${target220.canon_served} canon-served, ${target220.absent_everywhere} absents. Voir rows.`
        : `(B) 0/${slugs.length} bare-served dans ${PREPROD_BUCKET} — non présents ici non plus → investigation plus profonde.`;

  const summary = {
    contract: "zones-bareslug-preprod-reprobe/diagnostic",
    generated_at_utc: new Date().toISOString(),
    read_only: true,
    endpoint: "https://s3.bhs.io.cloud.ovh.net",
    default_bucket_overridden_from: "sentropic-geo",
    target_bucket: PREPROD_BUCKET,
    preprod_access_ok: true,
    worklist: WORKLIST,
    slug_count: slugs.length,
    subdir_prefix: SUBDIR_PREFIX,
    preprod_subdir_totals: preprodSubdirTotals,
    prod_reference_808: "prod sentropic-geo (f2459f44): 808 canon_flat + 72 canon_nested, 0/220 servi",
    target_220: target220,
    layout_distribution_220: layoutDistribution,
    verdict,
    sample: samples,
    rows,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 1)}\n`);
  writeFileSync(OUT_MD, renderMd(summary, rows, samples));

  process.stdout.write(
    `[reprobe] bucket=${PREPROD_BUCKET} access=OK keys_listed=${preprodSubdirTotals.keys_listed}\n` +
      `[reprobe] preprod subdir totals: canon_flat=${preprodSubdirTotals.canon_flat} canon_nested=${preprodSubdirTotals.canon_nested} ` +
      `bare_flat=${preprodSubdirTotals.bare_flat} bare_nested=${preprodSubdirTotals.bare_nested} other=${preprodSubdirTotals.other}\n` +
      `[reprobe] 220: served_somewhere=${target220.served_somewhere} bare_served=${target220.bare_served} ` +
      `canon_served=${target220.canon_served} absent=${target220.absent_everywhere}\n` +
      `[reprobe] layout dist: ${ALL_LAYOUTS.map((n) => `${n}=${layoutDistribution[n]}`).join(" ")}\n` +
      `[reprobe] sample(${samples.length}): ${samples
        .map((s) => `${s.slug}[f=${s.feature_count ?? "ERR"},zc=${s.has_zone_code}]`)
        .join(" ")}\n` +
      `[reprobe] VERDICT: ${verdict}\n` +
      `[reprobe] wrote ${OUT_JSON} + ${OUT_MD}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
