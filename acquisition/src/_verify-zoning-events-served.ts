/**
 * Sonde read-only : le dépôt `qc-zoning-events-<slug>` est-il RÉELLEMENT sur S3 ?
 *
 * Contexte : la sortie locale `zoning-events-col20-serve-prod-000.json` atteste
 * `dry_run:false / emitted:true` pour saint-eustache + saint-mathieu-de-beloeil
 * (2026-08-08), MAIS l'OGC geo-api (`https://api.geo.sent-tech.ca/collections`)
 * ne liste AUCUNE collection `qc-zoning-events-*` et renvoie 404 sur
 * `/collections/qc-zoning-events-saint-eustache/items`. Cette sonde tranche entre :
 *   (a) octets présents sur S3 mais préfixe `ca-qc-zoning-events` non scanné par geo-api ;
 *   (b) octets jamais déposés (l'attestation locale serait fausse).
 *
 * HEAD-only (`objectHead`), aucune écriture. Le contrôle qc-zonage confirme que
 * les creds/bucket lisent bien la cible servie. Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_verify-zoning-events-served.ts
 */
import { objectHead, s3Client } from "./lib/s3.js";
import { zoningEventsKeys } from "./zoning-events-emit.js";

const SLUGS = ["saint-eustache", "saint-mathieu-de-beloeil"];
const CONTROL_KEY = "normalized/ca-qc-zonage/qc-zonage-saint-eustache.geojson";

async function main(): Promise<void> {
  const s3 = s3Client();

  const control = await objectHead(s3, CONTROL_KEY);
  process.stdout.write(
    `CONTROL ${CONTROL_KEY}\n  exists=${control.exists} bytes=${control.contentLength ?? "—"} lastModified=${control.lastModified?.toISOString() ?? "—"}\n`,
  );

  for (const slug of SLUGS) {
    for (const key of zoningEventsKeys(slug)) {
      const head = await objectHead(s3, key);
      process.stdout.write(
        `${slug} ${key}\n  exists=${head.exists} bytes=${head.contentLength ?? "—"} lastModified=${head.lastModified?.toISOString() ?? "—"} etag=${head.etag ?? "—"}\n`,
      );
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
