/**
 * _zones-normalizezonecode-validate-20260830.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * QUESTION (i-infra, avant merge `@radar/domain`). i-infra propose une fonction
 * d'IDENTITÉ canonique de code de zone :
 *
 *   normalizeZoneCode(raw) = String(raw ?? "")
 *     .toUpperCase()
 *     then unicode dash [en-dash / em-dash] -> ASCII hyphen "-"
 *     then remove a parenthesized sector suffix "(SECT)" [2..8 alnum, with
 *          surrounding whitespace]
 *     then remove all whitespace
 *   (exact source lives in the normalizeZoneCode() implementation below).
 *
 * EXIGENCE : cette IDENTITÉ doit être INJECTIVE sur les codes servis PAR-MUNI —
 * deux codes bruts DISTINCTS ne doivent JAMAIS produire la même sortie, sinon
 * c'est une FUSION À TORT de deux zones distinctes.
 *
 * ⚠ On évalue la fusion à tort UNIQUEMENT sur `normalizeZoneCode` (l'identité).
 * La couche de RECHERCHE d'i-infra `zoneSearchKey(raw) =
 * normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,"")` est VOLONTAIREMENT many-to-one
 * (rappel H101≡H-101, désambiguïsé par candidats bruts dans l'UI) — son sur-match
 * n'est PAS une fusion à tort. On NE calcule NI ne signale les collisions
 * zoneSearchKey. Seule `normalizeZoneCode` doit être injective.
 *
 * Contraste avec la sonde précédente (_zones-zonecode-norm-collision-20260825.ts) :
 * l'ancienne `norm(c)=c.toUpperCase().replace(/[^A-Z0-9]/g,"")` supprimait TOUS
 * les non-alphanumériques (donc `H-103-1`≡`H-1031` — fusion à tort). La nouvelle
 * `normalizeZoneCode` PRÉSERVE les séparateurs `-`,`.`,`/`,`*` et la POSITION du
 * tiret ; elle se contente d'uniformiser les tirets unicode, de retirer un suffixe
 * de secteur parenthésé `(XXX)`, et de supprimer les espaces + passer en majuscule.
 * Elle DEVRAIT donc garder distincts les 15 couples HARMFUL historiques ; le
 * RISQUE NOUVEAU introduit par ses règles est :
 *   (a) retrait du suffixe parenthésé  : `X (SECT1)` et `X (SECT2)` (ou `X` et
 *       `X (SECT)`) → tous deux `X` = FUSION À TORT de secteurs distincts ;
 *   (b) suppression des espaces        : `A 1` vs `A1` ;
 *   (c) uniformisation tiret unicode   : `A–1` (en/em dash) vs `A-1`.
 * La casse et les espaces sont repliés PAR CONSTRUCTION (même comportement que
 * l'ancienne norm sur ces deux axes) : un couple ne différant que par casse/espace
 * reste donc fusionné — canonicalisation du MÊME code, pas fusion de zones
 * distinctes. Le seul repli qui SUPPRIME un distinguateur de secteur réel est le
 * retrait parenthésé (a) → classé HARMFUL. On rapporte TOUTES les collisions avec
 * leur CAUSE (paren/whitespace/dash/case), i-infra tranche.
 *
 * MÉTHODE (lecture seule S3 ; ne DÉPOSE / N'ÉCRIT RIEN sur S3) :
 *   1. LISTE normalized/ca-qc-zonage/ ; dérive slugs PLAT + NICHÉ (réutilise
 *      listObjectEntries). Couche SERVIE = NICHÉE si présente sinon PLATE
 *      (autorité geo-api — identique à la sonde précédente ; 873 slugs servis).
 *   2. Par muni servie : bruts `zone_code` DISTINCTS (trim, non vide, ≠ UNKNOWN,
 *      sortie normalisée non vide) → `normalizeZoneCode`. Collision par-muni =
 *      une sortie provenant de ≥2 bruts distincts = fusion à tort candidate.
 *   3. Classe la CAUSE de chaque collision par NÉCESSITÉ : une règle R est une
 *      cause ssi la retirer du pipeline re-sépare le groupe (≥2 sorties). Cause
 *      ∈ {paren, whitespace, dash, case}. kind=HARMFUL ssi `paren` ∈ causes
 *      (retrait d'un suffixe de secteur distinct) ; sinon BENIGN (canonicalisation
 *      du même code).
 *   4. RÉGRESSION : confirme que les 15 couples HARMFUL historiques (record
 *      8d3d8b9b) restent DISTINCTS sous normalizeZoneCode (attendu : oui,
 *      séparateurs préservés). Vérification pure-fonction + croisement données.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-normalizezonecode-validate-20260830.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-normalizezonecode-validate-20260830.json
 *   work/coverage/zones-normalizezonecode-validate-20260830.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getGeoJsonFeatureCollection, listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT_JSON = "work/coverage/zones-normalizezonecode-validate-20260830.json";
const OUT_MD = "work/coverage/zones-normalizezonecode-validate-20260830.md";
const CONCURRENCY = 10;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

/**
 * LA fonction d'identité EXACTE d'i-infra. NE PAS DÉVIER (ordre des étapes verbatim).
 */
function normalizeZoneCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-") // unicode dash → ASCII hyphen
    .replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "") // parenthesized sector suffix (e.g. " (AGF)")
    .replace(/\s+/g, ""); // whitespace
}

// ── Variantes de pipeline pour l'analyse de CAUSE (une règle retirée à la fois) ──
/** Sans le retrait du suffixe parenthésé. */
function normNoParen(r: string): string {
  return r.toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, "");
}
/** Sans la suppression des espaces. */
function normNoWhitespace(r: string): string {
  return r.toUpperCase().replace(/[–—]/g, "-").replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "");
}
/** Sans l'uniformisation des tirets unicode. */
function normNoDash(r: string): string {
  return r.toUpperCase().replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "").replace(/\s+/g, "");
}
/** Sans le passage en majuscule (regex casse-insensible pour tester la nécessité de la casse). */
function normNoCase(r: string): string {
  return r.replace(/[–—]/g, "-").replace(/\s*\([A-Za-z0-9]{2,8}\)\s*/g, "").replace(/\s+/g, "");
}

type Cause = "paren" | "whitespace" | "dash" | "case";

/** Ensemble des règles NÉCESSAIRES à la collision (retirer R re-sépare le groupe). */
function collisionCauses(raws: string[]): Cause[] {
  const causes: Cause[] = [];
  if (new Set(raws.map(normNoParen)).size >= 2) causes.push("paren");
  if (new Set(raws.map(normNoWhitespace)).size >= 2) causes.push("whitespace");
  if (new Set(raws.map(normNoDash)).size >= 2) causes.push("dash");
  if (new Set(raws.map(normNoCase)).size >= 2) causes.push("case");
  if (causes.length === 0) causes.push("case"); // repli: distinction consommée par la seule majuscule
  return causes;
}

/** Un code brut est-il "servi/recherchable" (non nul, non vide, ≠ UNKNOWN) ? */
function isRealCode(rawTrim: string): boolean {
  if (!rawTrim) return false;
  if (rawTrim.toUpperCase() === "UNKNOWN") return false;
  return true;
}

interface Feat { properties?: Record<string, unknown> | null }

interface MuniCollision {
  output: string; // sortie normalizeZoneCode partagée
  raw_codes: string[]; // les bruts distincts (trim) qui fusionnent
  causes: Cause[];
  kind: "HARMFUL" | "BENIGN"; // HARMFUL ssi paren ∈ causes (retrait de secteur distinct)
}

interface LayerResult {
  key: string;
  feature_count: number;
  distinct_raw_codes: number;
  distinct_raw_list: string[]; // bruts trim distincts réels
  norm_emptied_codes: string[]; // bruts non vides dont normalizeZoneCode() donne "" (contexte)
  by_output: Array<[string, string[]]>; // sortie -> bruts (pour la régression + collisions)
  collisions: MuniCollision[];
  read_error?: string;
}

async function readLayer(
  s3: ReturnType<typeof s3Client>,
  key: string,
): Promise<LayerResult> {
  const base: LayerResult = {
    key, feature_count: 0, distinct_raw_codes: 0, distinct_raw_list: [], norm_emptied_codes: [], by_output: [], collisions: [],
  };
  try {
    const fc = await getGeoJsonFeatureCollection<Feat>(s3, key);
    const feats = fc.features ?? [];
    const distinctRaw = new Set<string>(); // bruts trim distincts, réels
    const normEmptied = new Set<string>();
    for (const f of feats) {
      const p = f.properties ?? {};
      const raw = p["zone_code"];
      if (raw === null || raw === undefined) continue;
      const rawTrim = String(raw).trim();
      if (!isRealCode(rawTrim)) continue;
      if (normalizeZoneCode(rawTrim) === "") { normEmptied.add(rawTrim); continue; }
      distinctRaw.add(rawTrim);
    }
    // Map sortie -> bruts distincts.
    const byOutput = new Map<string, Set<string>>();
    for (const rawTrim of distinctRaw) {
      const out = normalizeZoneCode(rawTrim);
      let set = byOutput.get(out);
      if (!set) { set = new Set<string>(); byOutput.set(out, set); }
      set.add(rawTrim);
    }
    const collisions: MuniCollision[] = [];
    const byOutputSerialized: Array<[string, string[]]> = [];
    for (const [out, set] of byOutput) {
      const raws = [...set].sort();
      byOutputSerialized.push([out, raws]);
      if (set.size >= 2) {
        const causes = collisionCauses(raws);
        collisions.push({ output: out, raw_codes: raws, causes, kind: causes.includes("paren") ? "HARMFUL" : "BENIGN" });
      }
    }
    collisions.sort((a, b) => a.output.localeCompare(b.output));
    return {
      key,
      feature_count: feats.length,
      distinct_raw_codes: distinctRaw.size,
      distinct_raw_list: [...distinctRaw],
      norm_emptied_codes: [...normEmptied].sort(),
      by_output: byOutputSerialized,
      collisions,
    };
  } catch (e) {
    return { ...base, read_error: (e as Error).message };
  }
}

/** Pool de concurrence borné. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── Les 15 couples HARMFUL historiques (record 8d3d8b9b) — pour la régression. ──
// (slug, rawA, rawB) tels qu'énoncés ; formes ASCII/unicode verbatim de la demande.
const HISTORIC_15: Array<{ slug: string; a: string; b: string }> = [
  { slug: "drummondville", a: "H-103-1", b: "H-1031" },
  { slug: "lanoraie", a: "C1-8", b: "C18" },
  { slug: "franklin", a: "HA-1-2", b: "HA-12" },
  { slug: "hinchinbrooke", a: "Af-1-1", b: "Af-11" },
  { slug: "mont-saint-hilaire", a: "C-1-1", b: "C-11" },
  { slug: "saint-ambroise-de-kildare", a: "A1-1", b: "A11" },
  { slug: "sainte-clotilde", a: "Ra1-1", b: "Ra11" },
  { slug: "saint-joseph-de-beauce", a: "H-1.3", b: "H-13" },
  { slug: "saint-narcisse-de-beaurivage", a: "3.1-H", b: "31-H" },
  { slug: "amqui", a: "5.1 R", b: "51 R" },
  { slug: "ascot-corner", a: "P-1", b: "P1" },
  { slug: "cote-saint-luc", a: "RU*-65", b: "RU-65" },
  { slug: "saint-aime-du-lac-des-iles", a: "A-01", b: "A-Î01" },
  { slug: "saint-donat--la-mitis", a: "01 (AGF)", b: "01 AGF)" },
  { slug: "saint-joseph-de-lepage", a: "01 (AGF)", b: "01 AGF)" },
];

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();

  // ── 1. ÉNUMÉRATION (identique à la sonde précédente : niché-gagne) ──
  const entries = await listObjectEntries(s3, S3_PREFIX);
  const flatKeyBySlug = new Map<string, string>();
  const nestedKeyBySlug = new Map<string, string>();
  const flatRe = /^qc-zonage-([a-z0-9-]+)\.geojson$/;
  const nestedRe = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.geojson$/;
  for (const { key } of entries) {
    if (!key.startsWith(S3_PREFIX)) continue;
    const rest = key.slice(S3_PREFIX.length);
    const mFlat = flatRe.exec(rest);
    if (mFlat) { flatKeyBySlug.set(mFlat[1]!, key); continue; }
    const mNested = nestedRe.exec(rest);
    if (mNested && mNested[1] === mNested[2]) nestedKeyBySlug.set(mNested[1]!, key);
  }

  const allSlugs = new Set<string>([...flatKeyBySlug.keys(), ...nestedKeyBySlug.keys()]);
  const bothSlugs = [...allSlugs].filter((s) => flatKeyBySlug.has(s) && nestedKeyBySlug.has(s)).sort();
  const flatOnly = [...allSlugs].filter((s) => flatKeyBySlug.has(s) && !nestedKeyBySlug.has(s)).sort();
  const nestedOnly = [...allSlugs].filter((s) => nestedKeyBySlug.has(s) && !flatKeyBySlug.has(s)).sort();

  const servedSlugs = [...allSlugs].sort();
  const servedKeyBySlug = new Map<string, { key: string; layout: "nested" | "flat" }>();
  for (const slug of servedSlugs) {
    if (nestedKeyBySlug.has(slug)) servedKeyBySlug.set(slug, { key: nestedKeyBySlug.get(slug)!, layout: "nested" });
    else servedKeyBySlug.set(slug, { key: flatKeyBySlug.get(slug)!, layout: "flat" });
  }

  process.stdout.write(
    `[enum] total_keys=${entries.length} served_slugs=${servedSlugs.length} ` +
    `flat_only=${flatOnly.length} nested_only=${nestedOnly.length} both=${bothSlugs.length}\n`,
  );

  // ── 2. DEEP-READ couche servie (TOUTES les munis servies) ──
  let done = 0;
  const servedResults = await pool(servedSlugs, CONCURRENCY, async (slug) => {
    const { key, layout } = servedKeyBySlug.get(slug)!;
    const res = await readLayer(s3, key);
    done++;
    if (done % 50 === 0 || done === servedSlugs.length) {
      process.stdout.write(`[served ${done}/${servedSlugs.length}]\n`);
    }
    return { slug, layout, res };
  });

  // ── Agrégation SERVIE (autoritative) ──
  const perMuniCollisions: Array<{ slug: string; layout: string; collisions: MuniCollision[] }> = [];
  const readErrors: Array<{ slug: string; layer: string; error: string }> = [];
  const byOutputBySlug = new Map<string, Map<string, string[]>>();
  let muniChecked = 0;

  for (const { slug, layout, res } of servedResults) {
    if (res.read_error) { readErrors.push({ slug, layer: `served(${layout})`, error: res.read_error }); continue; }
    muniChecked++;
    const m = new Map<string, string[]>();
    for (const [out, raws] of res.by_output) m.set(out, raws);
    byOutputBySlug.set(slug, m);
    if (res.collisions.length > 0) perMuniCollisions.push({ slug, layout, collisions: res.collisions });
  }

  // Compteurs par nature de collision.
  const allCollisionGroups = perMuniCollisions.flatMap((m) => m.collisions.map((c) => ({ slug: m.slug, layout: m.layout, ...c })));
  const harmfulGroups = allCollisionGroups.filter((c) => c.kind === "HARMFUL");
  const benignGroups = allCollisionGroups.filter((c) => c.kind === "BENIGN");
  const parenGroups = allCollisionGroups.filter((c) => c.causes.includes("paren"));
  const whitespaceGroups = allCollisionGroups.filter((c) => c.causes.includes("whitespace"));
  const dashGroups = allCollisionGroups.filter((c) => c.causes.includes("dash"));
  const caseGroups = allCollisionGroups.filter((c) => c.causes.includes("case"));

  // ── 4. RÉGRESSION : les 15 couples historiques restent-ils distincts ? ──
  const regression = HISTORIC_15.map(({ slug, a, b }) => {
    const outA = normalizeZoneCode(a);
    const outB = normalizeZoneCode(b);
    const distinctByFunction = outA !== outB;
    // Croisement données : ce slug servi présente-t-il une collision fusionnant a & b ?
    const muni = byOutputBySlug.get(slug);
    let dataPresenceA = false;
    let dataPresenceB = false;
    let mergedInData = false;
    if (muni) {
      for (const raws of muni.values()) {
        if (raws.includes(a)) dataPresenceA = true;
        if (raws.includes(b)) dataPresenceB = true;
      }
      // Fusion réelle a&b ssi tous deux tombent dans le MÊME groupe de sortie.
      const groupA = muni.get(outA);
      mergedInData = !!groupA && groupA.includes(a) && groupA.includes(b);
    }
    return {
      slug, raw_a: a, raw_b: b, out_a: outA, out_b: outB,
      distinct_by_function: distinctByFunction,
      slug_served: !!muni,
      raw_a_present_in_data: dataPresenceA,
      raw_b_present_in_data: dataPresenceB,
      merged_in_data: mergedInData,
    };
  });
  const regressionAllDistinct = regression.every((r) => r.distinct_by_function && !r.merged_in_data);

  // ── VERDICT (définition littérale de la demande) ──
  const totalCollisionGroups = allCollisionGroups.length;
  const muniWithCollision = perMuniCollisions.length;
  const verdict = totalCollisionGroups === 0
    ? "INJECTIVE — 0 false merge, normalizeZoneCode SAFE as identity"
    : `${totalCollisionGroups} residual collisions (${harmfulGroups.length} HARMFUL paren-suffix distinct-sector merge, ${benignGroups.length} BENIGN same-code case/whitespace/dash refold) across ${muniWithCollision} muni(s)`;

  const report = {
    contract: "zones-normalizezonecode-validate/diagnostic",
    generated_at_utc: new Date().toISOString(),
    question: "i-infra normalizeZoneCode identity — is it INJECTIVE on served zone_codes per muni (no false merge of distinct zones)?",
    method: {
      s3_prefix: S3_PREFIX,
      target: "prod sentropic-geo (OVH BHS)",
      served_layer_rule: "nested wins when both flat and nested exist (geo-api authority)",
      normalizeZoneCode: 'String(raw ?? "").toUpperCase().replace(/[–—]/g,"-").replace(/\\s*\\([A-Z0-9]{2,8}\\)\\s*/g,"").replace(/\\s+/g,"")',
      searchKey_note: "zoneSearchKey = normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,'') is intentionally many-to-one and NOT evaluated here — only the normalizeZoneCode identity must be injective",
      skip: "null/empty/UNKNOWN raw zone_code; codes whose normalizeZoneCode output is empty reported separately (norm_emptied)",
      per_muni_collision: ">=2 distinct trimmed raw codes mapping to the same normalizeZoneCode output within one muni = false merge",
      cause_classification: "a rule R is a cause iff removing R from the pipeline re-splits the group (>=2 outputs). kind=HARMFUL iff paren in causes (paren-suffix removal deletes a distinct sector suffix); else BENIGN (case/whitespace/dash refold of the same code).",
      read_only: true,
    },
    coverage: {
      total_keys_listed: entries.length,
      served_slugs_total: servedSlugs.length,
      munis_checked: muniChecked,
      flat_only: flatOnly.length,
      nested_only: nestedOnly.length,
      both: bothSlugs.length,
      read_errors: readErrors.length,
    },
    verdict,
    injective: totalCollisionGroups === 0,
    normalizezonecode_collisions: {
      total_collision_groups: totalCollisionGroups,
      muni_with_any_collision: muniWithCollision,
      harmful_paren_distinct_sector: harmfulGroups.length,
      benign_same_code_refold: benignGroups.length,
      by_cause: {
        paren: parenGroups.length,
        whitespace: whitespaceGroups.length,
        dash: dashGroups.length,
        case: caseGroups.length,
      },
      list: perMuniCollisions,
    },
    new_collisions_from_extra_rules: {
      note: "collisions caused by the rules NOT present in the old strip-all-non-alnum norm: paren-suffix removal (a), whitespace removal (b), unicode-dash unification (c). Whitespace/dash/case fold the SAME code (benign by design); paren removal deletes a distinct sector suffix (harmful).",
      paren_suffix_removal: parenGroups.map((c) => ({ slug: c.slug, output: c.output, raw_codes: c.raw_codes })),
      whitespace_removal: whitespaceGroups.map((c) => ({ slug: c.slug, output: c.output, raw_codes: c.raw_codes })),
      unicode_dash: dashGroups.map((c) => ({ slug: c.slug, output: c.output, raw_codes: c.raw_codes })),
    },
    regression_15_harmful: {
      note: "the 15 historically-harmful pairs (record 8d3d8b9b) must stay DISTINCT under normalizeZoneCode (separators preserved).",
      all_stay_distinct: regressionAllDistinct,
      list: regression,
    },
    read_errors: readErrors,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

  // ── Companion .md ──
  const collisionRows = allCollisionGroups
    .slice()
    .sort((a, b) => (a.kind === b.kind ? a.slug.localeCompare(b.slug) : a.kind === "HARMFUL" ? -1 : 1))
    .map((c) =>
      `| ${c.slug} | ${c.layout} | ${c.kind} | ${c.causes.join("+")} | \`${c.output}\` | ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")} |`,
    );
  const regressionRows = regression.map((r) =>
    `| ${r.slug} | \`${r.raw_a}\` → \`${r.out_a}\` | \`${r.raw_b}\` → \`${r.out_b}\` | ${r.distinct_by_function ? "DISTINCT ✓" : "MERGED ✗"} | ${r.merged_in_data ? "merged-in-data ✗" : (r.slug_served ? "not-merged-in-data ✓" : "slug-not-served")} |`,
  );

  const md = `# Validation de normalizeZoneCode (identité i-infra) — ${new Date().toISOString().slice(0, 10)}

**Question (i-infra, avant merge \`@radar/domain\`).** La fonction d'IDENTITÉ
\`normalizeZoneCode\` est-elle **INJECTIVE** sur les codes de zone servis PAR-MUNI —
c.-à-d. deux codes bruts DISTINCTS ne produisent-ils jamais la même sortie (une
telle collision = **fusion à tort** de deux zones distinctes) ?

\`\`\`js
normalizeZoneCode(raw) = String(raw ?? "")
  .toUpperCase()
  .replace(/[–—]/g, "-")                     // unicode dash → ASCII hyphen
  .replace(/\\s*\\([A-Z0-9]{2,8}\\)\\s*/g, "")   // parenthesized sector suffix
  .replace(/\\s+/g, "");                        // whitespace
\`\`\`

> ⚠ Évalué UNIQUEMENT sur \`normalizeZoneCode\` (l'identité). La couche de
> recherche \`zoneSearchKey(raw) = normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,"")\`
> est VOLONTAIREMENT many-to-one — son sur-match n'est PAS une fusion à tort et
> n'est ni calculé ni signalé ici.

## Verdict

**${verdict}**

- injective (0 collision, toute cause) : **${totalCollisionGroups === 0 ? "OUI" : "NON"}**
- fusion à tort de secteurs DISTINCTS (retrait parenthésé) : **${harmfulGroups.length}**
- repli du MÊME code (casse/espace/tiret — canonicalisation par construction) : **${benignGroups.length}**

## Couverture (lecture seule S3 prod \`sentropic-geo\`, anti-invention)

- clés listées sous \`${S3_PREFIX}\` : **${entries.length}**
- slugs servis (total) : **${servedSlugs.length}**
- **munis vérifiées : ${muniChecked} / ${servedSlugs.length}**
- flat-only : ${flatOnly.length} · nested-only : ${nestedOnly.length} · both : ${bothSlugs.length}
- erreurs de lecture : ${readErrors.length}

## Collisions PAR-MUNI sous \`normalizeZoneCode\`

- groupes de collision (≥2 bruts distincts → même sortie) : **${totalCollisionGroups}**
- munis avec ≥1 collision : **${muniWithCollision}**
- par cause : paren=${parenGroups.length} · whitespace=${whitespaceGroups.length} · dash=${dashGroups.length} · case=${caseGroups.length}

${collisionRows.length ? `| slug | couche | nature | cause | sortie | bruts distincts fusionnés |
|------|--------|--------|-------|--------|---------------------------|
${collisionRows.join("\n")}` : "_aucune collision — normalizeZoneCode injective sur les codes servis._"}

## Nouvelles collisions introduites par les règles supplémentaires (watch clé)

Règles absentes de l'ancienne \`strip-[^A-Z0-9]\` :

- **(a) retrait suffixe parenthésé** \`X (SECT)\` → \`X\` (HARMFUL — supprime un
  distinguateur de secteur réel) : **${parenGroups.length}**
${parenGroups.length ? parenGroups.map((c) => `  - \`${c.slug}\` → \`${c.output}\` ⟵ ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")}`).join("\n") : "  - aucune"}
- **(b) suppression des espaces** \`A 1\` vs \`A1\` (BENIGN — même code) : **${whitespaceGroups.length}**
${whitespaceGroups.length ? whitespaceGroups.map((c) => `  - \`${c.slug}\` → \`${c.output}\` ⟵ ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")}`).join("\n") : "  - aucune"}
- **(c) tiret unicode → ASCII** \`A–1\` vs \`A-1\` (BENIGN — même code) : **${dashGroups.length}**
${dashGroups.length ? dashGroups.map((c) => `  - \`${c.slug}\` → \`${c.output}\` ⟵ ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")}`).join("\n") : "  - aucune"}

## Régression — les 15 couples HARMFUL historiques restent-ils distincts ?

Attendu : **oui** (normalizeZoneCode préserve les séparateurs et leur position).

**Tous distincts : ${regressionAllDistinct ? "OUI ✓" : "NON ✗"}**

| slug | brut A → sortie | brut B → sortie | fonction | données |
|------|-----------------|-----------------|----------|---------|
${regressionRows.join("\n")}

## Méthode

1. \`listObjectEntries\` sur \`${S3_PREFIX}\` → slugs plat/niché ; couche servie = niché si présent sinon plat (autorité geo-api ; 873 servis).
2. Par muni servie : bruts \`zone_code\` distincts (trim, non vide, ≠ UNKNOWN, sortie non vide) → \`normalizeZoneCode\` ; collision = une sortie provenant de ≥2 bruts distincts.
3. Cause par NÉCESSITÉ : règle R = cause ssi la retirer re-sépare le groupe. kind=HARMFUL ssi \`paren\` ∈ causes (retrait de secteur distinct) ; sinon BENIGN (repli du même code).
4. Régression : 15 couples historiques (record 8d3d8b9b) — pure-fonction \`normalizeZoneCode(A) ≠ normalizeZoneCode(B)\` + croisement données servies (non fusionnés dans la muni). Numéros MESURÉS ; muni illisible notée, jamais devinée.

${readErrors.length ? `## Erreurs de lecture\n\n${readErrors.map((e) => `- ${e.slug} [${e.layer}]: ${e.error}`).join("\n")}\n` : "## Erreurs de lecture\n\naucune.\n"}
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(
    `\n[done] verdict: ${verdict}\n` +
    `[done] munis_checked=${muniChecked}/${servedSlugs.length} ` +
    `collision_groups=${totalCollisionGroups} harmful_paren=${harmfulGroups.length} benign=${benignGroups.length} ` +
    `(paren=${parenGroups.length} whitespace=${whitespaceGroups.length} dash=${dashGroups.length} case=${caseGroups.length}) ` +
    `read_errors=${readErrors.length}\n` +
    `[done] regression_15_all_distinct=${regressionAllDistinct}\n` +
    `[done] wrote ${OUT_JSON} + ${OUT_MD}\n`,
  );
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
