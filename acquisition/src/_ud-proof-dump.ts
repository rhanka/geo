/**
 * _ud-proof-dump.ts — lecture seule, lane usage_dominant.
 *
 * Affiche les reçus de provenance réellement attachés aux polygones zonage
 * servis. Il sert à retrouver une capture S3 déjà durable, sans refaire un
 * appel HTTP et sans sérialiser les données localement.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_ud-proof-dump.ts --slug grand-saint-esprit
 */
import { exists, getBytes, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const slug = arg("slug");
if (!slug) throw new Error("usage: --slug <municipalite>");

const s3 = s3Client();
const candidates = [
  `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
  `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
];
const key = (await Promise.all(candidates.map(async (candidate) => (await exists(s3, candidate)) ? candidate : null)))
  .find((candidate): candidate is string => candidate !== null);
if (!key) throw new Error(`${slug}: collection zonage non servie`);

const collection = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
  features?: { properties?: Record<string, unknown> }[];
};
const proofs = new Map<string, { count: number; codes: Set<string> }>();
for (const feature of collection.features ?? []) {
  const properties = feature.properties ?? {};
  const proof = properties.proof;
  const rendered = proof == null ? "(absent)" : JSON.stringify(proof);
  const row = proofs.get(rendered) ?? { count: 0, codes: new Set<string>() };
  row.count++;
  const code = String(properties.zone_code ?? "").trim();
  if (code) row.codes.add(code);
  proofs.set(rendered, row);
}

console.log(`# ${key} — ${collection.features?.length ?? 0} entités, ${proofs.size} reçu(s) distinct(s)`);
for (const [proof, row] of proofs) {
  console.log(`\n${row.count} entité(s), ${row.codes.size} code(s): ${[...row.codes].sort().join(", ")}`);
  console.log(proof);
}
