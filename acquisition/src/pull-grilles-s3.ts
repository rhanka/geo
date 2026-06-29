/**
 * Inverse of `stage-grilles-s3.ts`: pull staged grille PDFs (+ the muni
 * manifest) FROM S3 down to the local `work/zonage-norms/` tree a remote runner
 * (Scaleway Serverless Job, EXTRACT-ONLY mode) can feed to `zonage-norms-batch`.
 *
 * Source : s3://<bucket>/sources/qc-zonage-grilles/<slug>.pdf  (+ munis.json /
 *          discovered.json)
 * Dest   : work/zonage-norms/<slug>/grille.pdf  (+ the chosen manifest)
 *
 * The manifest drives WHICH slugs to pull (only PDFs referenced by it), so the
 * job stays bounded and idempotent. Manifest choice:
 *   - argv[2] is an explicit manifest path written by the entrypoint, OR
 *   - `NORMS_MANIFEST` env, OR
 *   - the staged `sources/qc-zonage-grilles/munis.json`, then `discovered.json`.
 *
 * Idempotent: skips a local PDF already present with the same byte size.
 * TS-only, no secret printed. Run: npx tsx src/pull-grilles-s3.ts [manifest.json]
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, getBytes, exists, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK_DIR = join(REPO, "work", "zonage-norms");
const PREFIX = "sources/qc-zonage-grilles";

interface ManifestMuni {
  slug: string;
}

function manifestSlugs(raw: unknown): string[] {
  const arr: ManifestMuni[] = Array.isArray(raw)
    ? (raw as ManifestMuni[])
    : raw && typeof raw === "object" && Array.isArray((raw as { munis?: unknown }).munis)
      ? ((raw as { munis: ManifestMuni[] }).munis)
      : [];
  return [...new Set(arr.map((m) => m.slug).filter(Boolean))];
}

async function main(): Promise<void> {
  const s3 = s3Client();
  mkdirSync(WORK_DIR, { recursive: true });

  // 1) Resolve + materialise the manifest locally so the batch can read it.
  const localManifest = join(WORK_DIR, "munis.json");
  let manifestRaw: string | undefined;
  const explicit = process.argv[2] ?? process.env["NORMS_MANIFEST"];
  if (explicit && existsSync(explicit)) {
    manifestRaw = readFileSync(explicit, "utf8");
  } else {
    for (const name of ["munis.json", "discovered.json"]) {
      const key = `${PREFIX}/${name}`;
      if (await exists(s3, key)) {
        manifestRaw = (await getBytes(s3, key)).toString("utf8");
        console.error(`[pull] manifest s3://${BUCKET}/${key}`);
        break;
      }
    }
  }
  if (!manifestRaw) {
    console.error(`[pull] NO manifest found (s3://${BUCKET}/${PREFIX}/munis.json|discovered.json)`);
    process.exit(2);
  }
  writeFileSync(localManifest, manifestRaw, "utf8");

  const slugs = manifestSlugs(JSON.parse(manifestRaw));
  console.error(`[pull] ${slugs.length} muni(s) from manifest`);

  // 2) Pull each referenced PDF to work/zonage-norms/<slug>/grille.pdf.
  let got = 0;
  let skip = 0;
  let miss = 0;
  for (const slug of slugs) {
    const key = `${PREFIX}/${slug}.pdf`;
    const dir = join(WORK_DIR, slug);
    const local = join(dir, "grille.pdf");
    if (!(await exists(s3, key))) {
      console.error(`[pull] MISSING ${key}`);
      miss++;
      continue;
    }
    const bytes = await getBytes(s3, key);
    if (existsSync(local) && statSync(local).size === bytes.length) {
      skip++;
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(local, bytes);
    console.error(`[pull] ${slug} (${(bytes.length / 1e6).toFixed(1)} Mo)`);
    got++;
  }
  console.error(`[pull] done: got=${got} skip=${skip} missing=${miss} → ${WORK_DIR}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
