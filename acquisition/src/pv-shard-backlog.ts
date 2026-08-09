/**
 * pv-shard-backlog.ts — LECTURE PURE : liste le backlog PV (municipalités dont la
 * couche pv n'est PAS `done`), classé par voie et découpé en shards pour la
 * coordination multi-agents du /loop.
 *
 * Aucun réseau, aucun LLM, aucune écriture. Ne modifie JAMAIS la matrice — il la
 * LIT (`work/coverage/coverage-matrix.json`) et croise `ALL_PV_CITIES` pour
 * distinguer :
 *   - `configured` : slug ∈ ALL_PV_CITIES (config CMS présente) → track
 *     `scraper-configured`, décollage via `pv-index-run.ts --slugs <slug>`.
 *   - `new`        : slug ∉ ALL_PV_CITIES (CMS à câbler / à découvrir) → track
 *     `scraper-new`, décollage via `pv-gonet-run.ts --slugs <slug> --static`.
 *
 * Sharding déterministe et STABLE : le backlog PV non-done est trié par slug
 * (ordre alphabétique, identique pour tous les agents), indexé globalement, et
 * filtré `globalIndex % mod === idx`. Deux agents avec le même `mod` et des `idx`
 * distincts obtiennent des tranches disjointes ; les runners restant idempotents
 * (skip-existing sur S3), un chevauchement éventuel ne fait que du travail
 * redondant, jamais de double dépôt.
 *
 * Usage :
 *   npx tsx src/pv-shard-backlog.ts --mod 3 --idx 2            # ma tranche
 *   npx tsx src/pv-shard-backlog.ts --mod 3 --idx 2 --track configured
 *   npx tsx src/pv-shard-backlog.ts --mod 1 --idx 0            # backlog complet
 *
 * Flags :
 *   --mod N     nombre de shards (défaut 1)
 *   --idx K     index de ce shard, 0 ≤ K < N (défaut 0)
 *   --track T   filtre : `configured` | `new` | `all` (défaut all)
 *   --slugs-only   n'imprime que la liste CSV des slugs (pour piper dans --slugs)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

const HERE = dirname(fileURLToPath(import.meta.url)); // acquisition/src
const MATRIX_PATH = resolve(HERE, "../../work/coverage/coverage-matrix.json");

type CoverageStatus = "done" | "planned" | "to-research";
interface PvCell {
  readonly status?: CoverageStatus;
  readonly candidateTracks?: readonly string[];
  readonly notes?: string;
  readonly doneTrack?: string;
}
interface Matrix {
  readonly cities?: Record<string, { readonly pv?: PvCell }>;
}

interface Args {
  mod: number;
  idx: number;
  track: "configured" | "new" | "all";
  slugsOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const track = (get("track") ?? "all") as Args["track"];
  return {
    mod: Math.max(1, Number(get("mod") ?? "1")),
    idx: Math.max(0, Number(get("idx") ?? "0")),
    track: track === "configured" || track === "new" ? track : "all",
    slugsOnly: has("slugs-only"),
  };
}

interface BacklogRow {
  readonly slug: string;
  readonly status: CoverageStatus;
  readonly kind: "configured" | "new";
  readonly notes: string | undefined;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8")) as Matrix;
  const configured = new Set(ALL_PV_CITIES.map((c) => c.config.citySlug));

  // Backlog PV = toute ville dont pv.status !== "done". Tri STABLE par slug pour
  // un sharding identique chez tous les agents.
  const rows: BacklogRow[] = Object.entries(matrix.cities ?? {})
    .filter(([, c]) => (c.pv?.status ?? "to-research") !== "done")
    .map(([slug, c]) => ({
      slug,
      status: (c.pv?.status ?? "to-research") as CoverageStatus,
      kind: configured.has(slug) ? ("configured" as const) : ("new" as const),
      notes: c.pv?.notes,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  // Shard sur le backlog GLOBAL (avant filtre de track) pour que les tranches
  // restent disjointes et stables quel que soit le --track demandé.
  const mine = rows.filter((_, i) => i % args.mod === args.idx);
  const filtered =
    args.track === "all" ? mine : mine.filter((r) => r.kind === args.track);

  if (args.slugsOnly) {
    console.log(filtered.map((r) => r.slug).join(","));
    return;
  }

  const totalConfigured = rows.filter((r) => r.kind === "configured").length;
  const totalNew = rows.filter((r) => r.kind === "new").length;
  const myConfigured = mine.filter((r) => r.kind === "configured");
  const myNew = mine.filter((r) => r.kind === "new");

  console.log(
    `[pv-backlog] non-done total=${rows.length} (configured=${totalConfigured} new=${totalNew})`,
  );
  console.log(
    `[shard mod=${args.mod} idx=${args.idx}] mine=${mine.length} (configured=${myConfigured.length} new=${myNew.length})`,
  );
  console.log(`\n=== MY SHARD — scraper-configured (priorité 1) ===`);
  console.log(myConfigured.map((r) => `${r.slug}\t${r.status}`).join("\n") || "(aucune)");
  console.log(`CSV: ${myConfigured.map((r) => r.slug).join(",")}`);
  console.log(`\n=== MY SHARD — scraper-new (priorité 2) ===`);
  console.log(myNew.map((r) => `${r.slug}\t${r.status}`).join("\n") || "(aucune)");
  console.log(`CSV: ${myNew.map((r) => r.slug).join(",")}`);
}

main();
