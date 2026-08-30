/**
 * _zones-zonecode-norm-collision-20260825.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * QUESTION (immo, anti-invention). immo veut normaliser la recherche de code de
 * zone via `norm(c) = c.toUpperCase().replace(/[^A-Z0-9]/g, "")` (donc "H-101" ≡
 * "H101"). RISQUE : cette normalisation pourrait FUSIONNER À TORT deux zones
 * RÉELLES DISTINCTES si leurs codes bruts ne diffèrent que par des caractères
 * non-alphanumériques supprimés — surtout les codes multi-segments où la POSITION
 * du tiret compte (p.ex. "H-10-1" vs "H-101" → tous deux "H101" ; "P-1A" vs
 * "P1-A" → tous deux "P1A"). On CHERCHE ces collisions sur les codes RÉELLEMENT
 * SERVIS en prod.
 *
 * MÉTHODE (lecture seule S3 ; ne DÉPOSE / N'ÉCRIT RIEN sur S3) :
 *   1. LISTE toutes les clés sous normalized/ca-qc-zonage/ ; dérive l'ensemble des
 *      slugs PLAT (qc-zonage-<slug>.geojson) et NICHÉS
 *      (qc-zonage-<slug>/qc-zonage-<slug>.geojson). Réutilise listObjectEntries.
 *   2. COUCHE SERVIE par slug = NICHÉE si présente, sinon PLATE (règle d'autorité
 *      geo-api : le niché est servi quand les deux coexistent — cf.
 *      _zones-layout-authority-scan-20260816.ts). Pour chaque slug servi : lit la
 *      geojson, collecte les zone_code bruts DISTINCTS (trim, non vide, ≠ UNKNOWN),
 *      applique norm(). COLLISION PAR-MUNI = une chaîne normalisée qui provient de
 *      ≥2 codes bruts DISTINCTS dans cette muni = une fusion à tort potentielle.
 *   3. Pour les slugs BOTH, lit AUSSI la couche PLATE (non servie) et rapporte ses
 *      collisions à part (contexte, non servi — n'entre pas dans le verdict).
 *   4. Collision GLOBALE (cross-muni) pour contexte : une chaîne normalisée qui
 *      provient de ≥2 codes bruts distincts à travers TOUTES les munis servies.
 *   5. CLASSIFICATION d'une collision par-muni :
 *        - HARMFUL   : les bruts en collision restent distincts après
 *                      upper-case + suppression des espaces (ils diffèrent donc par
 *                      des séparateurs -,.,/ ou leur POSITION → vraies zones
 *                      distinctes fusionnées à tort). C'est le risque nommé par immo.
 *        - BENIGN    : ils ne diffèrent que par la casse et/ou les espaces (même
 *                      code écrit différemment → la fusion est un no-op sémantique).
 *      Le verdict UNSAFE est piloté par les collisions HARMFUL par-muni ; les
 *      BENIGN sont rapportées telles quelles (transparence, anti-invention).
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-zonecode-norm-collision-20260825.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-zonecode-norm-collision-20260825.json
 *   work/coverage/zones-zonecode-norm-collision-20260825.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getGeoJsonFeatureCollection, listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT_JSON = "work/coverage/zones-zonecode-norm-collision-20260825.json";
const OUT_MD = "work/coverage/zones-zonecode-norm-collision-20260825.md";
const CONCURRENCY = 10;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

/** LA normalisation exacte que immo propose. NE PAS DÉVIER (toUpperCase PUIS strip). */
function norm(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Un code brut est-il "servi/recherchable" (non nul, non vide, ≠ UNKNOWN) ? */
function isRealCode(rawTrim: string): boolean {
  if (!rawTrim) return false;
  if (rawTrim.toUpperCase() === "UNKNOWN") return false;
  return true;
}

interface Feat { properties?: Record<string, unknown> | null }

interface MuniCollision {
  normalized: string;
  raw_codes: string[]; // les bruts distincts (trim) qui collisionnent
  kind: "HARMFUL" | "BENIGN";
}

interface LayerResult {
  key: string;
  feature_count: number;
  distinct_raw_codes: number;
  distinct_raw_list: string[]; // bruts trim distincts réels (interne, pour le global — non sérialisé dans le rapport)
  norm_emptied_codes: string[]; // bruts non vides dont norm() donne "" (contexte)
  collisions: MuniCollision[];
  read_error?: string;
}

/** Classe une collision : HARMFUL si les bruts restent distincts après upper+strip-espaces. */
function classifyCollision(raws: string[]): "HARMFUL" | "BENIGN" {
  const folded = new Set(raws.map((r) => r.toUpperCase().replace(/\s+/g, "")));
  return folded.size >= 2 ? "HARMFUL" : "BENIGN";
}

async function readLayer(
  s3: ReturnType<typeof s3Client>,
  key: string,
): Promise<LayerResult> {
  const base: LayerResult = {
    key, feature_count: 0, distinct_raw_codes: 0, distinct_raw_list: [], norm_emptied_codes: [], collisions: [],
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
      if (norm(rawTrim) === "") { normEmptied.add(rawTrim); continue; }
      distinctRaw.add(rawTrim);
    }
    // Map norm -> bruts distincts.
    const byNorm = new Map<string, Set<string>>();
    for (const rawTrim of distinctRaw) {
      const n = norm(rawTrim);
      let set = byNorm.get(n);
      if (!set) { set = new Set<string>(); byNorm.set(n, set); }
      set.add(rawTrim);
    }
    const collisions: MuniCollision[] = [];
    for (const [n, set] of byNorm) {
      if (set.size >= 2) {
        const raws = [...set].sort();
        collisions.push({ normalized: n, raw_codes: raws, kind: classifyCollision(raws) });
      }
    }
    collisions.sort((a, b) => a.normalized.localeCompare(b.normalized));
    return {
      key,
      feature_count: feats.length,
      distinct_raw_codes: distinctRaw.size,
      distinct_raw_list: [...distinctRaw],
      norm_emptied_codes: [...normEmptied].sort(),
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

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();

  // ── 1. ÉNUMÉRATION ──
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

  // Couche SERVIE par slug (niché-gagne).
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

  // ── 3. DEEP-READ couche PLATE non servie pour les slugs BOTH (contexte) ──
  const altResults = await pool(bothSlugs, CONCURRENCY, async (slug) => {
    const res = await readLayer(s3, flatKeyBySlug.get(slug)!);
    return { slug, res };
  });

  // ── Agrégation SERVIE (autoritative) ──
  const perMuniCollisions: Array<{ slug: string; layout: string; collisions: MuniCollision[] }> = [];
  const readErrors: Array<{ slug: string; layer: string; error: string }> = [];
  let muniChecked = 0;
  const globalByNorm = new Map<string, Set<string>>(); // norm -> bruts distincts (cross-muni)

  for (const { slug, layout, res } of servedResults) {
    if (res.read_error) { readErrors.push({ slug, layer: `served(${layout})`, error: res.read_error }); continue; }
    muniChecked++;
    if (res.collisions.length > 0) perMuniCollisions.push({ slug, layout, collisions: res.collisions });
    // Global cross-muni : chaque brut distinct servi alimente la map norm -> bruts.
    for (const rawTrim of res.distinct_raw_list) {
      const n = norm(rawTrim);
      let set = globalByNorm.get(n);
      if (!set) { set = new Set<string>(); globalByNorm.set(n, set); }
      set.add(rawTrim);
    }
  }

  // Collision GLOBALE = un normalisé provenant de ≥2 bruts distincts à travers TOUTES
  // les munis servies (contexte ; les codes sont scoping-muni donc le per-muni fait foi).
  const globalCollisions = [...globalByNorm.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([n, set]) => ({ normalized: n, raw_codes: [...set].sort(), distinct_raw: set.size }))
    .sort((a, b) => b.distinct_raw - a.distinct_raw || a.normalized.localeCompare(b.normalized));

  // Agrégation contexte (couche plate non servie, slugs BOTH)
  const nonServedCollisions: Array<{ slug: string; collisions: MuniCollision[] }> = [];
  for (const { slug, res } of altResults) {
    if (res.read_error) { readErrors.push({ slug, layer: "non-served(flat)", error: res.read_error }); continue; }
    if (res.collisions.length > 0) nonServedCollisions.push({ slug, collisions: res.collisions });
  }

  // Compteurs
  const harmfulMuni = perMuniCollisions.filter((m) => m.collisions.some((c) => c.kind === "HARMFUL"));
  const benignOnlyMuni = perMuniCollisions.filter((m) => m.collisions.every((c) => c.kind === "BENIGN"));

  const verdict = harmfulMuni.length === 0
    ? (perMuniCollisions.length === 0
        ? "SAFE — 0 per-muni collision, normalization injective on served codes"
        : `SAFE (harmful) — 0 harmful per-muni collision; ${benignOnlyMuni.length} muni(s) have BENIGN case/whitespace-only collisions (merge is a semantic no-op, not a wrong merge of distinct zones)`)
    : `UNSAFE for ${harmfulMuni.length} muni(s) — these raw codes would wrongly merge distinct zones`;

  const report = {
    contract: "zones-zonecode-norm-collision/diagnostic",
    generated_at_utc: new Date().toISOString(),
    question: "immo norm(c)=c.toUpperCase().replace(/[^A-Z0-9]/g,'') — does it wrongly merge distinct served zone_codes per muni?",
    method: {
      s3_prefix: S3_PREFIX,
      served_layer_rule: "nested wins when both flat and nested exist (geo-api authority)",
      norm: "c.toUpperCase().replace(/[^A-Z0-9]/g,'')",
      skip: "null/empty/UNKNOWN raw zone_code; norm-emptied codes reported separately",
      per_muni_collision: ">=2 distinct trimmed raw codes mapping to the same normalized string within one muni",
      harmful_vs_benign: "HARMFUL = raws still distinct after upper-case + whitespace-strip (separator position differs → distinct real zones). BENIGN = differ only by case/whitespace.",
      read_only: true,
    },
    coverage: {
      total_keys_listed: entries.length,
      served_slugs_total: servedSlugs.length,
      munis_checked: muniChecked,
      flat_only: flatOnly.length,
      nested_only: nestedOnly.length,
      both: bothSlugs.length,
    },
    verdict,
    served_per_muni_collisions: {
      muni_with_any_collision: perMuniCollisions.length,
      muni_with_harmful_collision: harmfulMuni.length,
      muni_with_benign_only_collision: benignOnlyMuni.length,
      list: perMuniCollisions,
    },
    global_cross_muni_context: {
      note: "context only — zone_code is municipality-scoped, so per-muni is the authoritative risk. A global collision across two different munis is NOT a wrong merge within immo's per-muni search.",
      normalized_strings_from_2plus_distinct_raw: globalCollisions.length,
      top: globalCollisions.slice(0, 50),
    },
    non_served_flat_layer_context: {
      note: "flat layer for BOTH slugs is NOT served by geo-api (nested wins); reported for completeness only",
      muni_with_collision: nonServedCollisions.length,
      list: nonServedCollisions,
    },
    read_errors: readErrors,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

  // ── Companion .md ──
  const harmfulRows = harmfulMuni.flatMap((m) =>
    m.collisions.filter((c) => c.kind === "HARMFUL").map((c) =>
      `| ${m.slug} | ${m.layout} | \`${c.normalized}\` | ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")} |`,
    ),
  );
  const benignRows = benignOnlyMuni.flatMap((m) =>
    m.collisions.map((c) =>
      `| ${m.slug} | ${m.layout} | \`${c.normalized}\` | ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")} |`,
    ),
  );
  const nonServedRows = nonServedCollisions.flatMap((m) =>
    m.collisions.map((c) =>
      `| ${m.slug} | ${c.kind} | \`${c.normalized}\` | ${c.raw_codes.map((r) => `\`${r}\``).join(" · ")} |`,
    ),
  );

  const md = `# Collision de normalisation des codes de zone servis — ${new Date().toISOString().slice(0, 10)}

**Question (immo).** Normaliser la recherche via
\`norm(c) = c.toUpperCase().replace(/[^A-Z0-9]/g, "")\` (donc \`H-101\` ≡ \`H101\`).
RISQUE : fusionner à tort deux zones RÉELLES DISTINCTES dont les codes bruts ne
diffèrent que par des non-alphanumériques supprimés (surtout la POSITION du tiret :
\`H-10-1\` vs \`H-101\` ; \`P-1A\` vs \`P1-A\`). On cherche ces collisions sur les
codes **réellement servis** en prod (\`sentropic-geo\`, OVH BHS).

## Verdict

**${verdict}**

## Couverture (lecture seule S3, anti-invention)

- clés listées sous \`${S3_PREFIX}\` : **${entries.length}**
- slugs servis (total) : **${servedSlugs.length}**
- **munis vérifiées : ${muniChecked} / ${servedSlugs.length}**
- flat-only : ${flatOnly.length} · nested-only : ${nestedOnly.length} · both : ${bothSlugs.length}
- erreurs de lecture : ${readErrors.length}

## Collisions PAR-MUNI sur la couche SERVIE (autoritatif)

- munis avec ≥1 collision (toute nature) : **${perMuniCollisions.length}**
- munis avec ≥1 collision **HARMFUL** (fusion de zones distinctes) : **${harmfulMuni.length}**
- munis avec collisions **BENIGN uniquement** (casse/espaces — no-op sémantique) : **${benignOnlyMuni.length}**

### HARMFUL — codes bruts distincts qui fusionneraient à tort

| slug | couche | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
${harmfulRows.join("\n") || "| (aucun) | | | |"}

${benignRows.length ? `### BENIGN — casse/espaces uniquement (fusion sans perte de distinction réelle)

| slug | couche | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
${benignRows.join("\n")}
` : "### BENIGN\n\naucune.\n"}
## Contexte — collisions GLOBALES cross-muni

Contexte seulement : \`zone_code\` est scoping-muni, donc le per-muni ci-dessus fait
foi. Une collision entre deux munis différentes n'est **pas** une fusion à tort dans
une recherche immo scopée par muni.

- normalisés provenant de ≥2 bruts distincts (toutes munis servies) : **${globalCollisions.length}**

## Contexte — couche PLATE NON servie (slugs BOTH)

Le geo-api sert le NICHÉ quand les deux coexistent ; la couche plate de ces slugs
n'est **pas servie**. Rapportée pour complétude seulement — hors verdict.

- munis (plate) avec ≥1 collision : **${nonServedCollisions.length}**

${nonServedRows.length ? `| slug | nature | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
${nonServedRows.join("\n")}
` : "aucune.\n"}
## Méthode

1. \`listObjectEntries\` sur \`${S3_PREFIX}\` → slugs plat / niché.
2. Couche servie par slug = niché si présent sinon plat (autorité geo-api).
3. Par muni servie : bruts \`zone_code\` distincts (trim, non vide, ≠ UNKNOWN) → \`norm()\` ;
   collision par-muni = un normalisé provenant de ≥2 bruts distincts.
4. HARMFUL ⟺ bruts encore distincts après upper-case + suppression des espaces
   (⇒ séparateurs/position différents ⇒ vraies zones distinctes). BENIGN sinon.
5. Global cross-muni pour contexte ; par-muni = risque autoritatif (codes scoping muni).
   Numéros MESURÉS ; une muni illisible est notée, jamais devinée.

${readErrors.length ? `## Erreurs de lecture\n\n${readErrors.map((e) => `- ${e.slug} [${e.layer}]: ${e.error}`).join("\n")}\n` : "## Erreurs de lecture\n\naucune.\n"}
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(
    `\n[done] verdict: ${verdict}\n` +
    `[done] munis_checked=${muniChecked}/${servedSlugs.length} ` +
    `per_muni_collision=${perMuniCollisions.length} harmful=${harmfulMuni.length} benign_only=${benignOnlyMuni.length} ` +
    `read_errors=${readErrors.length}\n` +
    `[done] wrote ${OUT_JSON} + ${OUT_MD}\n`,
  );
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
