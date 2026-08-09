/**
 * _restamp-served-from-proof.ts — backfill du stamp de provenance sur des zones
 * SERVIES dont la géométrie a été re-déposée en v2 AVANT le fix atomique des runners
 * (`fix(zones): re-acquisition runners re-stamp provenance atomically`).
 *
 * PROBLÈME: un re-dépôt de géométrie zones écrase l'objet servi et EFFACE les
 * propriétés additives zone_source_url/zone_source_level (bug prouvé: saint-frederic,
 * mont-saint-hilaire, saint-raphael ressortis UNSTAMPED). Ce backfill re-stampe SANS
 * passer par le registre de corrections (donc sans verrou), en lisant l'URL source v2
 * EXACTE déjà présente dans la preuve géométrique servie `proof.geometry_source.url`.
 *
 * ANTI-INVENTION: n'utilise QUE l'URL v2 réellement présente dans la preuve servie
 * (validée `isRealGeometryUrl`). Si la collection n'a pas de preuve v2 exploitable,
 * elle est SAUTÉE (aucune URL devinée). Niveau posé = "documented" (source SIG
 * officielle re-téléchargeable ayant produit la géométrie servie — pas
 * "historical-verified"). Écriture via putServedZoneAdditive: géométrie prouvée
 * octet-pour-octet inchangée, seules zone_source_url/zone_source_level ajoutées.
 *
 * Usage (depuis acquisition/, réseau S3 → ipv4first):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/_restamp-served-from-proof.ts --slugs saint-frederic,mont-saint-hilaire --dry-run
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/_restamp-served-from-proof.ts --slugs saint-frederic,mont-saint-hilaire
 */
import { pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { isRealGeometryUrl, putServedZoneAdditive } from "./lib/zonage-proof.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const URL_FIELD = "zone_source_url";
const LEVEL_FIELD = "zone_source_level";
const LEVEL_VALUE = "documented";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function zonageKeys(s3: S3Client, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const k of candidates) if (await exists(s3, k)) keys.push(k);
  return keys;
}

interface ProofFC {
  type?: unknown;
  proof?: { geometry_source?: { url?: unknown } } | null;
  features?: Array<{ properties?: Record<string, unknown> | null }>;
}

/** URL v2 exacte de la preuve servie: collection d'abord, sinon 1re feature. */
function proofUrl(fc: ProofFC): string | null {
  const collUrl = fc.proof?.geometry_source?.url;
  if (isRealGeometryUrl(collUrl)) return collUrl;
  const featProof = fc.features?.[0]?.properties?.proof as { geometry_source?: { url?: unknown } } | undefined;
  const featUrl = featProof?.geometry_source?.url;
  return isRealGeometryUrl(featUrl) ? featUrl : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b,c>");
    process.exit(2);
  }

  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const slug of slugs) {
    try {
      const keys = await zonageKeys(s3, slug);
      if (keys.length === 0) {
        skipped.push(`${slug} (qc-zonage non servi)`);
        continue;
      }
      let slugStamped = 0;
      for (const key of keys) {
        try {
          const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as ProofFC;
          if (fc.type !== "FeatureCollection" && Array.isArray(fc.features)) fc.type = "FeatureCollection";
          const url = proofUrl(fc);
          if (!url) {
            skipped.push(`${slug} ${key} (aucune URL v2 exploitable dans proof.geometry_source — anti-invention, sauté)`);
            continue;
          }
          const feats = fc.features ?? [];
          let changed = 0;
          for (const f of feats) {
            f.properties = f.properties ?? {};
            if (f.properties[URL_FIELD] !== url) { f.properties[URL_FIELD] = url; changed++; }
            if (f.properties[LEVEL_FIELD] !== LEVEL_VALUE) { f.properties[LEVEL_FIELD] = LEVEL_VALUE; changed++; }
          }
          console.log(
            `${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} cellsChanged=${changed} ` +
            `url=${JSON.stringify(url)} level=${LEVEL_VALUE} key=${key}`,
          );
          if (!dryRun && changed > 0) {
            await putServedZoneAdditive(s3, key, fc as { type: "FeatureCollection"; features: typeof feats }, {
              allowedProps: [URL_FIELD, LEVEL_FIELD],
            });
            slugStamped++;
          }
        } catch (e) {
          failed.push(`${slug} ${key}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (slugStamped > 0 || dryRun) ok++;
    } catch (e) {
      failed.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const s of skipped) console.log(`SKIP ${s}`);
  for (const f of failed) console.log(`FAILED ${f}`);
  console.log(`DONE ok=${ok}/${slugs.length} skipped=${skipped.length} failed=${failed.length}${dryRun ? " (dry-run)" : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
