/**
 * Compteur 'aboutir 167' — partition FERMÉE des 167 villes B′ sur les 4 conditions
 * d'aboutissement (def figée conducteur) : (1) recalage correct, (2) preuve servie
 * vivante URL+SHA archivée S3, (3) réconcilié fold zones+lots, (4) recette verte 7221.
 *
 * Sources (épinglées, lecture seule) :
 *  - Cond1+Cond2 : lane/zones@zones-recalage-status-167 (cities[].recale_status + .bucket),
 *    lui-même dérivé de l'overlap B′ (lane/qa@5ec1d919) — recale_status folde déjà le levier
 *    recalage ; bucket folde déjà l'axe preuve.
 *  - Cond3 : lot-zone-consistency-scale-20260725 (cities[].status/mismatch_pct).
 *  - Cond4 : AUCUNE source recette rejouée committée => INDET pour toutes (état nommé ratifié).
 *  - B′ (radar feat/set-167-canonical@800ee90) : priorityRank par graph_city_slug.
 *
 * Anti-invention : verbatim ou INDET ; jamais un statut fabriqué. La partition FERME à 167
 * (assert ; exit non nul sinon). 'abouti' vaut 0 tant que cond4 est INDET — c'est la vérité.
 *
 * Usage : npx tsx acquisition/src/qa-aboutir-167-counter.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RADAR = "/home/antoinefa/src/radar-immobilier";
// Ré-pinné au status-167 FRAIS post-masse (zones a634175c, dérivé de la matrice
// qa 608c23d2 v2=162). Le précédent (192614Z) était antérieur à la vague de
// capture cluster de 22:00, donc le compteur ne pouvait pas ré-incrémenter.
const RECALAGE_REF = "lane/zones:work/coverage/zones-recalage-status-167-20260803T003500Z.json";
const BPRIME_REF = "800ee90:docs/spec/reports/set-167-bprime.tsv";
const LOTZONE = resolve(ROOT, "work", "coverage", "lot-zone-consistency-scale-20260725.json");
const OUT = resolve(ROOT, "work", "coverage", "aboutir-167-counter-20260803.json");

type Tri = "PASS" | "FAIL" | "INDET";
type Bucket =
  | "abouti"
  | "recalage-manquant"
  | "preuve-morte"
  | "non-reconcilie"
  | "recette-indetermine"
  | "indetermine-amont";

export function classifyBucket(cond1: Tri, cond2: Tri, cond3: Tri, cond4: Tri): Bucket {
  if (cond1 !== "PASS") return "recalage-manquant";
  if (cond2 === "FAIL") return "preuve-morte";
  if (cond2 === "INDET") return "indetermine-amont";
  if (cond3 === "FAIL") return "non-reconcilie";
  if (cond3 === "INDET") return "indetermine-amont";
  if (cond4 === "INDET") return "recette-indetermine";
  return "abouti";
}

export function cond1FromRecale(recaleStatus: string): Tri {
  return recaleStatus === "recale_ok" || recaleStatus === "deja_v2_servi" ? "PASS" : "FAIL";
}
export function cond2FromBucket(bucket: string): Tri {
  if (bucket === "proof_live_verifiable" || bucket === "proof_v1_live") return "PASS";
  if (bucket === "proof_v1_dead") return "FAIL";
  return "INDET"; // no_proof_url_signal ou absent
}
export function cond3FromLotZone(entry: { status?: string; mismatch_pct?: number } | undefined): Tri {
  if (!entry || entry.status !== "measured" || typeof entry.mismatch_pct !== "number") return "INDET";
  return entry.mismatch_pct < 5 ? "PASS" : "FAIL";
}

function gitShow(ref: string, cwd: string): string {
  return execFileSync("git", ["show", ref], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parseBprimePriority(tsv: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = tsv.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"));
  const header = lines[0].split("\t");
  const iGraph = header.indexOf("graph_city_slug");
  const iSlug = header.indexOf("slug");
  const iRank = header.indexOf("priorityRank");
  const iMatch = header.indexOf("match");
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const graph = c[iGraph];
    const slug = c[iSlug];
    const match = c[iMatch];
    const key = graph && match !== "UNMATCHED" ? graph : slug;
    const rank = Number(c[iRank]);
    if (key) map.set(key, Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER);
  }
  return map;
}

function main(): void {
  const recalage = JSON.parse(gitShow(RECALAGE_REF, ROOT)) as {
    cities: Array<{ slug: string; recale_status: string; bucket: string }>;
  };
  const bprimeRank = parseBprimePriority(gitShow(BPRIME_REF, RADAR));
  const lotZone = JSON.parse(readFileSync(LOTZONE, "utf8")) as {
    cities: Array<{ slug: string; status?: string; mismatch_pct?: number }>;
  };
  const lzMap = new Map<string, { status?: string; mismatch_pct?: number }>();
  for (const e of lotZone.cities) lzMap.set(e.slug, e);

  const cities = recalage.cities;
  if (!Array.isArray(cities) || cities.length !== 167) {
    throw new Error(`statut recalage: ${Array.isArray(cities) ? cities.length : "non-array"} villes ≠ 167`);
  }

  const partition: Record<Bucket, number> = {
    abouti: 0,
    "recalage-manquant": 0,
    "preuve-morte": 0,
    "non-reconcilie": 0,
    "recette-indetermine": 0,
    "indetermine-amont": 0,
  };
  const byCond = {
    cond1: { pass: 0, fail: 0 },
    cond2: { pass: 0, fail: 0, indet: 0 },
    cond3: { pass: 0, fail: 0, indet: 0 },
    cond4: { indet: cities.length },
  };
  const villes = cities
    .map((c) => {
      const cond1 = cond1FromRecale(c.recale_status);
      const cond2 = cond2FromBucket(c.bucket);
      const cond3 = cond3FromLotZone(lzMap.get(c.slug));
      const cond4: Tri = "INDET";
      const bucket = classifyBucket(cond1, cond2, cond3, cond4);
      partition[bucket] += 1;
      byCond.cond1[cond1 === "PASS" ? "pass" : "fail"] += 1;
      byCond.cond2[cond2 === "PASS" ? "pass" : cond2 === "FAIL" ? "fail" : "indet"] += 1;
      byCond.cond3[cond3 === "PASS" ? "pass" : cond3 === "FAIL" ? "fail" : "indet"] += 1;
      return {
        slug: c.slug,
        priorityRank: bprimeRank.get(c.slug) ?? Number.MAX_SAFE_INTEGER,
        bucket,
        cond1,
        cond2,
        cond3,
        cond4,
      };
    })
    .sort((a, b) => a.priorityRank - b.priorityRank || a.slug.localeCompare(b.slug));

  const total = Object.values(partition).reduce((s, n) => s + n, 0);
  const payload = {
    contract: "aboutir-167-counter/v1",
    generated_from: "compteur qa (script committé, run local déterministe)",
    provenance: {
      bprime: "radar feat/set-167-canonical@800ee90 (PREVIEW, PR #436 non mergée)",
      cond1_recalage_cond2_preuve: `${RECALAGE_REF} (folde recale_status + bucket overlap 5ec1d919)`,
      cond3_reconcilie: "work/coverage/lot-zone-consistency-scale-20260725.json",
      cond4_recette: "INDET (aucune source rejeu 7221 committée)",
    },
    revalidation_pending: "re-valider B′ au merge PR #436 ; câbler cond4 quand rejeu recette-7221 committé",
    partition: { ...partition, total },
    par_condition: byCond,
    villes,
  };
  if (total !== 167) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
    throw new Error(`partition ne ferme pas : total=${total} ≠ 167`);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { out: "work/coverage/aboutir-167-counter-20260802.json", partition: payload.partition, par_condition: byCond },
      null,
      1,
    ),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
