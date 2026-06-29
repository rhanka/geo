/**
 * request-manager.ts — Gestionnaire de demandes d'acquisition geo (cadre
 * province-wide).
 *
 * Port fidèle de `acquisition/request_manager.py`. Intake (city, data_types) ->
 * valide périmètre -> état/couverture -> plan -> track. Ce module = le cœur du
 * cadre ; les orchestrateurs (grid/bylaw/lot-attrs) sont branchés ensuite.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API = "https://api.geo.sent-tech.ca/collections";
const REGISTRY = "/home/antoinefa/src/_acquisition-shared/acquisition-registry.json";
const DIRECTORY = "/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json";

export type Coverage =
  | { zoning_grid: string; lots_geom: string; zoning_bylaw: string; lot_attributes: string }
  | { _: string };

type Registry = Record<string, Record<string, unknown>>;

/** Récupère les ids des collections servies par l'API geo. */
export async function servedIds(): Promise<Set<string>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(API, { signal: ctrl.signal });
    const d = (await res.json()) as { collections?: { id: string }[] };
    return new Set((d.collections ?? []).map((c) => c.id));
  } finally {
    clearTimeout(t);
  }
}

/** Périmètre geo = municipalité QC connue de l'annuaire. */
export function inScope(slug: string, annuaire: Set<string>): boolean {
  if (annuaire.has(slug)) return true;
  for (const k of annuaire) {
    if (slug === k || slug.startsWith(k)) return true;
  }
  return false;
}

export function coverage(slug: string, ids: Set<string>): Coverage {
  const grid = ids.has("qc-zonage-" + slug);
  const lots = ids.has("qc-lots-" + slug);
  const reg = (loadRegistry()[slug] ?? {}) as Record<string, unknown>;
  return {
    zoning_grid: grid ? "served" : "missing",
    lots_geom: lots ? "served" : "missing",
    zoning_bylaw: (reg["zoning_bylaw"] as string) ?? "missing",
    lot_attributes: (reg["lot_attributes"] as string) ?? "missing",
  };
}

export function loadRegistry(): Registry {
  if (existsSync(REGISTRY)) {
    try {
      return JSON.parse(readFileSync(REGISTRY, "utf8")) as Registry;
    } catch {
      return {};
    }
  }
  return {};
}

export function saveRegistry(r: Registry): void {
  writeFileSync(REGISTRY, JSON.stringify(r, null, 0));
}

export async function handleBatch(
  cities: string[],
  annuaire: Set<string>,
): Promise<[string, boolean, Coverage][]> {
  const ids = await servedIds();
  const reg = loadRegistry();
  const rows: [string, boolean, Coverage][] = [];
  for (const c of cities) {
    const scope = inScope(c, annuaire);
    const cov: Coverage = scope ? coverage(c, ids) : { _: "hors-périmètre" };
    reg[c] = { ...(reg[c] ?? {}), last_seen_coverage: cov, in_scope: scope };
    rows.push([c, scope, cov]);
  }
  saveRegistry(reg);
  return rows;
}

/** Padding à droite (ljust) reproduisant `f"{s:width}"` de Python. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

async function main(): Promise<void> {
  // annuaire (slugs municipaux QC)
  let annuaire = new Set<string>();
  try {
    const ann = JSON.parse(readFileSync(DIRECTORY, "utf8")) as unknown;
    if (Array.isArray(ann)) {
      annuaire = new Set(
        (ann as { slug?: string }[]).map((x) => x.slug).filter((s): s is string => !!s),
      );
    } else if (ann && typeof ann === "object") {
      annuaire = new Set(Object.keys(ann as Record<string, unknown>));
    }
  } catch {
    annuaire = new Set();
  }
  const cities = process.argv.slice(2);
  const rows = await handleBatch(cities, annuaire);
  console.log(
    `${pad("VILLE", 40)} ${pad("scope", 6)} ${pad("grille", 8)} ${pad("lots", 8)} ` +
      `${pad("règlement", 10)} ${pad("attr-lot", 9)}`,
  );
  for (const [c, sc, cov] of rows) {
    const g = "zoning_grid" in cov ? cov.zoning_grid : "?";
    const l = "lots_geom" in cov ? cov.lots_geom : "?";
    const b = "zoning_bylaw" in cov ? cov.zoning_bylaw : "?";
    const al = "lot_attributes" in cov ? cov.lot_attributes : "?";
    console.log(
      `${pad(c, 40)} ${pad(sc ? "oui" : "NON", 6)} ${pad(g, 8)} ${pad(l, 8)} ` +
        `${pad(b, 10)} ${pad(al, 9)}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
