/**
 * norms-sig-codes-batch — $0 gate before ANY paid normes extraction.
 *
 * For each slug: does S3 hold a SIG grille, how many distinct canonical zone
 * codes does it declare, and do those codes look like real zone codes (short
 * alphanumeric, e.g. "H-521", "RA-3") vs an *affectation* vocabulary
 * ("RESIDENTIELLE", "AGRICOLE") which makes the overlap gate unsatisfiable.
 *
 * Pure read: 1 GET per slug, 0 writes, 0 LLM.
 *
 * Usage: npx tsx acquisition/src/norms-sig-codes-batch.ts --slugs a,b,c [--sample 12]
 */
import { s3Client, getBytes } from "./lib/s3.js";
import { resolveGridKey, sigZoneCodesFromGeojson } from "./lib/zonage-norms.js";

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A real zone code is short and carries a digit or is a <=4-char token. */
function looksLikeZoneCode(code: string): boolean {
  if (code.length > 10) return false;
  if (/\d/.test(code)) return true;
  return code.length <= 4;
}

async function main(): Promise<void> {
  const slugs = (get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!slugs.length) throw new Error("required: --slugs a,b,c");
  const sample = Number(get("sample") ?? "12");
  const s3 = s3Client();

  for (const slug of slugs) {
    try {
      const key = await resolveGridKey(s3, slug);
      if (!key) {
        console.log(`${slug}\tNO-SIG\t0\t-`);
        continue;
      }
      const geojson = (await getBytes(s3, key)).toString("utf8");
      const canon = [...sigZoneCodesFromGeojson(geojson)];
      const codeLike = canon.filter(looksLikeZoneCode);
      const verdict =
        canon.length === 0
          ? "SIG-EMPTY"
          : codeLike.length === 0
            ? "AFFECTATION-ONLY"
            : codeLike.length < canon.length / 2
              ? "MIXED"
              : "CODES-OK";
      console.log(
        `${slug}\t${verdict}\t${canon.length}\t[${canon.slice(0, sample).join(", ")}]`,
      );
    } catch (e) {
      console.log(`${slug}\tERROR\t0\t${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
