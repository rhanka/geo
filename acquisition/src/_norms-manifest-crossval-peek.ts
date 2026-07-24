/**
 * Read-only: print full manifest entry (incl. crossval) for given slugs from
 * the live S3 qc-zonage-norms manifest. Ad-hoc diagnostic, mirrors
 * _norms-manifest-entry.ts but includes the crossval block verbatim.
 *
 * Usage: npx tsx acquisition/src/_norms-manifest-crossval-peek.ts --slugs "a,b"
 */
import { s3Client, getBytes } from "./lib/s3.js";
import { ZONAGE_NORMS_MANIFEST_KEY, type Manifest } from "./lib/zonage-norms.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const s3 = s3Client();
  const manifest = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8")) as Manifest;
  for (const slug of slugs) {
    const e = manifest.entries.find((x) => x.slug === slug);
    console.log(slug, JSON.stringify(e ?? { notFound: true }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
