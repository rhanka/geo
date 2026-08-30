/**
 * _zones-normalizezonecode-revalidate-20260830.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * SUITE DE : _zones-normalizezonecode-validate-20260830.ts (commit 29a14334).
 * Cette première sonde avait trouvé normalizeZoneCode NON injective : 16 fusions
 * à tort HARMFUL causées par le retrait AVEUGLE d'un suffixe parenthésé
 * `\s*\([A-Z0-9]{2,8}\)\s*` -> "" (contenu détruit : "02 (AGF)" et "02 (RCT)"
 * devenaient tous deux "02").
 *
 * i-infra a AJUSTÉ l'identité : la règle de parenthèses est désormais
 *
 *   .replace(/\(([A-Z0-9]{2,8})\)/g, "$1")   // parenthèses BALANCÉES retirées, CONTENU conservé
 *
 * c.-à-d. seuls les deux caractères `(` et `)` disparaissent — le contenu
 * capturé est réinjecté tel quel. "02 (AGF)" -> "02 AGF" -> (espace retiré)
 * "02AGF" ; "02 (RCT)" -> "02RCT". Les deux 16 anciens groupes HARMFUL
 * devraient donc redevenir DISTINCTS (le contenu du secteur, avant détruit,
 * différencie maintenant la sortie).
 *
 * QUESTION : cette version AJUSTÉE est-elle INJECTIVE sur les codes servis
 * PAR-MUNI ? On revalide EXACTEMENT la même méthode (même énumération S3, même
 * définition de collision par-muni, même classification de cause par
 * nécessité) — seule `normalizeZoneCode` change.
 *
 * ⚠ Comme la sonde précédente : on évalue la fusion à tort UNIQUEMENT sur
 * `normalizeZoneCode` (l'identité). `zoneSearchKey(raw) =
 * normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,"")` reste VOLONTAIREMENT
 * many-to-one, hors-scope, ni calculé ni signalé ici.
 *
 * RISQUE NOUVEAU introduit PAR le changement "garder le contenu" (watch clé
 * de cette repasse, en plus de la ré-vérification des 16 tués) :
 *   un code parenthésé "X (SECT)" -> "XSECT" peut désormais entrer en
 *   collision avec un code NATIF sans parenthèses "XSECT" déjà présent dans
 *   la même muni (chose impossible avec l'ancienne règle, qui retombait sur
 *   "X" et non "XSECT"). C'est un NOUVEAU mode de fusion à tort possible,
 *   distinct du mode tué. On le détecte via la classification de cause :
 *   un groupe dont la cause nécessaire inclut `paren` (retirer la règle
 *   paren-collapse — en laissant les caractères `(`/`)` littéraux dans la
 *   chaîne — resépare le groupe) reste classé HARMFUL, exactement comme dans
 *   la sonde précédente ; mais son ORIGINE est différente : ce n'est plus
 *   "contenu détruit", c'est "forme parenthésée = forme native concaténée".
 *   On rapporte spécifiquement les cas où un des bruts du groupe ne contient
 *   AUCUNE parenthèse (forme "native") pour isoler ce sous-motif.
 *
 * MÉTHODE (lecture seule S3 ; ne DÉPOSE / N'ÉCRIT RIEN sur S3) — identique à
 * la sonde précédente :
 *   1. LISTE normalized/ca-qc-zonage/ ; couche SERVIE = NICHÉE si présente
 *      sinon PLATE (autorité geo-api). 873 slugs servis attendus.
 *   2. Par muni servie : bruts `zone_code` DISTINCTS (trim, non vide, ≠
 *      UNKNOWN) -> normalizeZoneCode (AJUSTÉ). Collision par-muni = une
 *      sortie provenant de ≥2 bruts distincts.
 *   3. Cause par NÉCESSITÉ (une règle R est cause ssi la retirer du pipeline
 *      re-sépare le groupe) ∈ {paren, whitespace, dash, case}. kind=HARMFUL
 *      ssi `paren` ∈ causes ; sinon BENIGN.
 *   4. RÉGRESSION A — 15 couples HARMFUL historiques (record 8d3d8b9b) :
 *      doivent rester DISTINCTS (séparateurs préservés, inchangé par ce
 *      correctif).
 *   5. RÉGRESSION B — 16 groupes HARMFUL de la sonde précédente (record
 *      29a14334) : doivent être TUÉS (devenir des sorties distinctes — le
 *      contenu de secteur, avant détruit, différencie maintenant chaque
 *      brut).
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-normalizezonecode-revalidate-20260830.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-normalizezonecode-revalidate-20260830.json
 *   work/coverage/zones-normalizezonecode-revalidate-20260830.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getGeoJsonFeatureCollection, listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT_JSON = "work/coverage/zones-normalizezonecode-revalidate-20260830.json";
const OUT_MD = "work/coverage/zones-normalizezonecode-revalidate-20260830.md";
const CONCURRENCY = 10;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

/**
 * LA fonction d'identité AJUSTÉE d'i-infra. NE PAS DÉVIER (ordre des étapes verbatim).
 * Différence avec la version précédente (29a14334) : la règle de parenthèses
 * ne retire QUE les deux caractères `(`/`)` (parenthèses BALANCÉES) et
 * RÉINJECTE le contenu capturé ($1) au lieu de le détruire.
 */
function normalizeZoneCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-") // unicode dash → ASCII hyphen
    .replace(/\(([A-Z0-9]{2,8})\)/g, "$1") // balanced parens removed, CONTENT kept
    .replace(/\s+/g, ""); // whitespace
}

// ── Variantes de pipeline pour l'analyse de CAUSE (une règle retirée à la fois) ──
/** Sans le retrait paren-collapse : les caractères `(`/`)` restent littéraux. */
function normNoParen(r: string): string {
  return r.toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, "");
}
/** Sans la suppression des espaces. */
function normNoWhitespace(r: string): string {
  return r.toUpperCase().replace(/[–—]/g, "-").replace(/\(([A-Z0-9]{2,8})\)/g, "$1");
}
/** Sans l'uniformisation des tirets unicode. */
function normNoDash(r: string): string {
  return r.toUpperCase().replace(/\(([A-Z0-9]{2,8})\)/g, "$1").replace(/\s+/g, "");
}
/** Sans le passage en majuscule (regex casse-insensible pour tester la nécessité de la casse). */
function normNoCase(r: string): string {
  return r.replace(/[–—]/g, "-").replace(/\(([A-Za-z0-9]{2,8})\)/g, "$1").replace(/\s+/g, "");
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

/** Un brut contient-il une forme parenthésée (au moins une paire `(...)`)? */
function hasParenForm(raw: string): boolean {
  return /\([A-Za-z0-9]{2,8}\)/.test(raw);
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
  kind: "HARMFUL" | "BENIGN"; // HARMFUL ssi paren ∈ causes
  paren_vs_native: boolean; // sous-motif watch: ≥1 brut SANS parenthèses ET ≥1 brut AVEC parenthèses
}

interface LayerResult {
  key: string;
  feature_count: number;
  distinct_raw_codes: number;
  distinct_raw_list: string[];
  norm_emptied_codes: string[];
  by_output: Array<[string, string[]]>;
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
    const distinctRaw = new Set<string>();
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
        const hasNoParen = raws.some((r) => !hasParenForm(r));
        const hasParen = raws.some((r) => hasParenForm(r));
        collisions.push({
          output: out,
          raw_codes: raws,
          causes,
          kind: causes.includes("paren") ? "HARMFUL" : "BENIGN",
          paren_vs_native: causes.includes("paren") && hasNoParen && hasParen,
        });
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

// ── Les 15 couples HARMFUL historiques (record 8d3d8b9b) — régression A. ──
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

// ── Les 16 groupes HARMFUL de la sonde précédente (record 29a14334) — régression B. ──
// Ces groupes fusionnaient sous l'ancienne règle paren-strip-all (contenu détruit) ;
// on vérifie qu'ils sont désormais TUÉS (bruts -> sorties distinctes) sous la règle
// AJUSTÉE (contenu conservé).
const PAREN_16: Array<{ slug: string; old_output: string; raws: string[] }> = [
  { slug: "la-redemption", old_output: "02", raws: ["02 (AGF)", "02 (RCT)"] },
  { slug: "la-redemption", old_output: "20", raws: ["20 (AGF)", "20 (FRT)"] },
  { slug: "la-redemption", old_output: "28", raws: ["28 (AGF)", "28 (FRT)"] },
  { slug: "la-redemption", old_output: "29", raws: ["29 (AIC)", "29 (FRT)"] },
  { slug: "la-redemption", old_output: "33", raws: ["33 (FRT)", "33 (LSR)"] },
  { slug: "la-redemption", old_output: "34", raws: ["34 (CSV)", "34 (HBF)"] },
  { slug: "padoue", old_output: "35", raws: ["35 (AGF)", "35 (MTF)"] },
  { slug: "saint-donat--la-mitis", old_output: "01", raws: ["01 (AGF)", "01 (FRT)"] },
  { slug: "saint-donat--la-mitis", old_output: "02", raws: ["02 (AGC)", "02 (AGF)", "02 (VLG)"] },
  { slug: "saint-donat--la-mitis", old_output: "43", raws: ["43 (MTF)", "43 (RCT)"] },
  { slug: "saint-joseph-de-lepage", old_output: "02", raws: ["02 (AGC)", "02 (VLG)"] },
  { slug: "saint-joseph-de-lepage", old_output: "03", raws: ["03 (AGF)", "03 (VLG)"] },
  { slug: "saint-joseph-de-lepage", old_output: "06", raws: ["06 (AGC)", "06 (CSV)"] },
  { slug: "saint-joseph-de-lepage", old_output: "07", raws: ["07 (AGC)", "07 (VLG)"] },
  { slug: "saint-joseph-de-lepage", old_output: "17", raws: ["17 (AGF)", "17 (RCT)"] },
  { slug: "saint-joseph-de-lepage", old_output: "19", raws: ["19 (AGC)", "19 (AGF)"] },
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

  const allCollisionGroups = perMuniCollisions.flatMap((m) => m.collisions.map((c) => ({ slug: m.slug, layout: m.layout, ...c })));
  const harmfulGroups = allCollisionGroups.filter((c) => c.kind === "HARMFUL");
  const benignGroups = allCollisionGroups.filter((c) => c.kind === "BENIGN");
  const parenGroups = allCollisionGroups.filter((c) => c.causes.includes("paren"));
  const whitespaceGroups = allCollisionGroups.filter((c) => c.causes.includes("whitespace"));
  const dashGroups = allCollisionGroups.filter((c) => c.causes.includes("dash"));
  const caseGroups = allCollisionGroups.filter((c) => c.causes.includes("case"));
  const parenVsNativeGroups = allCollisionGroups.filter((c) => c.paren_vs_native);

  // ── 4. RÉGRESSION A : les 15 couples historiques restent-ils distincts ? ──
  const regressionA = HISTORIC_15.map(({ slug, a, b }) => {
    const outA = normalizeZoneCode(a);
    const outB = normalizeZoneCode(b);
    const distinctByFunction = outA !== outB;
    const muni = byOutputBySlug.get(slug);
    let dataPresenceA = false;
    let dataPresenceB = false;
    let mergedInData = false;
    if (muni) {
      for (const raws of muni.values()) {
        if (raws.includes(a)) dataPresenceA = true;
        if (raws.includes(b)) dataPresenceB = true;
      }
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
  const regressionAAllDistinct = regressionA.every((r) => r.distinct_by_function && !r.merged_in_data);

  // ── 5. RÉGRESSION B : les 16 groupes HARMFUL précédents sont-ils TUÉS ? ──
  const regressionB = PAREN_16.map(({ slug, old_output, raws }) => {
    const outputs = raws.map((r) => ({ raw: r, out: normalizeZoneCode(r) }));
    const distinctOutputs = new Set(outputs.map((o) => o.out));
    const killedByFunction = distinctOutputs.size === raws.length; // toutes les sorties distinctes deux-à-deux
    const muni = byOutputBySlug.get(slug);
    let stillMergedInData = false;
    if (muni) {
      for (const raws2 of muni.values()) {
        const presentCount = raws.filter((r) => raws2.includes(r)).length;
        if (presentCount >= 2) stillMergedInData = true;
      }
    }
    return {
      slug,
      old_output,
      raws,
      new_outputs: outputs,
      killed_by_function: killedByFunction,
      slug_served: !!muni,
      still_merged_in_data: stillMergedInData,
    };
  });
  const regressionBAllKilled = regressionB.every((r) => r.killed_by_function && !r.still_merged_in_data);

  // ── VERDICT ── (false-merge safety is the business question: HARMFUL count
  // decides GO/residual; BENIGN same-code refolds are reported but do not
  // block, exactly as in the predecessor probe's classification).
  const totalCollisionGroups = allCollisionGroups.length;
  const muniWithCollision = perMuniCollisions.length;
  const verdict = harmfulGroups.length === 0
    ? `INJECTIVE for false-merge purposes — 0 HARMFUL false merge, SAFE identity, merge-GO` +
      (benignGroups.length > 0
        ? ` (${benignGroups.length} pre-existing BENIGN same-code refold(s) unchanged, not false merges: ${benignGroups.map((c) => `${c.slug}/${c.output}[${c.causes.join("+")}]`).join(", ")})`
        : "")
    : `${harmfulGroups.length} HARMFUL residual (false merge): ${harmfulGroups.map((c) => `${c.slug}/${c.output}(${c.raw_codes.join("+")})[${c.causes.join("+")}]`).join(", ")}`;

  const report = {
    contract: "zones-normalizezonecode-revalidate/diagnostic",
    generated_at_utc: new Date().toISOString(),
    predecessor: "acquisition/src/_zones-normalizezonecode-validate-20260830.ts (commit 29a14334)",
    question: "i-infra ADJUSTED normalizeZoneCode identity (balanced-parens, content KEPT) — is it INJECTIVE on served zone_codes per muni?",
    method: {
      s3_prefix: S3_PREFIX,
      target: "prod sentropic-geo (OVH BHS)",
      served_layer_rule: "nested wins when both flat and nested exist (geo-api authority)",
      normalizeZoneCode: 'String(raw ?? "").toUpperCase().replace(/[–—]/g,"-").replace(/\\(([A-Z0-9]{2,8})\\)/g,"$1").replace(/\\s+/g,"")',
      diff_from_predecessor: 'paren rule changed from /\\s*\\([A-Z0-9]{2,8}\\)\\s*/g -> "" (content destroyed) to /\\(([A-Z0-9]{2,8})\\)/g -> "$1" (balanced parens removed, content KEPT)',
      searchKey_note: "zoneSearchKey = normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,'') is intentionally many-to-one and NOT evaluated here — only the normalizeZoneCode identity must be injective",
      skip: "null/empty/UNKNOWN raw zone_code; codes whose normalizeZoneCode output is empty reported separately (norm_emptied)",
      per_muni_collision: ">=2 distinct trimmed raw codes mapping to the same normalizeZoneCode output within one muni = false merge",
      cause_classification: "a rule R is a cause iff removing R from the pipeline re-splits the group (>=2 outputs). kind=HARMFUL iff paren in causes; else BENIGN (case/whitespace/dash refold of the same code).",
      paren_vs_native_watch: "flags a HARMFUL group where >=1 raw has NO parens at all and >=1 raw HAS parens — the new merge mode enabled specifically by content-preservation (X (SECT) -> XSECT colliding a native XSECT)",
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
    injective_strict: totalCollisionGroups === 0,
    injective_for_false_merge_purposes: harmfulGroups.length === 0,
    normalizezonecode_collisions: {
      total_collision_groups: totalCollisionGroups,
      muni_with_any_collision: muniWithCollision,
      harmful_paren: harmfulGroups.length,
      benign_same_code_refold: benignGroups.length,
      paren_vs_native_watch_count: parenVsNativeGroups.length,
      by_cause: {
        paren: parenGroups.length,
        whitespace: whitespaceGroups.length,
        dash: dashGroups.length,
        case: caseGroups.length,
      },
      list: perMuniCollisions,
    },
    paren_vs_native_watch: {
      note: "new merge mode enabled by content-preservation: a parenthesized raw's collapsed form equals a co-present native (paren-less) raw in the same muni.",
      count: parenVsNativeGroups.length,
      list: parenVsNativeGroups.map((c) => ({ slug: c.slug, output: c.output, raw_codes: c.raw_codes, causes: c.causes })),
    },
    regression_15_historic_harmful: {
      note: "the 15 historically-harmful pairs (record 8d3d8b9b) must stay DISTINCT under the adjusted normalizeZoneCode (unaffected by the paren content-preservation fix).",
      all_stay_distinct: regressionAAllDistinct,
      list: regressionA,
    },
    regression_16_paren_killed: {
      note: "the 16 groups HARMFUL under the predecessor's paren-strip-all rule (record 29a14334) must be KILLED (distinct outputs) under the adjusted content-preserving rule.",
      all_killed: regressionBAllKilled,
      list: regressionB,
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
      `| ${c.slug} | ${c.layout} | ${c.kind}${c.paren_vs_native ? " (paren-vs-native)" : ""} | ${c.causes.join("+")} | \`${c.output}\` | ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")} |`,
    );
  const regressionARows = regressionA.map((r) =>
    `| ${r.slug} | \`${r.raw_a}\` → \`${r.out_a}\` | \`${r.raw_b}\` → \`${r.out_b}\` | ${r.distinct_by_function ? "DISTINCT ✓" : "MERGED ✗"} | ${r.merged_in_data ? "merged-in-data ✗" : (r.slug_served ? "not-merged-in-data ✓" : "slug-not-served")} |`,
  );
  const regressionBRows = regressionB.map((r) =>
    `| ${r.slug} | \`${r.old_output}\` | ${r.new_outputs.map((o) => `\`${o.raw}\`→\`${o.out}\``).join(" · ")} | ${r.killed_by_function ? "KILLED ✓" : "STILL MERGED ✗"} | ${r.still_merged_in_data ? "still-merged-in-data ✗" : (r.slug_served ? "not-merged-in-data ✓" : "slug-not-served")} |`,
  );

  const md = `# Revalidation de normalizeZoneCode AJUSTÉE (identité i-infra) — ${new Date().toISOString().slice(0, 10)}

**Suite de** \`_zones-normalizezonecode-validate-20260830.ts\` (commit 29a14334) —
avait trouvé 16 fusions à tort HARMFUL causées par le retrait AVEUGLE d'un
suffixe parenthésé (contenu détruit). i-infra a AJUSTÉ la règle pour ne retirer
que les caractères \`(\`/\`)\` et CONSERVER le contenu.

\`\`\`js
function normalizeZoneCode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")                       // unicode dash → ASCII
    .replace(/\\(([A-Z0-9]{2,8})\\)/g, "$1")       // balanced parens removed, CONTENT kept
    .replace(/\\s+/g, "");                          // whitespace
}
\`\`\`

> ⚠ Évalué UNIQUEMENT sur \`normalizeZoneCode\` (l'identité). \`zoneSearchKey\`
> reste VOLONTAIREMENT many-to-one — hors-scope, ni calculé ni signalé ici.

## Verdict

**${verdict}**

## Couverture (lecture seule S3 prod \`sentropic-geo\`, anti-invention)

- clés listées sous \`${S3_PREFIX}\` : **${entries.length}**
- slugs servis (total) : **${servedSlugs.length}**
- **munis vérifiées : ${muniChecked} / ${servedSlugs.length}**
- flat-only : ${flatOnly.length} · nested-only : ${nestedOnly.length} · both : ${bothSlugs.length}
- erreurs de lecture : ${readErrors.length}

## Régression B — les 16 groupes HARMFUL précédents sont-ils TUÉS ?

Attendu : **oui** (le contenu de secteur, avant détruit, différencie maintenant chaque brut).

**Tous tués : ${regressionBAllKilled ? "OUI ✓" : "NON ✗"}**

| slug | ancienne sortie (fusionnée) | nouvelles sorties | fonction | données |
|------|------------------------------|--------------------|----------|---------|
${regressionBRows.join("\n")}

## Régression A — les 15 couples HARMFUL historiques restent-ils distincts ?

Attendu : **oui** (inchangé par ce correctif — séparateurs toujours préservés).

**Tous distincts : ${regressionAAllDistinct ? "OUI ✓" : "NON ✗"}**

| slug | brut A → sortie | brut B → sortie | fonction | données |
|------|-----------------|-----------------|----------|---------|
${regressionARows.join("\n")}

## Collisions PAR-MUNI sous la normalizeZoneCode AJUSTÉE

- groupes de collision (≥2 bruts distincts → même sortie) : **${totalCollisionGroups}**
- munis avec ≥1 collision : **${muniWithCollision}**
- par cause : paren=${parenGroups.length} · whitespace=${whitespaceGroups.length} · dash=${dashGroups.length} · case=${caseGroups.length}
- HARMFUL : ${harmfulGroups.length} · BENIGN : ${benignGroups.length}

${collisionRows.length ? `| slug | couche | nature | cause | sortie | bruts distincts fusionnés |
|------|--------|--------|-------|--------|---------------------------|
${collisionRows.join("\n")}` : "_aucune collision — normalizeZoneCode injective sur les codes servis._"}

## Watch clé — nouveau mode de fusion (parenthésé vs natif)

Motif surveillé : un brut parenthésé \`X (SECT)\` → \`XSECT\` entre en collision
avec un brut NATIF sans parenthèses \`XSECT\` déjà présent dans la même muni —
mode IMPOSSIBLE sous l'ancienne règle (qui retombait sur \`X\`, pas \`XSECT\`).

**Occurrences : ${parenVsNativeGroups.length}**

${parenVsNativeGroups.length ? parenVsNativeGroups.map((c) => `- \`${c.slug}\` → \`${c.output}\` ⟵ ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")}`).join("\n") : "- aucune."}

## Méthode

1. \`listObjectEntries\` sur \`${S3_PREFIX}\` → slugs plat/niché ; couche servie = niché si présent sinon plat (autorité geo-api ; 873 servis).
2. Par muni servie : bruts \`zone_code\` distincts (trim, non vide, ≠ UNKNOWN, sortie non vide) → \`normalizeZoneCode\` (AJUSTÉE) ; collision = une sortie provenant de ≥2 bruts distincts.
3. Cause par NÉCESSITÉ : règle R = cause ssi la retirer re-sépare le groupe. kind=HARMFUL ssi \`paren\` ∈ causes ; sinon BENIGN.
4. Régression A : 15 couples historiques (record 8d3d8b9b) — doivent rester distincts.
5. Régression B : 16 groupes HARMFUL de la sonde précédente (record 29a14334) — doivent être tués.
6. Watch : groupe HARMFUL dont ≥1 brut est SANS parenthèses et ≥1 brut AVEC — nouveau mode de fusion activé par la conservation du contenu.

Numéros MESURÉS ; muni illisible notée, jamais devinée.

${readErrors.length ? `## Erreurs de lecture\n\n${readErrors.map((e) => `- ${e.slug} [${e.layer}]: ${e.error}`).join("\n")}\n` : "## Erreurs de lecture\n\naucune.\n"}
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(
    `\n[done] verdict: ${verdict}\n` +
    `[done] munis_checked=${muniChecked}/${servedSlugs.length} ` +
    `collision_groups=${totalCollisionGroups} harmful=${harmfulGroups.length} benign=${benignGroups.length} ` +
    `(paren=${parenGroups.length} whitespace=${whitespaceGroups.length} dash=${dashGroups.length} case=${caseGroups.length}) ` +
    `paren_vs_native=${parenVsNativeGroups.length} read_errors=${readErrors.length}\n` +
    `[done] regression_A_15_all_distinct=${regressionAAllDistinct}\n` +
    `[done] regression_B_16_all_killed=${regressionBAllKilled}\n` +
    `[done] wrote ${OUT_JSON} + ${OUT_MD}\n`,
  );
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
