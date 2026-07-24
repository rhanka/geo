/**
 * fold-zone-source-to-zonage.ts — zone source URL + proof level, servi (2026-07-24).
 *
 * Le propriétaire veut voir l'URL source géométrique historique ET son niveau de
 * preuve sur la donnée SERVIE qc-zonage-<slug>, pas seulement dans un rapport
 * work/coverage. Ce tool stampe deux propriétés additives sur CHAQUE feature de
 * chaque polygone `qc-zonage-<slug>` (S3 `normalized/ca-qc-zonage/…`):
 *   - zone_source_url   : l'URL source géométrique historique EXACTE réellement
 *                          conservée pour cette collection, sinon `null`.
 *   - zone_source_level : "historical-verified" | "legacy-traceable" | "candidate"
 *                          | "orphan" | "unknown".
 *
 * Reprend le patron de `fold-reglement-to-zonage.ts` (additif, DEUX clés S3 flat +
 * sous-dossier, idempotent, réversible avec `--strip`, `--slugs`/`--all`/`--dry-run`).
 * ÉCRITURE — depuis le commit `428cba4` (2026-07-22, "feat(proof): enforce exact
 * served-zone sources"), `putBytes` de `./lib/s3.ts` REFUSE toute écriture directe
 * sur une clé `qc-zonage-<slug>` servie. La route de DÉPÔT D'UNE NOUVELLE GÉOMÉTRIE
 * (`putServedZoneGeojson`) exige une preuve v2 COMPLÈTE que la plupart des 871
 * collections legacy/quarantaine ne portent pas encore. Ce fold n'ajoute PAS de
 * géométrie: il stampe deux propriétés de PROVENANCE. Il passe donc par
 * `putServedZoneAdditive` (`./lib/zonage-proof.ts`), le chemin additif sûr, qui
 * PROUVE que la géométrie servie est octet-pour-octet INCHANGÉE (même nombre/ordre
 * de features, mêmes coordonnées) et n'autorise QUE l'ajout/màj des clés de
 * provenance whitelistées (`zone_source_url`, `zone_source_level`). Le gate de
 * preuve géométrique reste STRICT: aucune nouvelle géométrie ne peut passer ici.
 *
 * Mapping ville -> (url, niveau): dérivé DIRECTEMENT des 3 rapports committés
 * 2026-07-22 (aucun export par-ville prêt-à-l'emploi trouvé sous work/coverage —
 * `zone-provenance-quality-matrix-20260723-*.json` est bien indexé par ville mais
 * ne porte que des jetons de citation, pas l'URL en clair):
 *   - work/coverage/zone-provenance-status-manifest-20260722.json  (871 lignes,
 *     jointure faite une fois pour toutes: slug, provenance_state, source_origin
 *     h|q, source_identity_ref "h:<n>:i"/"q:<n>:i")
 *   - work/coverage/proof-legacy-515-historical-20260722.json      (source "h")
 *   - work/coverage/proof-orphan-356-reconciliation-20260722.json  (source "q")
 *
 * Anti-invention stricte — AUCUNE URL n'est jamais devinée/normalisée/reconstruite:
 *   - source "h": `candidate_source_identity.url_component` (PAS `.exact`, qui peut
 *     porter une annotation humaine concaténée en 13/515 cas — vérifié: le "split
 *     sans perte" documenté par le rapport rend `url_component` la sous-chaîne URL
 *     pure). Toujours une URL http(s) sur les 515 (vérifié).
 *   - source "q": `source_identity.url` UNIQUEMENT (kinds `source-pdf-url` et
 *     `arcgis-layer`, 14/356). `source_identity.kind==="wfs-layer"` porte un
 *     `service_root` SANS le `type_name` qui identifie la couche — les combiner
 *     serait reconstruire une URL non retenue littéralement telle quelle, donc
 *     EXCLU (22/356 restent null malgré un `service_root` retenu). `kind===
 *     "local-source-pdf"` est un CHEMIN LOCAL, pas une URL: EXCLU (93/356).
 *   - Sinon (orphan sans identité, ref manquante, ou slug absent du manifeste
 *     871): `zone_source_url=null`.
 *
 * Niveau — passthrough honnête de la classification déjà portée par les rapports
 * (ils encodent déjà exactement la distinction demandée: "historical-verified"
 * SEULEMENT si l'octet source exact est conservé; "legacy-traceable" pour une
 * lignée historique sans octet vérifié — ce n'est PAS une preuve de correction
 * courante):
 *   provenance_state "historical-verified"                  -> "historical-verified"
 *   provenance_state "legacy-traceable"                      -> "legacy-traceable"
 *   provenance_state "candidate-needs-human-confirmation"     -> "candidate"
 *   provenance_state "orphan"                                 -> "orphan"
 *   slug absent des 871 lignes du manifeste                   -> "unknown" (url=null)
 *
 * Usage (npx tsx, from acquisition/):
 *   npx tsx src/fold-zone-source-to-zonage.ts --slugs adstock,abercorn --dry-run
 *   npx tsx src/fold-zone-source-to-zonage.ts --all --dry-run
 *   npx tsx src/fold-zone-source-to-zonage.ts --all
 *   npx tsx src/fold-zone-source-to-zonage.ts --all --strip
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE_DIR = resolve(ROOT, "work", "coverage");
const LEGACY_PATH = resolve(COVERAGE_DIR, "proof-legacy-515-historical-20260722.json");
const ORPHAN_PATH = resolve(COVERAGE_DIR, "proof-orphan-356-reconciliation-20260722.json");
const MANIFEST_PATH = resolve(COVERAGE_DIR, "zone-provenance-status-manifest-20260722.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const URL_FIELD = "zone_source_url";
const LEVEL_FIELD = "zone_source_level";

export type ZoneSourceLevel = "historical-verified" | "legacy-traceable" | "candidate" | "orphan" | "unknown";
export interface ZoneSourceLink { url: string | null; level: ZoneSourceLevel }

const HTTP_URL = /^https?:\/\//;

function mapProvenanceState(state: unknown): ZoneSourceLevel {
  switch (state) {
    case "historical-verified": return "historical-verified";
    case "legacy-traceable": return "legacy-traceable";
    case "candidate-needs-human-confirmation": return "candidate";
    case "orphan": return "orphan";
    default: throw new Error(`manifeste: provenance_state inattendu ${JSON.stringify(state)}`);
  }
}

function fieldIndex(fields: string[], name: string): number {
  const i = fields.indexOf(name);
  if (i < 0) throw new Error(`manifeste: champ manquant ${name}`);
  return i;
}

/**
 * Construit slug -> {url, level} en joignant le manifeste 871 lignes avec les
 * deux rapports sources via `source_identity_ref` ("h:<n>:i" / "q:<n>:i").
 * Aucun réseau, aucune écriture: lecture locale seule des 3 fichiers committés.
 */
function buildLinks(): Map<string, ZoneSourceLink> {
  const legacy = JSON.parse(readFileSync(LEGACY_PATH, "utf8")) as {
    collections: Array<{ slug: string; candidate_source_identity?: { url_component?: unknown } }>;
  };
  const orphan = JSON.parse(readFileSync(ORPHAN_PATH, "utf8")) as {
    collections: Array<{ slug: string; source_identity?: { url?: unknown } | null }>;
  };
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { row_fields: string[]; rows: unknown[][] };

  const iSlug = fieldIndex(manifest.row_fields, "slug");
  const iState = fieldIndex(manifest.row_fields, "provenance_state");
  const iRef = fieldIndex(manifest.row_fields, "source_identity_ref");

  const links = new Map<string, ZoneSourceLink>();
  for (const row of manifest.rows) {
    const slug = row[iSlug] as string;
    const level = mapProvenanceState(row[iState]);
    const ref = row[iRef] as string | null;
    const m = typeof ref === "string" ? /^([hq]):(\d+):i$/.exec(ref) : null;
    let url: string | null = null;
    if (m) {
      const n = Number(m[2]);
      if (m[1] === "h") {
        const uc = legacy.collections[n]?.candidate_source_identity?.url_component;
        if (typeof uc === "string" && HTTP_URL.test(uc)) url = uc;
      } else {
        const u = orphan.collections[n]?.source_identity?.url;
        if (typeof u === "string" && HTTP_URL.test(u)) url = u;
      }
    }
    links.set(slug, { url, level });
  }
  return links;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Clés S3 du polygone zonage: layout plat ET sous-dossier — les DEUX quand elles
 *  coexistent (même piège que `fold-reglement-to-zonage.ts`: geo-api peut servir
 *  le sous-dossier même quand la clé plate existe aussi). */
async function zonageKeys(s3: S3Client, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const k of candidates) if (await exists(s3, k)) keys.push(k);
  return keys;
}

function showUrl(url: string | null): string {
  return url === null ? "null" : JSON.stringify(url);
}

interface Distribution {
  total: number;
  nonNullUrl: number;
  byLevel: Record<ZoneSourceLevel, number>;
}

function distribution(links: Iterable<ZoneSourceLink>): Distribution {
  const byLevel: Record<ZoneSourceLevel, number> = {
    "historical-verified": 0,
    "legacy-traceable": 0,
    candidate: 0,
    orphan: 0,
    unknown: 0,
  };
  let total = 0;
  let nonNullUrl = 0;
  for (const link of links) {
    total++;
    byLevel[link.level]++;
    if (link.url !== null) nonNullUrl++;
  }
  return { total, nonNullUrl, byLevel };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const links = buildLinks();

  let slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (argv.includes("--all")) {
    slugs = [...links.keys()].sort();
    console.log(`--all: ${slugs.length} collections du manifeste zone-provenance 2026-07-22`);
  }
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b> or --all");
    process.exit(2);
  }

  console.log(distributionLine("MANIFEST-DISTRIBUTION", distribution(links.values())));
  if (argv.includes("--all")) {
    console.log(distributionLine("RUN-DISTRIBUTION", distribution(slugs.map((s) => links.get(s)!))));
  }

  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  const failed: string[] = [];
  // Each slug (and each key within a slug) is wrapped independently: a transient
  // S3/network hiccup on collection N must not abort the remaining N..871 — it
  // is recorded as FAILED and the run continues. Verified necessary empirically:
  // an unguarded read loop died deterministically on the 7th of 871 collections
  // (a getBytes() rejection propagating out of main(), killing the whole run).
  for (const slug of slugs) {
    const link: ZoneSourceLink = links.get(slug) ?? { url: null, level: "unknown" };
    let slugFailed = false;
    try {
      const keys = await zonageKeys(s3, slug);
      if (keys.length === 0) {
        skipped.push(`${slug} (polygone qc-zonage non servi)`);
        continue;
      }
      for (const key of keys) {
        try {
          const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
            type?: unknown;
            features?: Array<{ properties?: Record<string, unknown> }>;
          };
          // Defensive: an object broken by the old loadFeatures bug (missing type)
          // would be rejected by the additive gate; restore the tag as the sibling
          // usage fold does. Geometry is still verified byte-identical downstream.
          if (fc.type !== "FeatureCollection" && Array.isArray(fc.features)) fc.type = "FeatureCollection";
          const feats = fc.features ?? [];
          let changed = 0;
          for (const f of feats) {
            f.properties = f.properties ?? {};
            if (strip) {
              for (const field of [URL_FIELD, LEVEL_FIELD]) {
                if (field in f.properties) { delete f.properties[field]; changed++; }
              }
              continue;
            }
            for (const [field, expected] of [[URL_FIELD, link.url], [LEVEL_FIELD, link.level]] as const) {
              if (!(field in f.properties) || f.properties[field] !== expected) {
                f.properties[field] = expected;
                changed++;
              }
            }
          }
          console.log(
            `${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} cellsChanged=${changed} ` +
            `url=${showUrl(link.url)} level=${link.level} key=${key}`,
          );
          if (!dryRun && changed > 0) {
            // Additive provenance write: geometry proven byte-identical to the
            // served object; only zone_source_url + zone_source_level may differ.
            await putServedZoneAdditive(s3, key, fc, { allowedProps: [URL_FIELD, LEVEL_FIELD] });
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          failed.push(`${slug} ${key}: ${message}`);
          slugFailed = true;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push(`${slug}: ${message}`);
      slugFailed = true;
    }
    if (!slugFailed) ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  for (const f of failed) console.log(`FAILED ${f}`);
  console.log(
    `DONE ok=${ok}/${slugs.length} skipped=${skipped.length} failed=${failed.length}${dryRun ? " (dry-run)" : ""}`,
  );
}

function distributionLine(label: string, d: Distribution): string {
  return (
    `${label} collections=${d.total} nonNullUrl=${d.nonNullUrl} ` +
    `historical-verified=${d.byLevel["historical-verified"]} legacy-traceable=${d.byLevel["legacy-traceable"]} ` +
    `candidate=${d.byLevel.candidate} orphan=${d.byLevel.orphan} unknown=${d.byLevel.unknown}`
  );
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
