/* Read-only: count deposited qc-zonage-*.geojson under normalized/ca-qc-zonage/.
 * Does NOT touch the coverage matrix (the main-loop reconciles that). */
import { s3Client, listSlugs } from "./lib/s3.js";

async function main(): Promise<void> {
  const s3 = s3Client();
  // flat layout: normalized/ca-qc-zonage/qc-zonage-<slug>.geojson
  const keys = await listSlugs(s3, "normalized/ca-qc-zonage/", ".geojson");
  const zonage = keys.filter((k) => k.startsWith("qc-zonage-"));
  const slugs = zonage.map((k) => k.replace(/^qc-zonage-/, "").replace(/\.geojson$/, "")).sort();
  console.error(`total .geojson under prefix: ${keys.length}`);
  console.error(`qc-zonage-* deposits: ${zonage.length}`);
  // optional: print slugs matching an arg filter
  const filter = process.argv[2];
  if (filter) {
    const want = new Set(filter.split(",").map((s) => s.trim()).filter(Boolean));
    const present = slugs.filter((s) => want.has(s));
    const missing = [...want].filter((s) => !slugs.includes(s)).sort();
    console.error(`requested ${want.size}: present=${present.length} [${present.join(",")}]`);
    console.error(`missing=${missing.length} [${missing.join(",")}]`);
  } else {
    console.error(slugs.join("\n"));
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
