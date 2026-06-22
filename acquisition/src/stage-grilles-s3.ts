/**
 * Stage local grille PDFs (+ the muni manifest) to S3 so they are
 * cloud-available for a remote runner (Scaleway Serverless Job) and durably
 * backed up — the future remote normes job fetches inputs from OUR bucket
 * instead of re-hitting flaky municipal sites.
 *
 * Source : work/zonage-norms/<slug>/grille*.pdf  (+ munis.json, discovered.json)
 * Dest   : s3://<bucket>/sources/qc-zonage-grilles/<slug>.pdf  (+ manifests)
 *
 * Idempotent: skips an object already present with the same byte size.
 * TS-only, no secret printed. Run: npx tsx src/stage-grilles-s3.ts [--force]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HeadObjectCommand } from "@aws-sdk/client-s3";

import { s3Client, putBytes, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SRC_DIR = join(REPO, "work", "zonage-norms");
const PREFIX = "sources/qc-zonage-grilles";
const FORCE = process.argv.includes("--force");

/** Existing object size, or -1 if absent. */
async function remoteSize(
  s3: ReturnType<typeof s3Client>,
  key: string,
): Promise<number> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ContentLength ?? -1;
  } catch {
    return -1;
  }
}

async function main(): Promise<void> {
  if (!existsSync(SRC_DIR)) {
    console.error(`[stage] no source dir ${SRC_DIR}`);
    return;
  }
  const s3 = s3Client();
  let put = 0;
  let skip = 0;

  // 1) Per-muni grille PDFs (first *.pdf found in each slug dir).
  for (const slug of readdirSync(SRC_DIR)) {
    const dir = join(SRC_DIR, slug);
    if (!statSync(dir).isDirectory()) continue;
    const pdf = readdirSync(dir).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdf) continue;
    const local = join(dir, pdf);
    const key = `${PREFIX}/${slug}.pdf`;
    const size = statSync(local).size;
    if (!FORCE && (await remoteSize(s3, key)) === size) {
      skip++;
      continue;
    }
    await putBytes(s3, key, readFileSync(local), "application/pdf");
    console.error(`[stage] put ${key} (${(size / 1e6).toFixed(1)} Mo)`);
    put++;
  }

  // 2) Manifests (small JSON) alongside the PDFs.
  for (const name of ["munis.json", "discovered.json"]) {
    const local = join(SRC_DIR, name);
    if (!existsSync(local)) continue;
    await putBytes(
      s3,
      `${PREFIX}/${name}`,
      readFileSync(local),
      "application/json",
    );
    console.error(`[stage] put ${PREFIX}/${name}`);
    put++;
  }

  console.error(`[stage] done: put=${put} skip=${skip} → s3://${BUCKET}/${PREFIX}/`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
