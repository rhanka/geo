/**
 * _zones-geometry-grain-stamp-20260810.ts — estampille ADDITIVE du grain de
 * géométrie `geometry_grain="zone-polygon"` sur 4 collections zones SERVIES dont
 * la géométrie est une couche de POLYGONES DE ZONAGE NATIFS (pas une matrice
 * graphique d'unités d'évaluation).
 *
 * SPEC: SPEC_ZONE_GEOMETRY_GRAIN.md §2 (SHA 7c7f6731). Vocabulaire fermé
 * {@link GEOMETRY_GRAINS} = zone-polygon | evaluation-unit | dissolved-zone.
 * Cette passe n'estampille QUE `zone-polygon` (les 4 cibles sont des couches de
 * polygones de zonage natives, prouvées v2 documented) — jamais `dissolved-zone`
 * (réservé, hors contrat) ni `evaluation-unit`.
 *
 * ADDITIF PUR — la géométrie servie reste octet-pour-octet inchangée. L'écriture
 * passe par {@link putServedZoneAdditive} avec `allowedProps=[GEOMETRY_GRAIN_FIELD]` :
 * la lib PROUVE que chaque géométrie est byte-identique au servi et REFUSE toute
 * autre altération (proof, zone_code, zone_source_url/level tous inchangés). En
 * plus du garde de la lib, ce runner recalcule un digest SHA-256 des géométries
 * AVANT/APRÈS et échoue si l'un diffère.
 *
 * CLASSIFICATION (autorité = NATURE de la couche source) : une couche est
 * `evaluation-unit` si ses features portent un identifiant parcelle/UEV
 * (ID_UEV / MATRICULE8 / CODE_UTILI) ; sinon, couche de polygones de zonage natifs
 * ⇒ `zone-polygon`. Le ratio features/zone_code n'est qu'un signal corroborant.
 * Ce runner INSPECTE les champs et ABORTE un slug si un marqueur UEV est présent
 * (anti-invention : on n'estampille pas zone-polygon sur une matrice graphique).
 *
 * Usage (depuis acquisition/, réseau S3 → ipv4first) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/_zones-geometry-grain-stamp-20260810.ts --dry-run
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/_zones-geometry-grain-stamp-20260810.ts \
 *       --out ../work/coverage/zones-geometry-grain-stamp-20260810.json
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import {
  GEOMETRY_GRAIN_FIELD,
  type GeometryGrain,
  putServedZoneAdditive,
} from "./lib/zonage-proof.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const GRAIN_VALUE: GeometryGrain = "zone-polygon";
/** Marqueurs d'une couche d'unités d'évaluation (matrice graphique). Leur
 *  présence bascule la classification vers evaluation-unit ⇒ on n'estampille PAS. */
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;
const SLUGS = ["longueuil", "salaberry-de-valleyfield", "westmount", "lassomption"] as const;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

interface Feature { geometry?: unknown; properties?: Record<string, unknown> | null }
interface ServedFC {
  type?: unknown;
  features?: Feature[];
  proof?: { geometry_source?: { url?: unknown } } | null;
}

/** Both possible served layouts for a slug (flat + mirrored sous-dossier). */
function candidateKeys(slug: string): Array<{ layout: "flat" | "nested"; key: string }> {
  return [
    { layout: "flat", key: `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson` },
    { layout: "nested", key: `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` },
  ];
}

/** Digest SHA-256 des géométries dans l'ordre — preuve indépendante du byte-exact. */
function geometryDigest(features: Feature[]): `sha256:${string}` {
  const h = createHash("sha256");
  for (const f of features) h.update(JSON.stringify(f.geometry ?? null));
  return `sha256:${h.digest("hex")}`;
}

/** Union triée des clés de propriétés sur toutes les features. */
function propertyKeyUnion(features: Feature[]): string[] {
  const keys = new Set<string>();
  for (const f of features) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  return [...keys].sort();
}

/** Marqueurs UEV présents (comparaison insensible à la casse, égalité exacte). */
function uevFieldsPresent(keys: string[]): string[] {
  const upper = new Map(keys.map((k) => [k.toUpperCase(), k]));
  return UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
}

function distinctZoneCodes(features: Feature[]): number {
  const codes = new Set<string>();
  for (const f of features) {
    const c = f.properties?.["zone_code"];
    if (typeof c === "string" && c.length > 0) codes.add(c);
  }
  return codes.size;
}

interface LayoutResult {
  slug: string;
  layout: "flat" | "nested";
  key: string;
  present: boolean;
  features: number;
  geometry_sha256_before: string | null;
  geometry_sha256_after: string | null;
  geometry_bytes_equal: boolean | null;
  geometry_grain: string | null;
  classification: string;
  uev_fields_present: string[];
  source_layer_url: string | null;
  distinct_zone_codes: number;
  features_per_zone_ratio: number | null;
  property_keys: string[];
  readback_ok: boolean | null;
  status: string;
  note?: string;
}

async function stampLayout(
  s3: S3Client,
  slug: string,
  layout: "flat" | "nested",
  key: string,
  dryRun: boolean,
): Promise<LayoutResult> {
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as ServedFC;
  const feats = Array.isArray(fc.features) ? fc.features : [];
  const keys = propertyKeyUnion(feats);
  const uev = uevFieldsPresent(keys);
  const before = geometryDigest(feats);
  const srcUrl = typeof fc.proof?.geometry_source?.url === "string" ? fc.proof.geometry_source.url : null;
  const distinct = distinctZoneCodes(feats);
  const ratio = distinct > 0 ? Number((feats.length / distinct).toFixed(3)) : null;

  const base: LayoutResult = {
    slug, layout, key, present: true, features: feats.length,
    geometry_sha256_before: before, geometry_sha256_after: null, geometry_bytes_equal: null,
    geometry_grain: null,
    classification: uev.length > 0 ? "evaluation-unit" : "zone-polygon",
    uev_fields_present: uev, source_layer_url: srcUrl,
    distinct_zone_codes: distinct, features_per_zone_ratio: ratio,
    property_keys: keys, readback_ok: null, status: "",
  };

  // Autorité = nature de la couche : un marqueur UEV interdit zone-polygon.
  if (uev.length > 0) {
    return { ...base, status: "ABORT_UEV", note: `marqueur(s) UEV présent(s): ${uev.join(", ")} → couche evaluation-unit, PAS estampillée zone-polygon` };
  }
  if (feats.length === 0) {
    return { ...base, status: "ABORT_EMPTY", note: "FeatureCollection vide" };
  }

  if (dryRun) {
    return { ...base, status: "DRY_RUN" };
  }

  // Estampille additive : ajoute UNIQUEMENT geometry_grain sur chaque feature.
  const next: ServedFC = JSON.parse(JSON.stringify(fc)) as ServedFC;
  for (const f of next.features ?? []) {
    f.properties = { ...(f.properties ?? {}), [GEOMETRY_GRAIN_FIELD]: GRAIN_VALUE };
  }
  await putServedZoneAdditive(
    s3,
    key,
    next as { type: "FeatureCollection"; features: Feature[] },
    { allowedProps: [GEOMETRY_GRAIN_FIELD] },
  );

  // Readback indépendant.
  const after = JSON.parse((await getBytes(s3, key)).toString("utf8")) as ServedFC;
  const afterFeats = Array.isArray(after.features) ? after.features : [];
  const afterDigest = geometryDigest(afterFeats);
  const grainValues = new Set(afterFeats.map((f) => f.properties?.[GEOMETRY_GRAIN_FIELD]));
  const grainOk = grainValues.size === 1 && grainValues.has(GRAIN_VALUE);
  const equal = afterDigest === before;

  return {
    ...base,
    geometry_sha256_after: afterDigest,
    geometry_bytes_equal: equal,
    geometry_grain: grainOk ? GRAIN_VALUE : `MIXED(${[...grainValues].join(",")})`,
    readback_ok: equal && grainOk,
    status: equal && grainOk ? "STAMPED" : "FAIL_READBACK",
    ...(equal ? {} : { note: `DIGEST GÉOMÉTRIE CHANGÉ before=${before} after=${afterDigest} — ABORT` }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const out = arg(argv, "out");
  const slugsArg = arg(argv, "slugs");
  const slugs = slugsArg ? slugsArg.split(",").map((s) => s.trim()).filter(Boolean) : [...SLUGS];

  const s3 = s3Client();
  const results: LayoutResult[] = [];

  for (const slug of slugs) {
    let anyLayout = false;
    for (const { layout, key } of candidateKeys(slug)) {
      if (!(await exists(s3, key))) continue;
      anyLayout = true;
      const r = await stampLayout(s3, slug, layout, key, dryRun);
      results.push(r);
      console.log(
        `${r.status.padEnd(14)} ${slug}/${layout} feat=${r.features} class=${r.classification} ` +
        `uev=[${r.uev_fields_present.join(",")}] ratio=${r.features_per_zone_ratio} ` +
        `grain=${r.geometry_grain ?? "-"} geomEqual=${r.geometry_bytes_equal ?? "-"} key=${key}`,
      );
    }
    if (!anyLayout) {
      results.push({
        slug, layout: "flat", key: `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`, present: false,
        features: 0, geometry_sha256_before: null, geometry_sha256_after: null, geometry_bytes_equal: null,
        geometry_grain: null, classification: "unknown", uev_fields_present: [], source_layer_url: null,
        distinct_zone_codes: 0, features_per_zone_ratio: null, property_keys: [], readback_ok: null,
        status: "NOT_SERVED", note: "aucun layout (flat/nested) servi",
      });
      console.log(`NOT_SERVED     ${slug} (aucun layout servi)`);
    }
  }

  const record = {
    contract: "zones-geometry-grain-stamp/v1",
    date: "2026-08-10",
    mode: dryRun ? "dry-run" : "apply",
    spec: "SPEC_ZONE_GEOMETRY_GRAIN.md §2 (SHA 7c7f6731)",
    grain_value: GRAIN_VALUE,
    additive_path: "putServedZoneAdditive(allowedProps=[geometry_grain]) — géométrie byte-exact prouvée par la lib",
    lib_change: "acquisition/src/lib/zonage-proof.ts: ajout de \"geometry_grain\" à PROVENANCE_PROP_WHITELIST ; ajout du type GeometryGrain + set GEOMETRY_GRAINS + const GEOMETRY_GRAIN_FIELD (enum fermé 3 valeurs).",
    classification_authority: "nature de la couche source (marqueur UEV ID_UEV/MATRICULE8/CODE_UTILI ⇒ evaluation-unit ; sinon polygones de zonage natifs ⇒ zone-polygon). Ratio features/zone_code = corroborant seulement.",
    uev_marker_fields_checked: [...UEV_MARKER_FIELDS],
    results,
  };

  if (out) {
    writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`, "utf8");
    console.log(`RECORD written → ${out}`);
  }

  const bad = results.filter((r) => r.present && !["STAMPED", "DRY_RUN"].includes(r.status));
  console.log(`DONE ${dryRun ? "(dry-run) " : ""}layouts=${results.filter((r) => r.present).length} stamped=${results.filter((r) => r.status === "STAMPED").length} problems=${bad.length}`);
  if (bad.length > 0) process.exitCode = 1;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
