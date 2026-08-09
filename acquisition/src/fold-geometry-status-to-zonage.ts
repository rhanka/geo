/**
 * fold-geometry-status-to-zonage.ts — sert l'indicateur `zone_geometry_status` à immo.
 *
 * Le chantier "chasse aux zones non-contigües" (owner + immo) produit
 * work/coverage/zone-contiguity.json : par ville, un statut de QUALITÉ GÉOMÉTRIQUE de
 * la zone servie ∈ {clean, suspect, fragmented, dispersed} (cf zone-contiguity-audit.ts),
 * plus les zone_codes fautifs. Ce rapport vit dans work/ — immo ne le voit pas. immo lit
 * les COLLECTIONS POLYGONE `qc-zonage-<slug>` (S3 `normalized/ca-qc-zonage/…`) en
 * passthrough OGC (cf mémoire immo-geo-data-contract). Pour que l'« indicateur spécial
 * pour ces villes » soit consommable, il faut le STAMPER sur le polygone servi.
 *
 * Ce tool copie, sur CHAQUE feature de `qc-zonage-<slug>` :
 *   - `zone_geometry_status`  : statut ville (constant sur toutes les features).
 *   - `zone_geometry_flagged` : booléen — true si le `zone_code` de CETTE feature est un
 *                               code fautif (dispersed_urban_zones ∪ over_fragmented_zones),
 *                               pour qu'immo puisse surligner la zone précise, pas juste la ville.
 *
 * Anti-invention : ne stampe QUE les villes présentes dans le rapport avec un statut réel
 * (ni `missing`, ni entrée `read-error`). Idempotent. Réversible (--strip). Immunisé contre
 * la double clé S3 (plat + sous-dossier) — stampe CHAQUE clé existante (mémoire
 * fold-double-key-s3-serving : geo-api sert la clé sous-dossier).
 *
 * Usage (npx tsx, depuis la racine) :
 *   npx tsx acquisition/src/fold-geometry-status-to-zonage.ts --dry-run           # toutes les villes auditées
 *   npx tsx acquisition/src/fold-geometry-status-to-zonage.ts --only-flagged --dry-run  # seulement non-clean
 *   npx tsx acquisition/src/fold-geometry-status-to-zonage.ts --only-flagged      # sert l'indicateur spécial
 *   npx tsx acquisition/src/fold-geometry-status-to-zonage.ts --strip --slugs a,b # retire
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = resolve(ROOT, "work", "coverage", "zone-contiguity.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const STATUS_FIELD = "zone_geometry_status";
const FLAG_FIELD = "zone_geometry_flagged";

type Status = "clean" | "suspect" | "fragmented" | "dispersed";
interface CityReport {
  slug: string;
  status: Status;
  dispersed_urban_zones?: string[];
  over_fragmented_zones?: string[];
  note?: string;
}
interface Report { cities: CityReport[] }

type S3 = ReturnType<typeof s3Client>;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Clés S3 du polygone zonage: layout plat ET sous-dossier — les DEUX quand elles coexistent. */
async function zonageKeys(s3: S3, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const k of candidates) if (await exists(s3, k)) keys.push(k);
  return keys;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const onlyFlagged = argv.includes("--only-flagged");
  const slugFilter = new Set((arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const report = JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  let cities = report.cities.filter((c) => c.status && !c.note); // drop missing / read-error
  if (onlyFlagged) cities = cities.filter((c) => c.status !== "clean");
  if (slugFilter.size) cities = cities.filter((c) => slugFilter.has(c.slug));

  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  const byStatus: Record<string, number> = {};
  for (const city of cities) {
    const keys = await zonageKeys(s3, city.slug);
    if (keys.length === 0) { skipped.push(`${city.slug} (polygone non servi)`); continue; }
    const flagged = new Set<string>([...(city.dispersed_urban_zones ?? []), ...(city.over_fragmented_zones ?? [])]);
    for (const key of keys) {
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
      const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
      let changed = 0;
      for (const f of feats) {
        f.properties = f.properties ?? {};
        if (strip) {
          if (STATUS_FIELD in f.properties) { delete f.properties[STATUS_FIELD]; changed++; }
          if (FLAG_FIELD in f.properties) { delete f.properties[FLAG_FIELD]; changed++; }
        } else {
          const code = typeof f.properties["zone_code"] === "string" ? (f.properties["zone_code"] as string) : "";
          const isFlagged = flagged.has(code);
          if (f.properties[STATUS_FIELD] !== city.status) { f.properties[STATUS_FIELD] = city.status; changed++; }
          if (f.properties[FLAG_FIELD] !== isFlagged) { f.properties[FLAG_FIELD] = isFlagged; changed++; }
        }
      }
      // Additive provenance write: geometry proven byte-identical, only the two
      // zone_geometry_* keys may differ (see putServedZoneAdditive).
      if (changed > 0 && !dryRun) await putServedZoneAdditive(s3, key, fc, { allowedProps: [STATUS_FIELD, FLAG_FIELD] });
      console.log(`${dryRun ? "DRY " : "OK  "}${city.slug} status=${city.status} flaggedZones=${flagged.size} features=${feats.length} changed=${changed} key=${key}`);
    }
    byStatus[city.status] = (byStatus[city.status] ?? 0) + 1;
    ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  const dist = Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`DONE ok=${ok}/${cities.length} skipped=${skipped.length} [${dist}]${dryRun ? " (dry-run)" : ""}${strip ? " (strip)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
