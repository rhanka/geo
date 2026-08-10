#!/usr/bin/env node
/**
 * Reproducible §2 N-A ELIGIBILITY audit for KPI 7 (effet_densifiant) over the
 * 167-city palier cohort.
 *
 * SPEC_PALIER_RESOLUTION §2 defines N-A PROUVÉ for effet_densifiant as:
 *   "absence d'EEV documentée : 0 avis public + 0 certificat MRC 137.3 après
 *    recherche exhaustive tracée."
 *
 * This audit tests whether the AUTHORITATIVE effet_densifiant source (the
 * B-prime acquisition universe) can, on its own, establish that §2 criterion for
 * any non-complete cohort city. It CANNOT, and this script proves it by
 * construction rather than by assertion:
 *
 *   The B-prime `universe_rule` is "B' served, no known effect, zero finite
 *   densite_value features". Every non-`known` B-prime state
 *   (absent | unknown_only | unserved | absent-from-source) is a verdict about
 *   the DENSITY-PAIRING computation (can we pair a before/after densité delta?),
 *   NOT about the existence of an entry-into-force instrument. A city can — and
 *   in the measured plafond documentaire routinely does — carry a real avis
 *   public / EEV while still failing to pair a delta (amendment does not overlap
 *   the original grille, prior grille absent, verbatim date missing, archive
 *   truncated). "0 paired delta" is ORTHOGONAL to "0 avis public + 0 certificat".
 *
 * Therefore no B-prime state satisfies §2, and the number of §2-legitimate N-A
 * proofs derivable from this source for the cohort is 0. Relabelling any of these
 * unknown/incomplete cells N-A would be invention (SPEC_PALIER_RESOLUTION §1,
 * "Règle d'or") — the density ring in this cohort (Longueuil, Brossard,
 * Westmount, Terrebonne, Saint-Jean-sur-Richelieu, Joliette, …) publishes avis
 * publics; "0 avis public" is factually false for them.
 *
 * Output: work/coverage/na-eligibility-effet-palier-<date>.json — a per-city,
 * per-state census with the ineligibility reason, so the "0 legitimate N-A"
 * conclusion is machine-checkable and re-playable on a clean checkout.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10).replaceAll("-", "");

function absolute(p) { return resolve(REPO_ROOT, p); }
function readJson(p) { return JSON.parse(readFileSync(absolute(p), "utf8")); }
function invariant(c, m) { if (!c) throw new Error(`Validation failed: ${m}`); }

// Mirror generate-completion-regdens.mjs source selection exactly.
function latestCoverageFile(pattern, timestampField) {
  const candidates = readdirSync(absolute("work/coverage"))
    .filter((name) => pattern.test(name))
    .map((name) => {
      const relativePath = `work/coverage/${name}`;
      const data = readJson(relativePath);
      const timestamp = data[timestampField];
      invariant(typeof timestamp === "string" && timestamp.length > 0,
        `${relativePath} is missing ${timestampField}`);
      return { relativePath, data, timestamp };
    })
    .sort((l, r) => l.timestamp.localeCompare(r.timestamp)
      || l.relativePath.localeCompare(r.relativePath));
  invariant(candidates.length > 0, `no coverage file matches ${pattern}`);
  return candidates.at(-1);
}

// Alias whitelist — byte-identical to the generator's PALIER_SLUG_ALIASES.
const PALIER_SLUG_ALIASES = {
  "saint-isidore-roussillon": "saint-isidore--roussillon",
  "saint-damase-les-maskoutains": "saint-damase--les-maskoutains",
  "hemmingford-les-jardins-de-napierville": "hemmingford--les-jardins-de-napierville",
  "saint-louis-de-gonzague-beauharnois-salaberry": "saint-louis-de-gonzague--beauharnois-salaberry",
  "hemmingford-les-jardins-de-napierville-2": "hemmingford--les-jardins-de-napierville--2",
  "saint-sebastien-le-haut-richelieu": "saint-sebastien--le-haut-richelieu",
  "sainte-sabine-brome-missisquoi": "sainte-sabine--brome-missisquoi",
};

const catalog = readJson("packages/qc-sources/src/geo/municipalities.qc.json");
const catalogSlugs = new Set(catalog.map(({ slug }) => slug));

const cohort = readJson("work/coverage/palier-cohort-167.json");
invariant(Array.isArray(cohort.cities) && cohort.cities.length === 167,
  "palier cohort must carry 167 cities");

const bprime = latestCoverageFile(/^effet-densifiant-bprime-acquisition-universe-.*\.json$/, "universe_rule");
const effectBySlug = new Map(bprime.data.rows.map((r) => [r.slug, r]));

// B-prime state -> derived effet_densifiant status (mirror of the generator).
const STATE_TO_STATUS = new Map([
  ["known", "complete"],
  ["absent", "incomplete"],
  ["unknown_only", "unknown"],
  ["unserved", "unknown"],
]);

// Why each non-complete B-prime state is ORTHOGONAL to §2 (0 avis public + 0
// certificat 137.3). None of these is a traced search for the legal instrument;
// each is a verdict on density-delta pairing.
const INELIGIBILITY_REASON = {
  absent: "B-prime 'absent' = servi + normes de densité présentes mais 0 delta apparié "
    + "(amendement non recouvrant / grille AVANT absente / date non verbatim). L'instrument "
    + "peut exister (ex. amherst 602-25) — §2 '0 avis public' NON établi.",
  unknown_only: "B-prime 'unknown_only' = 0 feature de densité exploitable → indéterminé. "
    + "SPEC §1 interdit de relabel un UNKNOWN en N-A sans preuve d'absence.",
  unserved: "B-prime 'unserved' = collection non servie → indéterminé, pas une absence "
    + "d'avis public prouvée.",
  "absent-from-source": "Slug absent de l'univers B-prime → aucune observation, indéterminé.",
};

const census = { known: 0, absent: 0, unknown_only: 0, unserved: 0, "absent-from-source": 0 };
const rows = [];
let eligible = 0;

for (const { slug } of cohort.cities) {
  const geoSlug = catalogSlugs.has(slug) ? slug : PALIER_SLUG_ALIASES[slug];
  invariant(geoSlug !== undefined && catalogSlugs.has(geoSlug),
    `cohort slug does not resolve to catalogue: ${slug}`);
  const row = effectBySlug.get(geoSlug);
  const bstate = row === undefined ? "absent-from-source" : row.state;
  invariant(bstate in census, `unexpected B-prime state ${bstate} for ${geoSlug}`);
  census[bstate] += 1;
  const status = row === undefined ? "unknown" : STATE_TO_STATUS.get(row.state);
  if (status === "complete") continue;
  // §2 eligibility verdict — deterministically ineligible for every non-complete state.
  rows.push({
    geo_slug: geoSlug,
    bprime_state: bstate,
    derived_status: status,
    primary_cause: row?.primary_cause ?? null,
    s2_na_eligible: false,
    reason: INELIGIBILITY_REASON[bstate],
  });
}

const audit = {
  contract: "na-eligibility-effet-palier/v1",
  as_of: `${OUTPUT_DATE.slice(0, 4)}-${OUTPUT_DATE.slice(4, 6)}-${OUTPUT_DATE.slice(6, 8)}`,
  kpi: "effet_densifiant",
  criterion: "SPEC_PALIER_RESOLUTION §2 : N-A PROUVÉ ssi 0 avis public + 0 certificat MRC 137.3 "
    + "après recherche exhaustive tracée.",
  source_bprime: bprime.relativePath,
  bprime_universe_rule: bprime.data.universe_rule,
  cohort: cohort.cohort ?? "palier-167",
  cohort_size: cohort.cities.length,
  finding: "Aucun état B-prime (absent|unknown_only|unserved|absent-from-source) n'établit "
    + "l'absence d'avis public / certificat 137.3 : la source mesure le PAIRAGE de densité, "
    + "orthogonal à l'existence de l'instrument légal. Le plafond '8/141' est known_effect "
    + "(succès de PREUVE d'effet), PAS l'existence d'EEV. Levier réel de col 7 = PROUVER plus "
    + "d'effets (acquisition d'états de grille antérieurs) OU amendement owner+immo du critère §2.",
  bprime_state_census: census,
  s2_legitimate_na_count: eligible,
  non_complete_cells: rows.length,
  rows,
};

const OUT = `work/coverage/na-eligibility-effet-palier-${OUTPUT_DATE}.json`;
writeFileSync(absolute(OUT), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUT,
  source_bprime: bprime.relativePath,
  bprime_universe_rule: bprime.data.universe_rule,
  cohort_size: audit.cohort_size,
  bprime_state_census: census,
  non_complete_cells: rows.length,
  s2_legitimate_na_count: eligible,
}, null, 2));
