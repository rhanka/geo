/**
 * Sonde READ-ONLY : résume un artefact `lot-zone-consistency-scale-*.json` —
 * agrégat `totals` + entrées par-ville nommées + méthode/couverture/timestamps.
 * Sert à réconcilier le CHIFFRE col-2 (owner=geo-cond) entre deux scales datés
 * (photo périmée vs main courant) sans re-parser à la main. Aucune écriture.
 * Usage :
 *   npx tsx acquisition/src/_col2-scale-summary.ts --path <scale.json> \
 *     [--cities amherst,beaupre,boischatel,mille-isles,saint-raphael]
 */
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

interface CityEntry {
  slug: string;
  denom?: number; assigned?: number; mismatch?: number; residue_hard?: number;
  coherent?: number; unknown_eval_unit?: number; outside_all?: number;
  mismatch_pct?: number; conclusive?: boolean;
}
interface Scale {
  generatedAt?: string; asOfS3Listing?: string;
  method?: { spec?: string; bands?: unknown };
  coverage?: { measured?: number; attempted?: number; still_pending?: number };
  totals?: Record<string, number>;
  cities?: CityEntry[];
}

function main(): void {
  const path = arg("path");
  if (!path) { process.stderr.write("--path <scale.json> requis\n"); process.exit(2); }
  const s = JSON.parse(readFileSync(path, "utf8")) as Scale;
  const cityNames = (arg("cities") ?? "amherst,beaupre,boischatel,mille-isles,saint-raphael")
    .split(",").map((c) => c.trim()).filter(Boolean);

  const out: Record<string, unknown> = {
    path,
    generatedAt: s.generatedAt ?? null,
    asOfS3Listing: s.asOfS3Listing ?? null,
    method_spec: s.method?.spec ?? null,
    coverage: s.coverage ?? null,
    totals: s.totals ?? null,
  };
  const wanted = new Set(cityNames);
  const cities = (s.cities ?? []).filter((c) => wanted.has(c.slug)).map((c) => ({
    slug: c.slug, denom: c.denom, assigned: c.assigned, mismatch: c.mismatch,
    residue_hard: c.residue_hard, coherent: c.coherent,
    unknown_eval_unit: c.unknown_eval_unit, outside_all: c.outside_all,
    mismatch_pct: c.mismatch_pct, conclusive: c.conclusive,
  }));
  out["cities"] = cities;
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
