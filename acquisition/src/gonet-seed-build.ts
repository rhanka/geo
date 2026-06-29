/*
 * Build the GoNet zones SEED list: {slug -> municode} for every municipality
 * that is zones=to-research in the coverage matrix AND whose PV manifest
 * (registry/qc-pv/<slug>/index.json) carries a goNetLinks[].muniCode.
 *
 * Output (stdout JSON + file): an array of {slug, code} plus the comma-joined
 * `--gonet slug=code,...` strings, sharded into batches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, listSlugs, getJson } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "../../work/coverage/coverage-matrix.json");
const OUT_DIR = resolve(HERE, "../../work/delegation-mass");

interface GoNetLink { url?: string; muniCode?: string }
interface PvManifest { slug?: string; goNetLinks?: GoNetLink[]; discoveryTrack?: string }

async function main(): Promise<void> {
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, { zones?: { status?: string; doneTrack?: string } }>;
  };
  const cities = matrix.cities;

  // zones=to-research slug set
  const toResearch = new Set<string>();
  let zonesDone = 0;
  for (const [slug, c] of Object.entries(cities)) {
    const st = c.zones?.status;
    if (st === "to-research") toResearch.add(slug);
    else if (st === "done") zonesDone++;
  }

  const s3 = s3Client();
  const rests = await listSlugs(s3, "registry/qc-pv/", "/index.json");
  console.error(`pv manifests: ${rests.length}, zones to-research: ${toResearch.size}, zones done: ${zonesDone}`);

  const seed: { slug: string; code: string }[] = [];
  const gonetButNotToResearch: string[] = [];
  let manifestsWithGonet = 0;
  let n = 0;
  for (const rest of rests) {
    const slug = rest.replace(/\/$/, "");
    n++;
    let j: PvManifest;
    try {
      j = await getJson<PvManifest>(s3, `registry/qc-pv/${slug}/index.json`);
    } catch {
      continue;
    }
    const links = j.goNetLinks ?? [];
    const code = links.map((l) => l.muniCode).find((c) => c && /^\d{4,5}$/.test(c));
    if (!code) continue;
    manifestsWithGonet++;
    if (toResearch.has(slug)) seed.push({ slug, code });
    else gonetButNotToResearch.push(slug);
    if (n % 100 === 0) console.error(`  …scanned ${n}/${rests.length}, seed so far ${seed.length}`);
  }

  // de-dup by slug (keep first municode)
  const bySlug = new Map<string, string>();
  for (const { slug, code } of seed) if (!bySlug.has(slug)) bySlug.set(slug, code);
  const finalSeed = [...bySlug.entries()].map(([slug, code]) => ({ slug, code }));
  finalSeed.sort((a, b) => a.slug.localeCompare(b.slug));

  console.error(`\nmanifests with gonet muniCode: ${manifestsWithGonet}`);
  console.error(`  → zones=to-research (SEED): ${finalSeed.length}`);
  console.error(`  → already done/other status: ${gonetButNotToResearch.length}`);

  // shard into batches
  const BATCH = Number(process.env["BATCH"] ?? 35);
  const batches: string[] = [];
  for (let i = 0; i < finalSeed.length; i += BATCH) {
    const chunk = finalSeed.slice(i, i + BATCH);
    batches.push(chunk.map((s) => `${s.slug}=${s.code}`).join(","));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    seedCount: finalSeed.length,
    batchSize: BATCH,
    batchCount: batches.length,
    seed: finalSeed,
    batches,
  };
  writeFileSync(resolve(OUT_DIR, "gonet-seed.json"), JSON.stringify(out, null, 2) + "\n");
  console.error(`\nwrote ${OUT_DIR}/gonet-seed.json (${finalSeed.length} villes, ${batches.length} batches of ${BATCH})`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
