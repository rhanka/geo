/**
 * _zones-prod-served-and-220-backlog-20260821.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * DEUX livrables pour le cutover immo (route-B zonage gaps). NE DÉPOSE / N'ÉCRIT
 * RIEN sur S3, NE TOUCHE PAS le cluster. Écrit uniquement des fichiers LOCAUX du
 * dépôt sous work/coverage/.
 *
 * LIVRABLE 1 — liste qc-zonage SERVIE par le geo-api PROD (pour le diff régression
 * d'i-arch : {prod-reachable zonage} ∖ {preprod-reachable}).
 *   PRIMAIRE  : GET PROD OGC https://api.geo.sent-tech.ca/collections?f=json ;
 *               extrait tout `id` de collection commençant par `qc-zonage-`.
 *               C'est ce que le geo-api PROD SERT réellement (autoritatif).
 *   CROSS-CHECK: énumère le bucket PROD `sentropic-geo` sous
 *               `normalized/ca-qc-zonage/` (plat + niché, lecture seule) ; signale
 *               tout écart OGC-vs-bucket (effets d'index gelé). L'ensemble OGC est
 *               celui dont i-arch a besoin. Si l'OGC échoue (réseau/DNS) → repli
 *               sur l'énumération bucket, CLAIREMENT étiqueté "bucket-derived".
 *   ÉCRIT     : work/coverage/zones-prod-qczonage-served-list-20260821.json
 *
 * LIVRABLE 2 — classe les 220 munis route-B (zonage gap) en exactement une classe :
 *   ALREADY-IN-RECALAGE-WORKLIST : slug présent dans la worklist recalage
 *       (2b9a5de2) → porte son tier + note "capability-gated recalage".
 *   NEW-GAP : pas dans la worklist, vraie muni dont le zonage n'est pas servi →
 *       nécessite une source-assessment (passe de découverte/recalage future).
 *   CANDIDATE-UN-ZONABLE : territoire vaste/nordique qui, plausiblement, n'a PAS
 *       de zonage municipal. ⚠ Contrat N-A d'i-arch (CONTRAT_ATTESTATION_ABSENCE_
 *       SOURCE) : un candidat un-zonable N'EST PAS N-A. Il reste UNKNOWN/source-gap
 *       tant qu'une ATTESTATION D'ABSENCE REJOUABLE (source + requête + résultat-
 *       absence + date) n'existe pas. On n'en a AUCUNE → coverage_state=UNKNOWN/
 *       source-gap, na_status=NOT-N-A (absence-proof=TODO). JAMAIS d'auto-N-A,
 *       JAMAIS de fabrication d'absence. La classification un-zonable est une
 *       HEURISTIQUE de routage (géographie), pas une assertion d'absence.
 *   ÉCRIT : work/coverage/zones-220-acquisition-backlog-20260821.{json,md}
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-prod-served-and-220-backlog-20260821.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { listObjectEntries, s3Client } from "./lib/s3.js";

const PROD_OGC_URL = "https://api.geo.sent-tech.ca/collections?f=json";
const S3_PREFIX = "normalized/ca-qc-zonage/";

const WORKLIST_220 = "work/coverage/zones-bareslug-alias-worklist-20260821.json";
const WORKLIST_RECALAGE = "work/coverage/zones-pdf-recalage-worklist-incohort-20260811.json";

const OUT_D1 = "work/coverage/zones-prod-qczonage-served-list-20260821.json";
const OUT_D2_JSON = "work/coverage/zones-220-acquisition-backlog-20260821.json";
const OUT_D2_MD = "work/coverage/zones-220-acquisition-backlog-20260821.md";

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

/**
 * Territoires vastes/nordiques du lot des 220 qui, PLAUSIBLEMENT, n'ont pas de
 * zonage municipal (Basse-Côte-Nord, Minganie côtière isolée, Nord-du-Québec).
 * HEURISTIQUE géographique de ROUTAGE — PAS une attestation d'absence. Chaque
 * candidat reste UNKNOWN/source-gap, na_status=NOT-N-A (absence-proof=TODO).
 * Aucune absence n'est affirmée ici ; la liste ne fait que router un travail
 * futur d'attestation d'absence rejouable.
 */
const UNZONABLE_CANDIDATES: Record<string, string> = {
  "blanc-sablon":
    "Basse-Côte-Nord (Côte-Nord), territoire côtier isolé sans lien routier — plausiblement sans règlement de zonage municipal. HEURISTIQUE géographique, pas d'attestation d'absence.",
  "bonne-esperance":
    "Basse-Côte-Nord, municipalité côtière isolée (Vieux-Fort/Saint-Paul-du-Nord) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "gros-mecatina":
    "Basse-Côte-Nord, municipalité côtière isolée (La Tabatière/Mutton Bay) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "saint-augustin--le-golfe-du-saint-laurent":
    "Basse-Côte-Nord, très vaste territoire côtier isolé (Saint-Augustin) — plausiblement sans zonage municipal. HEURISTIQUE, pas d'attestation.",
  "natashquan":
    "Minganie (Côte-Nord), petite municipalité côtière isolée (task-named) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "longue-pointe-de-mingan":
    "Minganie (Côte-Nord), petite municipalité côtière (task-named) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "riviere-saint-jean":
    "Minganie (Côte-Nord), petite municipalité côtière (task-named) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "baie-johan-beetz":
    "Minganie (Côte-Nord), très petite municipalité côtière isolée (~85 hab) — plausiblement sans zonage. HEURISTIQUE, pas d'attestation.",
  "matagami":
    "Nord-du-Québec (Jamésie), territoire municipal très vaste (task-named) — candidat un-zonable au sens routage. HEURISTIQUE, pas d'attestation ; un noyau urbain zoné reste possible → UNKNOWN.",
  // ── i-arch 16 data-gaps : candidats un-zonable nordiques/vastes ──
  "eeyou-istchee-james-bay":
    "Nord-du-Québec, gouvernement régional Eeyou Istchee Baie-James — territoire immense largement non-organisé/cri (i-arch-named). Candidat un-zonable au sens routage. HEURISTIQUE, pas d'attestation → UNKNOWN.",
  "caniapiscau":
    "Côte-Nord, municipalité nordique très vaste (secteur réservoir/Fermont, i-arch-named). Candidat un-zonable au sens routage. HEURISTIQUE, pas d'attestation → UNKNOWN.",
  "cote-nord-du-golfe-du-saint-laurent":
    "Basse-Côte-Nord, très vaste territoire côtier isolé (i-arch-named). Candidat un-zonable au sens routage. HEURISTIQUE, pas d'attestation → UNKNOWN.",
  "aguanish":
    "Minganie (Côte-Nord), petite municipalité côtière isolée (i-arch-named). Candidat un-zonable au sens routage. HEURISTIQUE, pas d'attestation → UNKNOWN.",
  "la-tuque":
    "Mauricie/Haute-Mauricie, agglomération au territoire parmi les plus vastes au monde (~28 000 km², i-arch-named). Candidat un-zonable au sens routage ; un noyau urbain zoné reste probable → UNKNOWN. HEURISTIQUE, pas d'attestation.",
};

/**
 * Les 16 data-gaps ajoutés par i-arch (post-reconciliation) aux 220 gate-slugs
 * → 236 au total. Même dimensions de classification. `austin` est le SEUL des
 * 236 sans `qc-lots` servi non plus (ni zonage ni lots) — noté dans son entrée.
 */
const DATA_GAP_16: string[] = [
  "lile-dorval",
  "lile-cadieux",
  "austin",
  "saint-benoit-du-lac",
  "notre-dame-des-anges",
  "la-tuque",
  "sainte-anne-de-la-pocatiere",
  "saint-onesime-dixworth",
  "hebertville-station",
  "saint-bruno",
  "saint-guy",
  "sainte-jeanne-darc--la-mitis",
  "eeyou-istchee-james-bay",
  "aguanish",
  "caniapiscau",
  "cote-nord-du-golfe-du-saint-laurent",
];

/** Slugs des 236 sans aucune donnée servie (ni zonage ni qc-lots) — note d'i-arch. */
const NO_LOTS_EITHER = new Set<string>(["austin"]);

interface Recalage {
  candidates?: Array<{ slug?: string; tier?: string; tier_confidence?: string; recale_status?: string }>;
}

interface Bareslug {
  count_asserted?: number;
  slugs?: string[];
}

interface OgcCollections {
  collections?: Array<{ id?: string }>;
}

async function fetchOgcServed(): Promise<{
  reachable: boolean;
  http_status: number | null;
  total_collections: number | null;
  qczonage_ids: string[];
  error?: string;
}> {
  try {
    const res = await fetch(PROD_OGC_URL, { headers: { accept: "application/json" } });
    const status = res.status;
    if (!res.ok) {
      return { reachable: false, http_status: status, total_collections: null, qczonage_ids: [], error: `HTTP ${status}` };
    }
    const body = (await res.json()) as OgcCollections;
    const cols = body.collections ?? [];
    const ids = cols
      .map((c) => String(c.id ?? ""))
      .filter((id) => id.startsWith("qc-zonage-"))
      .sort();
    return { reachable: true, http_status: status, total_collections: cols.length, qczonage_ids: [...new Set(ids)] };
  } catch (e) {
    return { reachable: false, http_status: null, total_collections: null, qczonage_ids: [], error: (e as Error).message };
  }
}

async function enumerateBucket(): Promise<{
  flat: Set<string>;
  nested: Set<string>;
  union: Set<string>;
  total_keys: number;
}> {
  const s3 = s3Client();
  const entries = await listObjectEntries(s3, S3_PREFIX);
  const flat = new Set<string>();
  const nested = new Set<string>();
  const flatRe = /^qc-zonage-([a-z0-9-]+)\.geojson$/;
  const nestedRe = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.geojson$/;
  for (const { key } of entries) {
    if (!key.startsWith(S3_PREFIX)) continue;
    const rest = key.slice(S3_PREFIX.length);
    const mFlat = flatRe.exec(rest);
    if (mFlat) { flat.add(mFlat[1]!); continue; }
    const mNested = nestedRe.exec(rest);
    if (mNested && mNested[1] === mNested[2]) nested.add(mNested[1]!);
  }
  const union = new Set<string>([...flat, ...nested]);
  return { flat, nested, union, total_keys: entries.length };
}

async function deliverable1(): Promise<{ d1: Record<string, unknown> }> {
  const ogc = await fetchOgcServed();
  const bucket = await enumerateBucket();

  // Slugs bruts (sans le préfixe canonique) pour le join avec le bucket.
  const ogcSlugs = new Set(ogc.qczonage_ids.map((id) => id.slice("qc-zonage-".length)));
  const bucketUnion = bucket.union;

  const ogcMinusBucket = ogc.reachable
    ? [...ogcSlugs].filter((s) => !bucketUnion.has(s)).sort()
    : [];
  const bucketMinusOgc = ogc.reachable
    ? [...bucketUnion].filter((s) => !ogcSlugs.has(s)).sort()
    : [];

  // Ensemble autoritatif servi : OGC si joignable, sinon repli bucket (étiqueté).
  const authoritativeIds = ogc.reachable
    ? ogc.qczonage_ids
    : [...bucketUnion].map((s) => `qc-zonage-${s}`).sort();

  // Forme des ids servis (aide i-arch à comprendre pourquoi le compte > 1106 munis).
  // Le préfixe `qc-zonage-` est un NAMESPACE de collections, pas seulement le zonage
  // municipal : il inclut des couches DÉRIVÉES (normes/usages, arcgis brut, thématiques).
  const bareSlugs = [...ogcSlugs];
  const normsIds = bareSlugs.filter((s) => s.startsWith("norms-"));
  const arcgisIds = bareSlugs.filter((s) => s.startsWith("arcgis-"));
  const thematicIds = bareSlugs.filter((s) => /(cuvettes|retention|ruissellement|vulnerabilite|crues|limite-rci|inondation|contrainte)/.test(s));
  const derivedSet = new Set<string>([...normsIds, ...arcgisIds, ...thematicIds]);
  const municipalCandidate = bareSlugs.filter((s) => !derivedSet.has(s));
  const numericSuffixed = municipalCandidate.filter((s) => /--?\d+$/.test(s)); // <slug>--2 / -2
  const regionSuffixed = municipalCandidate.filter((s) => /--/.test(s) && !/--?\d+$/.test(s)); // <slug>--<mrc>
  const idShape = {
    distinct_qczonage_ids_total_namespace: bareSlugs.length,
    breakdown: {
      norms_usages_derived: normsIds.length,
      arcgis_raw_derived: arcgisIds.length,
      montreal_thematic_derived: thematicIds.length,
      municipal_zonage_candidate: municipalCandidate.length,
    },
    municipal_zonage_candidate_shape: {
      numeric_suffixed_variant_count: numericSuffixed.length,
      region_disambiguated_double_dash_count: regionSuffixed.length,
      numeric_suffixed_sample: numericSuffixed.slice(0, 15).sort(),
    },
    interpretation:
      "Le namespace `qc-zonage-*` PROD sert 1648 collections, mais ~un quart sont des couches DÉRIVÉES " +
      "(qc-zonage-norms-* = normes/usages, qc-zonage-arcgis-* = arcgis brut, thématiques Montréal = " +
      "rétention/crues/RCI). Le sous-ensemble ZONAGE MUNICIPAL (municipal_zonage_candidate) est le nombre " +
      "comparable au preprod=870 d'i-arch et au bucket-union municipal (873). i-arch : diffe sur le sous-ensemble " +
      "municipal, PAS sur le namespace brut, sinon le diff est pollué par les norms-/arcgis-/thématiques.",
  };

  // Diff sur le sous-ensemble MUNICIPAL (comparable au preprod=870 d'i-arch).
  const municipalCandidateSet = new Set(municipalCandidate);
  const municipalMinusBucket = ogc.reachable
    ? [...municipalCandidateSet].filter((s) => !bucketUnion.has(s)).sort()
    : [];

  const d1: Record<string, unknown> = {
    contract: "zones-prod-qczonage-served-list/v1",
    generated_at_utc: new Date().toISOString(),
    source: ogc.reachable
      ? "prod OGC api.geo.sent-tech.ca/collections?f=json (AUTHORITATIVE served set)"
      : "bucket-derived (OGC unreachable) — normalized/ca-qc-zonage flat+nested on sentropic-geo",
    authoritative_basis: ogc.reachable ? "ogc-served" : "bucket-derived (OGC unreachable)",
    ogc: {
      url: PROD_OGC_URL,
      reachable: ogc.reachable,
      http_status: ogc.http_status,
      total_collections: ogc.total_collections,
      qczonage_count: ogc.qczonage_ids.length,
      ...(ogc.error ? { error: ogc.error } : {}),
    },
    count: authoritativeIds.length,
    id_shape: idShape,
    slugs: authoritativeIds,
    bucket_crosscheck: {
      prefix: S3_PREFIX,
      bucket: "sentropic-geo (prod OVH)",
      total_keys_listed: bucket.total_keys,
      flat_slug_count: bucket.flat.size,
      nested_slug_count: bucket.nested.size,
      union_slug_count: bucketUnion.size,
      ogc_minus_bucket_count: ogcMinusBucket.length,
      ogc_minus_bucket: ogcMinusBucket,
      bucket_minus_ogc_count: bucketMinusOgc.length,
      bucket_minus_ogc: bucketMinusOgc,
      municipal_candidate_minus_bucket_count: municipalMinusBucket.length,
      municipal_candidate_minus_bucket: municipalMinusBucket,
      note: ogc.reachable
        ? "ogc_minus_bucket = servi par OGC mais absent du bucket flat/nested (index gelé / servi d'ailleurs). bucket_minus_ogc = présent dans le bucket mais NON servi par l'OGC (effet d'index gelé). L'ensemble OGC fait foi pour 'reachable'."
        : "OGC injoignable : la liste servie est DÉRIVÉE DU BUCKET (flat+nested union) et NON du geo-api réel. Diff OGC-vs-bucket non calculable.",
    },
  };
  return { d1 };
}

type Classification = "already-in-recalage-worklist" | "new-gap" | "candidate-un-zonable";

interface BacklogRow {
  slug: string;
  source_set: "220-gate-slug" | "16-data-gap";
  classification: Classification;
  tier_if_worklist: string | null;
  coverage_state: string;
  na_status: string;
  note: string;
}

function deliverable2(): { d2: Record<string, unknown>; md: string } {
  const bare = JSON.parse(readFileSync(WORKLIST_220, "utf8")) as Bareslug;
  const gateSlugs = (bare.slugs ?? []).slice();
  if (gateSlugs.length !== (bare.count_asserted ?? 220)) {
    throw new Error(`220-worklist: count mismatch slugs=${gateSlugs.length} asserted=${bare.count_asserted}`);
  }
  // 236 = 220 gate-slugs + 16 data-gaps i-arch. Partition fermée, aucun doublon.
  const gateSet = new Set(gateSlugs);
  const dupes = DATA_GAP_16.filter((s) => gateSet.has(s));
  if (dupes.length) throw new Error(`16-data-gap overlaps 220 gate-slugs: ${dupes.join(",")}`);
  if (new Set(DATA_GAP_16).size !== DATA_GAP_16.length) throw new Error("16-data-gap contains internal duplicates");
  const sourceSet = new Map<string, "220-gate-slug" | "16-data-gap">();
  for (const s of gateSlugs) sourceSet.set(s, "220-gate-slug");
  for (const s of DATA_GAP_16) sourceSet.set(s, "16-data-gap");
  const slugs = [...gateSlugs, ...DATA_GAP_16];

  const recalage = JSON.parse(readFileSync(WORKLIST_RECALAGE, "utf8")) as Recalage;
  const recalageTier = new Map<string, string>();
  for (const c of recalage.candidates ?? []) {
    if (c.slug) recalageTier.set(c.slug, String(c.tier ?? "no-plan"));
  }

  const COVERAGE = "UNKNOWN/source-gap";
  const rows: BacklogRow[] = [];
  const overlapWorklistUnzonable: string[] = [];

  for (const slug of slugs) {
    const src = sourceSet.get(slug)!;
    const inWorklist = recalageTier.has(slug);
    const isUnzonable = Object.prototype.hasOwnProperty.call(UNZONABLE_CANDIDATES, slug);
    const noLots = NO_LOTS_EITHER.has(slug);
    const lotsSuffix = noLots
      ? " ⚠ i-arch: SEUL des 236 SANS qc-lots servi non plus (ni zonage ni lots)."
      : "";
    if (inWorklist && isUnzonable) overlapWorklistUnzonable.push(slug);

    if (inWorklist) {
      const tier = recalageTier.get(slug)!;
      rows.push({
        slug,
        source_set: src,
        classification: "already-in-recalage-worklist",
        tier_if_worklist: tier,
        coverage_state: COVERAGE,
        na_status: "NOT-N-A",
        note: `capability-gated recalage (worklist 2b9a5de2, tier=${tier}) — zonage non servi, recalage BLOQUÉ (owner-level) en attente d'un spike capability.${lotsSuffix}`,
      });
    } else if (isUnzonable) {
      rows.push({
        slug,
        source_set: src,
        classification: "candidate-un-zonable",
        tier_if_worklist: null,
        coverage_state: COVERAGE,
        na_status: "NOT-N-A (absence-proof=TODO)",
        note: `HEURISTIQUE un-zonable (routage seulement) : ${UNZONABLE_CANDIDATES[slug]} AUCUNE attestation d'absence rejouable → reste UNKNOWN/source-gap, JAMAIS N-A.${lotsSuffix}`,
      });
    } else {
      rows.push({
        slug,
        source_set: src,
        classification: "new-gap",
        tier_if_worklist: null,
        coverage_state: COVERAGE,
        na_status: "NOT-N-A",
        note: `vraie municipalité dont le zonage n'est pas servi et qui n'est PAS dans la worklist recalage — nécessite une source-assessment (passe de découverte/recalage future).${lotsSuffix}`,
      });
    }
  }

  const counts = {
    "already-in-recalage-worklist": rows.filter((r) => r.classification === "already-in-recalage-worklist").length,
    "new-gap": rows.filter((r) => r.classification === "new-gap").length,
    "candidate-un-zonable": rows.filter((r) => r.classification === "candidate-un-zonable").length,
  };
  const tierSplit: Record<string, number> = {};
  for (const r of rows) {
    if (r.classification !== "already-in-recalage-worklist" || !r.tier_if_worklist) continue;
    tierSplit[r.tier_if_worklist] = (tierSplit[r.tier_if_worklist] ?? 0) + 1;
  }

  const sourceSetCounts = {
    "220-gate-slug": rows.filter((r) => r.source_set === "220-gate-slug").length,
    "16-data-gap": rows.filter((r) => r.source_set === "16-data-gap").length,
  };

  const d2: Record<string, unknown> = {
    contract: "zones-220-acquisition-backlog/v1",
    generated_at_utc: new Date().toISOString(),
    scope_note: "236 = 220 gate-slugs (f2459f44) + 16 data-gaps i-arch (post-reconciliation). UN SEUL record cohérent : dans les 236, 'qc-zonage-<slug> non servi' = gap de couverture, dimensions uniformes.",
    mode: "READ-ONLY classification. NO deposit / NO S3 write / NO cluster. Route-B zonage-gap acquisition backlog.",
    inputs: {
      "220_gate_slugs": `${WORKLIST_220} (commit f2459f44)`,
      "16_data_gaps": "i-arch post-reconciliation add: lile-dorval, lile-cadieux, austin, saint-benoit-du-lac, notre-dame-des-anges, la-tuque, sainte-anne-de-la-pocatiere, saint-onesime-dixworth, hebertville-station, saint-bruno, saint-guy, sainte-jeanne-darc--la-mitis, eeyou-istchee-james-bay, aguanish, caniapiscau, cote-nord-du-golfe-du-saint-laurent",
      recalage_worklist: `${WORKLIST_RECALAGE} (commit 2b9a5de2)`,
      col2_triage: "work/coverage/zones-col2-source-triage-20260816.json (context, not a gap source)",
    },
    na_contract: "CONTRAT_ATTESTATION_ABSENCE_SOURCE (i-arch): un candidat un-zonable N'EST PAS N-A. Absence de source ≠ absence de zonage. Sans attestation d'absence REJOUABLE (source+requête+résultat-absence+date), l'état reste UNKNOWN/source-gap. Aucune attestation d'absence n'a été produite ici : les 3 classes sont TOUTES UNKNOWN/source-gap et NOT-N-A.",
    total: slugs.length,
    source_set_counts: sourceSetCounts,
    counts,
    already_in_worklist_tier_split: tierSplit,
    overlap_worklist_and_unzonable: overlapWorklistUnzonable,
    no_lots_either: [...NO_LOTS_EITHER],
    unzonable_candidate_note:
      "candidate-un-zonable = HEURISTIQUE géographique de routage (Basse-Côte-Nord / Minganie côtière isolée / Nord-du-Québec / Jamésie), PAS une assertion d'absence. Chaque candidat reste UNKNOWN/source-gap, NOT-N-A (absence-proof=TODO). Aucune WebSearch/attestation n'a été effectuée ; ces slugs sont routés vers un futur travail d'attestation d'absence rejouable.",
    rows,
  };

  // ── Companion .md ──
  const tierLine = Object.keys(tierSplit).length
    ? Object.entries(tierSplit).sort().map(([t, n]) => `${t}=${n}`).join(", ")
    : "(aucun)";
  const byClass = (cls: Classification) => rows.filter((r) => r.classification === cls);
  const mdRows = (rs: BacklogRow[]) =>
    rs.map((r) => `| ${r.slug} | ${r.source_set === "16-data-gap" ? "16-data-gap" : "220"} | ${r.tier_if_worklist ?? "—"} | ${r.coverage_state} | ${r.na_status} |`).join("\n") ||
    "| (aucun) | | | | |";

  const md = `# Backlog acquisition — 236 gaps zonage route-B — ${new Date().toISOString().slice(0, 10)}

READ-ONLY. Classification des **${slugs.length}** munis route-B (zonage non servi) pour le cutover immo.
**236 = 220 gate-slugs + 16 data-gaps i-arch** (post-reconciliation, UN SEUL record cohérent : dans les 236,
« \`qc-zonage-<slug>\` non servi = gap de couverture », dimensions uniformes).
Source des 220 : \`${WORKLIST_220}\` (f2459f44) ; 16 data-gaps : ajout i-arch. Croisé avec la worklist recalage
\`${WORKLIST_RECALAGE}\` (2b9a5de2) pour les 236.

## Contrat N-A (i-arch — CONTRAT_ATTESTATION_ABSENCE_SOURCE)

Un candidat un-zonable **N'EST PAS N-A**. Absence de source ≠ absence de zonage. Sans **attestation d'absence
rejouable** (source + requête + résultat-absence + date), l'état reste **UNKNOWN/source-gap**. Aucune attestation
n'a été produite ici → les **3 classes sont TOUTES UNKNOWN/source-gap et NOT-N-A**.

## Résumé (partitions fermées, ${slugs.length} = ${counts["already-in-recalage-worklist"]} + ${counts["new-gap"]} + ${counts["candidate-un-zonable"]})

| Classe | Nombre | coverage_state | na_status |
|--------|--------|----------------|-----------|
| already-in-recalage-worklist | ${counts["already-in-recalage-worklist"]} | UNKNOWN/source-gap | NOT-N-A |
| new-gap | ${counts["new-gap"]} | UNKNOWN/source-gap | NOT-N-A |
| candidate-un-zonable | ${counts["candidate-un-zonable"]} | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |

- **origine** : 220-gate-slug = ${sourceSetCounts["220-gate-slug"]}, 16-data-gap i-arch = ${sourceSetCounts["16-data-gap"]}
- **already-in-recalage-worklist** — répartition par tier : ${tierLine}
- **overlap worklist ∩ un-zonable** : ${overlapWorklistUnzonable.length ? overlapWorklistUnzonable.join(", ") : "aucun"}
- **sans qc-lots servi non plus (i-arch)** : ${[...NO_LOTS_EITHER].join(", ")}

## ALREADY-IN-RECALAGE-WORKLIST (${counts["already-in-recalage-worklist"]}) — capability-gated recalage

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
${mdRows(byClass("already-in-recalage-worklist"))}

## CANDIDATE-UN-ZONABLE (${counts["candidate-un-zonable"]}) — UNKNOWN, PAS N-A (heuristique routage)

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
${mdRows(byClass("candidate-un-zonable"))}

> Ces slugs sont des territoires vastes/nordiques (Basse-Côte-Nord / Minganie côtière isolée / Nord-du-Québec / Jamésie)
> où l'absence de zonage municipal est **plausible mais NON prouvée**. Aucune attestation d'absence rejouable n'existe →
> ils restent **UNKNOWN/source-gap**, **NOT-N-A**. Routés vers un futur travail d'attestation d'absence.

## NEW-GAP (${counts["new-gap"]}) — source-assessment requise

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
${mdRows(byClass("new-gap"))}

## Méthode (anti-invention)

1. Lecture verbatim des 220 gate-slugs (${WORKLIST_220}) + 16 data-gaps i-arch → 236 (partition fermée, 0 doublon vérifié).
2. Join EXACT-slug sur la worklist recalage (2b9a5de2) → ALREADY-IN-RECALAGE-WORKLIST + tier porté.
3. Set un-zonable = heuristique géographique CURÉE (routage), jamais une assertion d'absence.
4. Reste = NEW-GAP. Partitions fermées, ${slugs.length} total. Aucun slug deviné ; aucune N-A fabriquée.
`;

  return { d2, md };
}

async function main(): Promise<void> {
  requireS3();
  mkdirSync("work/coverage", { recursive: true });

  // ── LIVRABLE 1 ──
  const { d1 } = await deliverable1();
  writeFileSync(OUT_D1, `${JSON.stringify(d1, null, 1)}\n`);
  const ogc = d1["ogc"] as Record<string, unknown>;
  process.stdout.write(
    `[D1] OGC reachable=${ogc["reachable"]} status=${ogc["http_status"]} qczonage_count=${ogc["qczonage_count"]} ` +
    `authoritative_count=${d1["count"]}\n`,
  );
  const shape = d1["id_shape"] as Record<string, unknown>;
  process.stdout.write(`[D1] id_shape breakdown=${JSON.stringify((shape["breakdown"] as unknown))}\n`);
  const xc = d1["bucket_crosscheck"] as Record<string, unknown>;
  process.stdout.write(
    `[D1] bucket flat=${xc["flat_slug_count"]} nested=${xc["nested_slug_count"]} union=${xc["union_slug_count"]} ` +
    `ogc∖bucket=${xc["ogc_minus_bucket_count"]} bucket∖ogc=${xc["bucket_minus_ogc_count"]} ` +
    `municipal∖bucket=${xc["municipal_candidate_minus_bucket_count"]}\n`,
  );
  process.stdout.write(`[D1] wrote ${OUT_D1}\n`);

  // ── LIVRABLE 2 ──
  const { d2, md } = deliverable2();
  writeFileSync(OUT_D2_JSON, `${JSON.stringify(d2, null, 1)}\n`);
  writeFileSync(OUT_D2_MD, md);
  const counts = d2["counts"] as Record<string, number>;
  process.stdout.write(
    `[D2] total=${d2["total"]} (origin ${JSON.stringify(d2["source_set_counts"])}) ` +
    `already-worklist=${counts["already-in-recalage-worklist"]} ` +
    `new-gap=${counts["new-gap"]} candidate-un-zonable=${counts["candidate-un-zonable"]}\n`,
  );
  process.stdout.write(`[D2] tier_split=${JSON.stringify(d2["already_in_worklist_tier_split"])} no_lots_either=${JSON.stringify(d2["no_lots_either"])}\n`);
  process.stdout.write(`[D2] wrote ${OUT_D2_JSON} + ${OUT_D2_MD}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
