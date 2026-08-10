/**
 * Materialize the served zoning collections whose existing audit evidence
 * already contains a verifiable HTTPS URL and SHA-256 receipt.
 *
 * Usage (from repository root):
 *   npx tsx acquisition/src/qa-geo-internal-167-extract.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SOURCE_PATH = "work/coverage/served-zonage-immo-proof-url-audit-final-20260728T120900Z.json";
const OUTPUT_PATH = "work/coverage/geo-internal-167-verifiable-url.json";
const EXPECTED_COUNT = 167;
const SOURCE_CONTRACT = "served-zonage-immo-proof-url-audit/v1";
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;

export interface VerifiableUrl {
  url: string;
  sha256: string;
}

export interface VerifiableSlug {
  slug: string;
  urls: VerifiableUrl[];
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requiredHttpsUrl(value: unknown, field: string): string {
  const url = requiredString(value, field);
  try {
    if (new URL(url).protocol !== "https:") throw new Error("not HTTPS");
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  return url;
}

function requiredSha256(value: unknown, field: string): string {
  const sha256 = requiredString(value, field);
  if (!SHA256_RE.test(sha256)) throw new Error(`${field} must be a sha256:<64 lowercase hex> value`);
  return sha256;
}

/** Select the non-empty verifiable-case rows, retaining only their URL receipts. */
export function selectVerifiableSlugs(auditJson: unknown): VerifiableSlug[] {
  const audit = asObject(auditJson);
  if (audit === null || !Array.isArray(audit.rows)) throw new Error("audit must contain rows[]");

  const seenSlugs = new Set<string>();
  const selected: VerifiableSlug[] = [];

  for (const [rowIndex, rawRow] of audit.rows.entries()) {
    const row = asObject(rawRow);
    if (row === null) throw new Error(`rows[${rowIndex}] must be an object`);
    if (!Array.isArray(row.verifiable_https_sha256_cases)) {
      throw new Error(`rows[${rowIndex}].verifiable_https_sha256_cases must be an array`);
    }
    if (row.verifiable_https_sha256_cases.length === 0) continue;

    const slug = requiredString(row.slug, `rows[${rowIndex}].slug`);
    if (seenSlugs.has(slug)) throw new Error(`audit has duplicate slug: ${slug}`);
    seenSlugs.add(slug);

    const uniqueUrls = new Map<string, VerifiableUrl>();
    for (const [caseIndex, rawCase] of row.verifiable_https_sha256_cases.entries()) {
      const proofCase = asObject(rawCase);
      if (proofCase === null) throw new Error(`rows[${rowIndex}].verifiable_https_sha256_cases[${caseIndex}] must be an object`);
      const url = requiredHttpsUrl(proofCase.url, `rows[${rowIndex}].verifiable_https_sha256_cases[${caseIndex}].url`);
      const sha256 = requiredSha256(proofCase.sha256, `rows[${rowIndex}].verifiable_https_sha256_cases[${caseIndex}].sha256`);
      uniqueUrls.set(`${url}\u0000${sha256}`, { url, sha256 });
    }

    selected.push({
      slug,
      urls: [...uniqueUrls.values()].sort((left, right) => compareStrings(left.url, right.url) || compareStrings(left.sha256, right.sha256)),
    });
  }

  return selected.sort((left, right) => compareStrings(left.slug, right.slug));
}

function sourceAsOf(audit: JsonObject): string {
  // This v1 audit calls its source timestamp generated_at; retain that value verbatim.
  return requiredString(audit.as_of ?? audit.generated_at, "audit.as_of or audit.generated_at");
}

function sourceAggregate(audit: JsonObject): number {
  const collections = asObject(audit.collections);
  const count = collections?.with_verifiable_https_url_sha256;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("audit.collections.with_verifiable_https_url_sha256 must be a non-negative integer");
  }
  return count;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function main(): void {
  const sourceAbsolutePath = resolve(ROOT, SOURCE_PATH);
  const outputAbsolutePath = resolve(ROOT, OUTPUT_PATH);
  const sourceBytes = readFileSync(sourceAbsolutePath);
  const audit = asObject(JSON.parse(sourceBytes.toString("utf8")));
  if (audit === null) throw new Error("audit must be a JSON object");
  if (audit.contract !== SOURCE_CONTRACT) throw new Error(`unexpected source contract: ${String(audit.contract)}`);

  const slugs = selectVerifiableSlugs(audit);
  const count = slugs.length;
  const aggregate = sourceAggregate(audit);
  const artifact = {
    contract: "geo-internal-167-verifiable-url/v1",
    source: {
      path: SOURCE_PATH,
      as_of: sourceAsOf(audit),
      sha256: sha256(sourceBytes),
    },
    count,
    expected: EXPECTED_COUNT,
    slugs,
  };

  writeAtomic(outputAbsolutePath, artifact);

  const failures: string[] = [];
  if (count !== aggregate) failures.push(`agrégat source attendu ${aggregate}, obtenu ${count}`);
  if (count !== EXPECTED_COUNT) failures.push(`attendu ${EXPECTED_COUNT}, obtenu ${count}`);
  if (failures.length > 0) throw new Error(`cohorte geo-interne-167 invalide: ${failures.join("; ")}`);

  console.log(JSON.stringify({ output: OUTPUT_PATH, count, expected: EXPECTED_COUNT }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
