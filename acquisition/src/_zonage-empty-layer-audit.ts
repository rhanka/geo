/**
 * _zonage-empty-layer-audit.ts — READ-ONLY, une seule LIST S3 (coût ~0).
 *
 * MOTIF DÉCOUVERT 2026-07-20 (`les-cedres`) : `zonage-enrichment.json` peut marquer
 * `served=true` une collection dont l'objet S3 est un FeatureCollection **VIDE**
 * (118 octets, `features=[]`). Conséquences mesurées :
 *
 *  - le dénominateur « 846 munis servies » est SURÉVALUÉ ;
 *  - `fold --dry-run` y répond `cellsChanged=0`, ce qui se lit à tort comme
 *    « provenance déjà servie » alors que la vraie cause est « rien à estampiller ».
 *    ⇒ `cellsChanged=0` est AMBIGU : toujours lire `polygones=N` à côté.
 *
 * Cette sonde LISTe le préfixe zonage une fois et croise les tailles d'objet avec
 * le drapeau `served` de l'enrichissement, pour chiffrer la population « servie mais
 * vide ». Elle n'écrit rien.
 *
 * Usage:
 *   npx tsx acquisition/src/_zonage-empty-layer-audit.ts
 *   npx tsx acquisition/src/_zonage-empty-layer-audit.ts --max-bytes 1000
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { s3Client, BUCKET } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const PREFIX = "normalized/ca-qc-zonage/";
const SUFFIX = ".geojson";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
/** Un FeatureCollection vide pèse ~118 o ; on garde une marge généreuse. */
const MAX_BYTES = Number(arg("max-bytes") ?? 1000);

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const enrich = readJson(ENRICH) ?? {};
  const perMuni: any[] = enrich.perMuni ?? enrich.munis ?? [];
  const served = new Set<string>();
  for (const m of perMuni) if (m?.served) served.add(m.slug);

  const s3 = s3Client();
  /** slug -> plus GROSSE des clés (plate ou sous-dossier) : c'est la seule qui
   *  puisse porter des features. Prendre la première ferait un faux « vide ». */
  const size = new Map<string, number>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key!;
      if (!k.endsWith(SUFFIX)) continue;
      const base = k.slice(k.lastIndexOf("/") + 1, k.length - SUFFIX.length);
      if (!base.startsWith("qc-zonage-")) continue;
      const slug = base.slice("qc-zonage-".length);
      size.set(slug, Math.max(size.get(slug) ?? 0, o.Size ?? 0));
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const empty = [...size.entries()]
    .filter(([, b]) => b <= MAX_BYTES)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const emptyServed = empty.filter(([s]) => served.has(s));
  const missing = [...served].filter((s) => !size.has(s)).sort();

  console.log(`# objets zonage S3 (slugs distincts) = ${size.size}`);
  console.log(`# enrichment served=true            = ${served.size}`);
  console.log(`# S3 VIDE (<=${MAX_BYTES} o)                = ${empty.length}`);
  console.log(`#   dont enrichment dit served=true  = ${emptyServed.length}  <-- FAUX SERVIS`);
  console.log(`# served=true SANS objet S3          = ${missing.length}`);

  console.log("\n## faux servis (S3 vide mais served=true)");
  for (const [s, b] of emptyServed) console.log(`${s}\t${b}o`);
  console.log("\n## served=true sans aucun objet S3");
  for (const s of missing) console.log(s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
