// pv-cas-live-index — INDEX LIVE url->sha du CAS PV, lu depuis les manifestes de capture
// LIVE (`capture/_runs/*/manifest.jsonl`) du bucket `sentropic-geo`. LECTURE SEULE :
// uniquement list + get (ZERO PutObject). Variant "live" de
// `scripts/geo-pv-cas-sha-slug-index.mjs` : meme extraction (url + sha256 + slug), mais
// source = les manifestes LIVE (pas les octets-classification committes) -> capte
// l'univers reel du bucket, y compris les captures recentes SANS manifeste committe.
//
// Sortie : NDJSON, une ligne {url, sha256, slug, run_id} par (url, sha) unique, triee.
// Pour la reconciliation object-store immo<->geo (silent-P4 : une immo-sourceUrl qui est
// dans les geo-urls mais sous un sha different => re-key/conversion, pas re-capture).
//
// Usage :
//   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
//     npx tsx acquisition/src/pv-cas-live-index.ts --out <path.ndjson> [--prefix capture/_runs/pv]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

// Cle CAS canonique (miroir packages/qc-sources/src/capture/manifest.ts). group2 = sha256.
const CAS_KEY_RE = /^raw\/([a-z0-9][a-z0-9._-]*)\/cas\/([a-f0-9]{64})\.([a-z0-9]+)$/;
const READ_CONCURRENCY = 4;

function value(argv: readonly string[], name: string): string | null {
  const eqPrefix = `--${name}=`;
  const eq = argv.find((a) => a.startsWith(eqPrefix));
  if (eq !== undefined) return eq.slice(eqPrefix.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const out = value(argv, "out");
  if (!out) throw new Error("--out=<path.ndjson> requis");
  const listPrefix = value(argv, "prefix") ?? "capture/_runs/pv";
  const outPath = resolve(out);

  const s3 = s3Client();
  const manifestKeys = (await listObjectEntries(s3, listPrefix))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"))
    .sort();

  // `${url}\t${sha}` -> { url, sha256, slug, run_id } (dedup par couple url+sha)
  const rows = new Map<string, { url: string; sha256: string; slug: string; run_id: string }>();
  let casLines = 0;
  let skippedNoCas = 0;

  const perManifest = await mapConcurrent(manifestKeys, async (manifestKey) => {
    const text = (await getBytes(s3, manifestKey)).toString("utf8");
    return parseManifestJsonl(text).filter((line) => line.source === "pv-index");
  });

  for (const lines of perManifest) {
    for (const line of lines) {
      const key = line.storage_key;
      if (key === null) { skippedNoCas++; continue; }
      const m = CAS_KEY_RE.exec(key);
      if (m === null) { skippedNoCas++; continue; }
      const sha = m[2]!;
      const url = line.url;
      const slug = line.slugs.length === 1 ? line.slugs[0]! : "(multi-or-unknown)";
      const dedupKey = `${url}\t${sha}`;
      if (!rows.has(dedupKey)) rows.set(dedupKey, { url, sha256: sha, slug, run_id: line.run_id });
      casLines++;
    }
  }

  const sorted = [...rows.values()].sort((a, b) =>
    `${a.url}\t${a.sha256}`.localeCompare(`${b.url}\t${b.sha256}`),
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, sorted.length ? `${sorted.map((r) => JSON.stringify(r)).join("\n")}\n` : "");

  process.stdout.write(
    `${JSON.stringify(
      {
        out,
        list_prefix: listPrefix,
        manifests: manifestKeys.length,
        cas_lines: casLines,
        skipped_no_cas: skippedNoCas,
        distinct_url_sha: sorted.length,
        distinct_sha256: new Set(sorted.map((r) => r.sha256)).size,
        distinct_url: new Set(sorted.map((r) => r.url)).size,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
