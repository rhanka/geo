/**
 * Sonde one-off : dumpe les lignes de matrice des 3 villes ORPHAN de la cohorte-30
 * pour comprendre la cause (linkage vs absence) avant fix presence.
 */
import { readFileSync } from "node:fs";
const MATRIX = "work/coverage/zone-provenance-quality-matrix-20260803T001639Z-81de8d776a7d73c9.json";
const SLUGS = new Set(["hampstead", "cote-saint-luc", "dorval"]);
const root = JSON.parse(readFileSync(MATRIX, "utf8")) as { rows?: Array<Record<string, unknown>>; quality_status_policy?: unknown };
const pol = (root.quality_status_policy ?? null) as Record<string, unknown> | null;
process.stdout.write(`policy.orphan = ${JSON.stringify(pol?.orphan ?? null)}\n\n`);
for (const r of root.rows ?? []) {
  if (typeof r.city_slug === "string" && SLUGS.has(r.city_slug)) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n\n`);
  }
}
