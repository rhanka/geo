/**
 * region-sig-codes — READ-ONLY S3 diagnostic. For each slug, resolve the SIG grille
 * (normalized/ca-qc-zonage/qc-zonage-<slug>.geojson, flat or subfolder) and print
 * the distinct canonical zone codes it declares (via the frozen
 * `sigZoneCodesFromGeojson` whitelist). Tells us whether a muni's SIG grille carries
 * REAL zone codes (overlap-able) vs sequential/affectation (never overlaps) BEFORE
 * spending any extraction. No LLM, no writes.
 *
 * Usage: npx tsx acquisition/src/region-sig-codes.ts --slugs a,b,c
 */
import { s3Client, getBytes } from "./lib/s3.js";
import { resolveGridKey, sigZoneCodesFromGeojson } from "./lib/zonage-norms.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("usage: --slugs a,b,c"); process.exit(2); }
  const s3 = s3Client();
  for (const slug of slugs) {
    try {
      const key = await resolveGridKey(s3, slug);
      if (!key) { console.log(`NOGRID    ${slug}`); continue; }
      const geojson = (await getBytes(s3, key)).toString("utf8");
      const codes = [...sigZoneCodesFromGeojson(geojson)].sort();
      // classify: real (has letters) vs pure-numeric/sequential
      const withLetters = codes.filter((c) => /[A-Z]/i.test(c)).length;
      const cls = codes.length === 0 ? "empty" : withLetters * 2 >= codes.length ? "alpha" : "numeric";
      console.log(
        `${cls.padEnd(8)} ${slug.padEnd(42)} sigCodes=${String(codes.length).padStart(3)} ` +
          `sample=[${codes.slice(0, 12).join(",")}]`,
      );
    } catch (e) {
      console.log(`ERROR     ${slug}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
