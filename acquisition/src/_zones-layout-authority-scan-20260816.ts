/**
 * _zones-layout-authority-scan-20260816.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * QUANTIFIE un bug systémique d'AUTORITÉ-LAYOUT du geo-api : quand un slug
 * possède À LA FOIS un objet PLAT (normalized/ca-qc-zonage/qc-zonage-<slug>.geojson)
 * ET un objet NICHÉ (normalized/ca-qc-zonage/qc-zonage-<slug>/qc-zonage-<slug>.geojson),
 * le geo-api sert le NICHÉ. Sur beaupre + boischatel (triage col-2 2c741540) le
 * niché est une couche d'affectation MRC MAL-DÉPOSÉE (zone_code vide) alors que
 * le vrai zonage municipal est dans le PLAT → geo-api sert la mauvaise couche,
 * les lots tombent hors-zone. On mesure l'ampleur.
 *
 * MÉTHODE (lecture seule S3 ; ne DÉPOSE / N'ÉCRIT RIEN sur S3) :
 *   1. LISTE toutes les clés sous normalized/ca-qc-zonage/ ; dérive l'ensemble
 *      des slugs PLAT et l'ensemble des slugs NICHÉS. Totaux flat-only / nested-only / BOTH.
 *   2. CANDIDATS = slugs BOTH (le bug exige les deux). DEEP-READ uniquement ceux-là.
 *      Pour chaque layout : feature_count, distinct zone_code non vide, fraction
 *      null/empty, échantillon de codes, champs d'affectation détectés.
 *   3. CLASSIFIE : MISDEPOSIT-SUSPECT / INVERSE-SUSPECT / CONSISTENT / OTHER,
 *      annotation AFFECTATION-SIGNATURE (corroborant). Numéros MESURÉS, anti-invention.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-layout-authority-scan-20260816.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-layout-authority-scan-20260816.json
 *   work/coverage/zones-layout-authority-scan-20260816.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getGeoJsonFeatureCollection, listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT_JSON = "work/coverage/zones-layout-authority-scan-20260816.json";
const OUT_MD = "work/coverage/zones-layout-authority-scan-20260816.md";

// Seuils de classification (déclarés, appliqués sur mesures brutes).
const HIGH_NULL = 0.5; // fraction null/empty zone_code qui rend une couche "vide-code"
const MANY_CODES = 3; // nb de zone_code distincts qui rend une couche "vrai zonage"

/** Vocabulaire d'affectation MRC (schéma d'aménagement) — PAS des codes de zone municipaux. */
const AFFECTATION_VOCAB = new Set([
  "AGRICOLE", "AGRICOLEDYNAMIQUE", "AGRICOLEVIABLE", "AGROFORESTIER", "URBAIN", "URBAINE",
  "PERIURBAIN", "PERIURBAINE", "RECREATION", "RECREATIF", "RECREATIVE", "RECREOTOURISTIQUE",
  "CONSERVATION", "RURAL", "RURALE", "FORESTIER", "FORESTIERE", "FORESTIERE", "VILLEGIATURE",
  "INDUSTRIEL", "INDUSTRIELLE", "COMMERCIAL", "COMMERCIALE", "MULTIFONCTIONNELLE", "RESIDENTIEL",
  "RESIDENTIELLE", "PUBLIQUE", "INSTITUTIONNELLE", "AGROTOURISTIQUE", "PRIORITAIRE", "DEFERE",
]);

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

/** Un code ressemble-t-il à un code de zone municipal (préfixe lettre + chiffres, p.ex. H-1, C-203, 10-F) ? */
function looksMunicipalCode(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return /\d/.test(s) && /[A-Za-z]/.test(s) && s.length <= 12; // lettre + chiffre, court
}

interface Feat { properties?: Record<string, unknown> | null }

interface LayerStat {
  key: string;
  feature_count: number;
  distinct_zone_code: number;
  empty_zone_code_features: number;
  null_frac: number; // empty / feature_count (0 si vide)
  sample_zone_codes: string[];
  municipal_code_fraction: number; // parmi codes non vides
  affectation_fields: Array<{ field: string; matched_values: string[]; distinct_values: number }>;
  read_error?: string;
}

async function readLayer(
  s3: ReturnType<typeof s3Client>,
  key: string,
): Promise<LayerStat> {
  const base: LayerStat = {
    key, feature_count: 0, distinct_zone_code: 0, empty_zone_code_features: 0, null_frac: 0,
    sample_zone_codes: [], municipal_code_fraction: 0, affectation_fields: [],
  };
  try {
    const fc = await getGeoJsonFeatureCollection<Feat>(s3, key);
    const feats = fc.features ?? [];
    const codes = new Set<string>();
    const sample: string[] = [];
    let empty = 0;
    let municipalHits = 0;
    let nonEmpty = 0;
    // Champ -> ensemble de valeurs canon (plafonné) pour détecter le vocabulaire d'affectation.
    const fieldValues = new Map<string, Set<string>>();
    for (const f of feats) {
      const p = f.properties ?? {};
      const zc = p["zone_code"];
      const c = canon(zc);
      if (c) {
        codes.add(c);
        nonEmpty++;
        if (looksMunicipalCode(String(zc))) municipalHits++;
        if (sample.length < 20) sample.push(String(zc));
      } else {
        empty++;
      }
      // Collecte de valeurs par champ (plafonnée) — hors zone_source_* et geometry_grain qui sont de la provenance.
      for (const [kk, vv] of Object.entries(p)) {
        if (kk === "zone_code" || kk.startsWith("zone_source") || kk === "geometry_grain") continue;
        if (typeof vv !== "string") continue;
        const cv = canon(vv);
        if (!cv) continue;
        let set = fieldValues.get(kk);
        if (!set) { set = new Set<string>(); fieldValues.set(kk, set); }
        if (set.size < 40) set.add(cv);
      }
    }
    const affectation_fields: LayerStat["affectation_fields"] = [];
    for (const [field, set] of fieldValues) {
      const matched = [...set].filter((v) => AFFECTATION_VOCAB.has(v));
      // Signature : plusieurs valeurs collent au vocabulaire d'affectation ET le champ a peu de valeurs distinctes.
      if (matched.length >= 2 && set.size <= 25) {
        affectation_fields.push({ field, matched_values: matched.slice(0, 12), distinct_values: set.size });
      }
    }
    return {
      key,
      feature_count: feats.length,
      distinct_zone_code: codes.size,
      empty_zone_code_features: empty,
      null_frac: feats.length ? Math.round((empty / feats.length) * 1000) / 1000 : 0,
      sample_zone_codes: sample,
      municipal_code_fraction: nonEmpty ? Math.round((municipalHits / nonEmpty) * 1000) / 1000 : 0,
      affectation_fields,
    };
  } catch (e) {
    return { ...base, read_error: (e as Error).message };
  }
}

type Verdict = "MISDEPOSIT-SUSPECT" | "INVERSE-SUSPECT" | "CONSISTENT" | "OTHER" | "READ-ERROR";

function classify(flat: LayerStat, nested: LayerStat): { verdict: Verdict; affectation: boolean; note: string } {
  if (flat.read_error || nested.read_error) {
    return { verdict: "READ-ERROR", affectation: false, note: `flat_err=${flat.read_error ?? ""} nested_err=${nested.read_error ?? ""}` };
  }
  const nestedEmptyish = nested.null_frac >= HIGH_NULL || nested.distinct_zone_code === 0;
  const nestedReal = nested.distinct_zone_code >= MANY_CODES && nested.null_frac < HIGH_NULL;
  const flatEmptyish = flat.null_frac >= HIGH_NULL || flat.distinct_zone_code === 0;
  const flatReal = flat.distinct_zone_code >= MANY_CODES && flat.null_frac < HIGH_NULL;
  const affectation = nested.affectation_fields.length > 0;

  // geo-api sert le NICHÉ : le cas nuisible est NICHÉ vide-code alors que PLAT est du vrai zonage.
  if (nestedEmptyish && flatReal) {
    return {
      verdict: "MISDEPOSIT-SUSPECT",
      affectation,
      note: `nested vide-code (null_frac=${nested.null_frac}, distinct=${nested.distinct_zone_code}) alors que flat=vrai zonage (distinct=${flat.distinct_zone_code}, null_frac=${flat.null_frac})` +
        (affectation ? `; signature affectation dans nested: ${nested.affectation_fields.map((a) => a.field).join(",")}` : ""),
    };
  }
  // Inverse : le plat est vide et le niché est le vrai zonage (geo-api sert alors le bon).
  if (flatEmptyish && nestedReal) {
    return {
      verdict: "INVERSE-SUSPECT",
      affectation,
      note: `flat vide-code (null_frac=${flat.null_frac}, distinct=${flat.distinct_zone_code}) alors que nested=vrai zonage (distinct=${nested.distinct_zone_code}, null_frac=${nested.null_frac})`,
    };
  }
  if (flatReal && nestedReal) {
    return { verdict: "CONSISTENT", affectation, note: `les deux layouts portent du vrai zonage (flat distinct=${flat.distinct_zone_code}, nested distinct=${nested.distinct_zone_code})` };
  }
  return {
    verdict: "OTHER",
    affectation,
    note: `ambigu — flat{distinct=${flat.distinct_zone_code}, null_frac=${flat.null_frac}, feat=${flat.feature_count}} nested{distinct=${nested.distinct_zone_code}, null_frac=${nested.null_frac}, feat=${nested.feature_count}}`,
  };
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();

  // ── 1. ÉNUMÉRATION ──
  const entries = await listObjectEntries(s3, S3_PREFIX);
  const flatSlugs = new Set<string>();
  const nestedSlugs = new Set<string>();
  const flatKeyBySlug = new Map<string, string>();
  const nestedKeyBySlug = new Map<string, string>();
  const flatRe = /^qc-zonage-([a-z0-9-]+)\.geojson$/;
  const nestedRe = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.geojson$/;
  for (const { key } of entries) {
    if (!key.startsWith(S3_PREFIX)) continue;
    const rest = key.slice(S3_PREFIX.length);
    const mFlat = flatRe.exec(rest);
    if (mFlat) { flatSlugs.add(mFlat[1]!); flatKeyBySlug.set(mFlat[1]!, key); continue; }
    const mNested = nestedRe.exec(rest);
    if (mNested && mNested[1] === mNested[2]) { nestedSlugs.add(mNested[1]!); nestedKeyBySlug.set(mNested[1]!, key); }
  }

  const both = [...flatSlugs].filter((s) => nestedSlugs.has(s)).sort();
  const flatOnly = [...flatSlugs].filter((s) => !nestedSlugs.has(s)).sort();
  const nestedOnly = [...nestedSlugs].filter((s) => !flatSlugs.has(s)).sort();

  process.stdout.write(
    `[enum] total_keys=${entries.length} flat_slugs=${flatSlugs.size} nested_slugs=${nestedSlugs.size} ` +
    `flat_only=${flatOnly.length} nested_only=${nestedOnly.length} BOTH=${both.length}\n`,
  );

  // ── 2 + 3. DEEP-READ + CLASSIFY (candidats = BOTH uniquement) ──
  const candidates: Array<Record<string, unknown>> = [];
  const misdeposit: string[] = [];
  const inverse: string[] = [];
  const readErrors: Array<{ slug: string; error: string }> = [];
  let done = 0;
  for (const slug of both) {
    const flatKey = flatKeyBySlug.get(slug)!;
    const nestedKey = nestedKeyBySlug.get(slug)!;
    const [flat, nested] = await Promise.all([readLayer(s3, flatKey), readLayer(s3, nestedKey)]);
    const { verdict, affectation, note } = classify(flat, nested);
    if (verdict === "MISDEPOSIT-SUSPECT") misdeposit.push(slug);
    if (verdict === "INVERSE-SUSPECT") inverse.push(slug);
    if (flat.read_error) readErrors.push({ slug, error: `flat: ${flat.read_error}` });
    if (nested.read_error) readErrors.push({ slug, error: `nested: ${nested.read_error}` });
    candidates.push({ slug, verdict, affectation_signature: affectation, note, flat, nested });
    done++;
    process.stdout.write(`[deep ${done}/${both.length}] ${slug} → ${verdict}${affectation ? " +AFFECTATION" : ""}\n`);
  }

  const report = {
    contract: "zones-layout-authority-scan/diagnostic",
    generated_at_utc: new Date().toISOString(),
    method: {
      description: "geo-api serves NESTED when both flat and nested objects exist; MISDEPOSIT = nested vide-code (null_frac>=0.5 ou distinct=0) alors que flat=vrai zonage (distinct>=3, null_frac<0.5).",
      HIGH_NULL, MANY_CODES,
      s3_prefix: S3_PREFIX,
      read_only: true,
    },
    totals: {
      total_keys_listed: entries.length,
      flat_slugs: flatSlugs.size,
      nested_slugs: nestedSlugs.size,
      flat_only: flatOnly.length,
      nested_only: nestedOnly.length,
      both: both.length,
    },
    flat_only_slugs: flatOnly,
    nested_only_slugs: nestedOnly,
    both_slugs: both,
    misdeposit_suspect: { count: misdeposit.length, slugs: misdeposit },
    inverse_suspect: { count: inverse.length, slugs: inverse },
    read_errors: readErrors,
    candidates,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

  // ── Companion .md ──
  const hits = candidates.filter((c) => c.verdict === "MISDEPOSIT-SUSPECT");
  const rows = hits.map((c) => {
    const f = c.flat as LayerStat;
    const n = c.nested as LayerStat;
    return `| ${c.slug} | ${f.feature_count} | ${f.distinct_zone_code} | ${n.feature_count} | ${n.null_frac} | ${n.distinct_zone_code} | ${c.affectation_signature ? "oui" : "non"} |`;
  });
  const inverseRows = candidates.filter((c) => c.verdict === "INVERSE-SUSPECT").map((c) => {
    const f = c.flat as LayerStat;
    const n = c.nested as LayerStat;
    return `| ${c.slug} | ${f.feature_count} | ${f.distinct_zone_code} | ${f.null_frac} | ${n.feature_count} | ${n.distinct_zone_code} |`;
  });
  const md = `# Scan autorité-layout servi (zones) — ${new Date().toISOString().slice(0, 10)}

**Bug quantifié.** Le geo-api sert le layout NICHÉ quand un slug possède À LA FOIS un
objet plat (\`qc-zonage-<slug>.geojson\`) et un objet niché
(\`qc-zonage-<slug>/qc-zonage-<slug>.geojson\`). Quand le niché est une couche
d'affectation MRC mal-déposée (zone_code vide) alors que le vrai zonage municipal
est dans le plat, geo-api sert la mauvaise couche → lots hors-zone.

## Totaux (énumération S3, lecture seule)

- clés listées sous \`${S3_PREFIX}\` : **${entries.length}**
- slugs PLAT : **${flatSlugs.size}**
- slugs NICHÉS : **${nestedSlugs.size}**
- **flat-only : ${flatOnly.length}**
- **nested-only : ${nestedOnly.length}**
- **BOTH (candidats deep-read) : ${both.length}**

## Résultat headline

**${misdeposit.length} municipalité(s) MISDEPOSIT-SUSPECT** (niché vide-code servi à la place du vrai zonage plat).
${inverse.length} INVERSE-SUSPECT (plat vide / niché vrai zonage — geo-api sert alors le bon).

## MISDEPOSIT-SUSPECT — geo-api sert un niché vide-code

| slug | flat_feat | flat_codes | nested_feat | nested_null_frac | nested_codes | affectation |
|------|-----------|-----------|-------------|------------------|--------------|-------------|
${rows.join("\n") || "| (aucun) | | | | | | |"}

${inverseRows.length ? `## INVERSE-SUSPECT — plat vide / niché vrai zonage

| slug | flat_feat | flat_codes | flat_null_frac | nested_feat | nested_codes |
|------|-----------|-----------|----------------|-------------|--------------|
${inverseRows.join("\n")}
` : ""}
## Méthode (lecture seule, anti-invention)

1. \`listObjectEntries\` sur \`${S3_PREFIX}\` → ensembles slugs plat / niché ; totaux.
2. Deep-read (\`getGeoJsonFeatureCollection\`) UNIQUEMENT des slugs BOTH (borne le coût).
3. Par layout : feature_count, distinct zone_code non vide, fraction null/empty,
   échantillon, champs d'affectation détectés (vocabulaire MRC).
4. MISDEPOSIT-SUSPECT ⟺ niché{null_frac≥${HIGH_NULL} ou distinct=0} ET plat{distinct≥${MANY_CODES}, null_frac<${HIGH_NULL}}.
   INVERSE-SUSPECT = symétrique. Numéros MESURÉS ; un slug illisible est noté, jamais deviné.

${readErrors.length ? `## Erreurs de lecture\n\n${readErrors.map((e) => `- ${e.slug}: ${e.error}`).join("\n")}\n` : "## Erreurs de lecture\n\naucune.\n"}
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(`\n[done] MISDEPOSIT-SUSPECT=${misdeposit.length} INVERSE-SUSPECT=${inverse.length} read_errors=${readErrors.length}\n`);
  process.stdout.write(`[done] misdeposit slugs: ${misdeposit.join(", ") || "(none)"}\n`);
  process.stdout.write(`[done] wrote ${OUT_JSON} + ${OUT_MD}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
