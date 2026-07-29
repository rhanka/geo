/**
 * Definitive read-only CAS integrity audit for the halted PV OCR lane.
 *
 * Downloads are hashed directly from the S3 response stream: no PDF is held
 * in memory. The first ten keys are the exact keys named by the OCR stop. If
 * one of those hashes differs from its CAS filename, the audit writes its
 * report and deliberately does not list or sample any additional objects.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_pv-cas-integrite-sha256.ts \
 *     --out=work/coverage/pv-cas-integrite-sha256-YYYYMMDDTHHMMSSZ.json \
 *     --md=work/coverage/pv-cas-integrite-sha256-YYYYMMDDTHHMMSSZ.md
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GetObjectCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type S3Client } from "@aws-sdk/client-s3";

import { BUCKET, s3Client, s3Target } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const MAX_LOCAL_FILE_BYTES = 5 * 1024 * 1024;
const CAS_PREFIX = "raw/pv-index/cas/";
const STAGE_REPORT = "work/coverage/pv-ocr-186-stage-known-001-r2-20260729T125514Z.json";
const INVENTORY_REPORT = "work/coverage/pv-ocr-inventaire-pages-20260729T122121Z.json";
const INDEXED_SNAPSHOT = "work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json";
const GUARD_COMMIT = "0ea922acdeb53e5dafa7a02232c8c3a1466c2975";
const INVENTORY_REPORT_COMMIT = "f42e09c009242d7de73288fbc81d85534e1da7e8";
const OCR_STOP_REPORT_COMMIT = "4a0233a79d3ecdf23a56006af53347866a5aa46c";
const INDEXED_WITNESSES = 5;
const OTHER_WITNESSES = 15;

type CheckStatus = "EQUAL" | "DIFFERENT" | "UNKNOWN";
type CheckKind = "named_by_ocr_stop" | "random_indexed_success" | "random_other_cas";

interface JsonRecord { readonly [key: string]: unknown }

interface Check {
  readonly storage_key: string;
  readonly category: CheckKind;
  readonly expected_sha256: string;
  readonly recalculated_sha256: string | null;
  readonly comparison: CheckStatus;
  readonly get_content_length: number | null;
  readonly streamed_bytes: number | null;
  readonly content_length_matches_streamed_bytes: boolean | null;
  readonly error: string | null;
}

interface RankedKey {
  readonly key: string;
  readonly rank: string;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function requiredArg(name: string): string {
  const value = process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function coveragePath(value: string): string {
  const path = resolve(ROOT, value);
  if (!path.startsWith(`${COVERAGE}/`)) throw new Error(`sortie hors work/coverage refusée: ${value}`);
  return path;
}

function asRecord(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as JsonRecord;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function readSmallJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_LOCAL_FILE_BYTES) throw new Error(`${path}: ${size} octets, lecture > 5 MiB interdite`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function expectedSha256(key: string): string {
  const match = new RegExp(`^${CAS_PREFIX}([a-f0-9]{64})\\.pdf$`, "u").exec(key);
  if (!match) throw new Error(`${key}: clé CAS PDF sha256 requise`);
  return match[1]!;
}

function stageKeys(): string[] {
  const stage = asRecord(readSmallJson(resolve(ROOT, STAGE_REPORT)), STAGE_REPORT);
  if (!Array.isArray(stage.documents) || stage.documents.length !== 10) {
    throw new Error(`${STAGE_REPORT}: exactement 10 documents requis`);
  }
  const keys = stage.documents.map((document, index) => {
    const record = asRecord(document, `${STAGE_REPORT}.documents[${index}]`);
    return requiredString(record.storage_key, `${STAGE_REPORT}.documents[${index}].storage_key`);
  });
  if (new Set(keys).size !== keys.length) throw new Error(`${STAGE_REPORT}: clés CAS dupliquées`);
  keys.forEach(expectedSha256);
  return keys;
}

function indexedSuccessKeys(): Set<string> {
  const snapshot = asRecord(readSmallJson(resolve(ROOT, INDEXED_SNAPSHOT)), INDEXED_SNAPSHOT);
  const indexed = asRecord(snapshot.indexed_graph, `${INDEXED_SNAPSHOT}.indexed_graph`);
  if (!Array.isArray(indexed.storage_keys)) throw new Error(`${INDEXED_SNAPSHOT}.indexed_graph.storage_keys: tableau requis`);
  const keys = indexed.storage_keys.map((value, index) => requiredString(value, `${INDEXED_SNAPSHOT}.indexed_graph.storage_keys[${index}]`));
  keys.forEach(expectedSha256);
  return new Set(keys);
}

function inventoryPermutationEvidence(checks: readonly Check[]): JsonRecord {
  const inventory = asRecord(readSmallJson(resolve(ROOT, INVENTORY_REPORT)), INVENTORY_REPORT);
  if (!Array.isArray(inventory.failed_documents)) throw new Error(`${INVENTORY_REPORT}.failed_documents: tableau requis`);
  const byKey = new Map<string, number>();
  const keyByLength = new Map<number, string>();
  for (const [index, value] of inventory.failed_documents.entries()) {
    const item = asRecord(value, `${INVENTORY_REPORT}.failed_documents[${index}]`);
    const key = requiredString(item.storage_key, `${INVENTORY_REPORT}.failed_documents[${index}].storage_key`);
    if (!Number.isSafeInteger(item.content_length) || (item.content_length as number) < 1) {
      throw new Error(`${INVENTORY_REPORT}.failed_documents[${index}].content_length: entier positif requis`);
    }
    const length = item.content_length as number;
    if (byKey.has(key) || keyByLength.has(length)) throw new Error(`${INVENTORY_REPORT}: clé ou content_length dupliqué; permutation non prouvable`);
    byKey.set(key, length);
    keyByLength.set(length, key);
  }
  const named = checks.filter((check) => check.category === "named_by_ocr_stop").map((check) => ({
    storage_key: check.storage_key,
    inventory_content_length: byKey.get(check.storage_key) ?? null,
    current_content_length: check.get_content_length,
    inventory_key_holding_current_length: check.get_content_length === null ? null : keyByLength.get(check.get_content_length) ?? null,
  }));
  return {
    inventory_report: INVENTORY_REPORT,
    inventory_documents: byKey.size,
    inventory_content_lengths_are_unique: true,
    named_current_lengths_reassigned_in_inventory: named,
  };
}

function compactError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

async function verifyStream(s3: S3Client, key: string, category: CheckKind): Promise<Check> {
  const expected = expectedSha256(key);
  let contentLength: number | null = null;
  let streamed = 0;
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    contentLength = Number.isSafeInteger(response.ContentLength) ? response.ContentLength! : null;
    const body = response.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("GetObject sans flux asynchrone");
    const hash = createHash("sha256");
    for await (const chunk of body) {
      streamed += chunk.byteLength;
      hash.update(chunk);
    }
    const recalculated = hash.digest("hex");
    return {
      storage_key: key,
      category,
      expected_sha256: expected,
      recalculated_sha256: recalculated,
      comparison: recalculated === expected ? "EQUAL" : "DIFFERENT",
      get_content_length: contentLength,
      streamed_bytes: streamed,
      content_length_matches_streamed_bytes: contentLength === null ? null : contentLength === streamed,
      error: null,
    };
  } catch (error) {
    return {
      storage_key: key,
      category,
      expected_sha256: expected,
      recalculated_sha256: null,
      comparison: "UNKNOWN",
      get_content_length: contentLength,
      streamed_bytes: streamed === 0 ? null : streamed,
      content_length_matches_streamed_bytes: null,
      error: compactError(error),
    };
  }
}

function rank(seed: string, key: string): string {
  return createHash("sha256").update(`${seed}\n${key}`, "utf8").digest("hex");
}

function retainLowest(items: RankedKey[], candidate: RankedKey, count: number): void {
  items.push(candidate);
  items.sort((left, right) => left.rank.localeCompare(right.rank) || left.key.localeCompare(right.key));
  if (items.length > count) items.pop();
}

function isCasPdf(key: string): boolean {
  try {
    expectedSha256(key);
    return true;
  } catch {
    return false;
  }
}

async function randomControls(
  s3: S3Client,
  excluded: ReadonlySet<string>,
  indexed: ReadonlySet<string>,
): Promise<{ readonly seed: string; readonly listed_cas_pdfs: number; readonly indexed: string[]; readonly other: string[] }> {
  const seed = randomBytes(32).toString("hex");
  const indexedSample: RankedKey[] = [];
  const otherSample: RankedKey[] = [];
  let listedCasPdfs = 0;
  for (let token: string | undefined = undefined; ;) {
    const page: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: CAS_PREFIX,
      ...(token ? { ContinuationToken: token } : {}),
    }));
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key || !isCasPdf(key)) continue;
      listedCasPdfs++;
      if (excluded.has(key)) continue;
      const candidate = { key, rank: rank(seed, key) };
      if (indexed.has(key)) retainLowest(indexedSample, candidate, INDEXED_WITNESSES);
      else retainLowest(otherSample, candidate, OTHER_WITNESSES);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (!token) break;
  }
  if (indexedSample.length !== INDEXED_WITNESSES || otherSample.length !== OTHER_WITNESSES) {
    throw new Error(`échantillon aléatoire incomplet: indexés=${indexedSample.length}/${INDEXED_WITNESSES}, autres=${otherSample.length}/${OTHER_WITNESSES}`);
  }
  return {
    seed,
    listed_cas_pdfs: listedCasPdfs,
    indexed: indexedSample.map((item) => item.key),
    other: otherSample.map((item) => item.key),
  };
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 }).trim();
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function historicalEndpointEvidence(): JsonRecord {
  const targetAtGuard = JSON.parse(git(["show", `${GUARD_COMMIT}:acquisition/config/s3-target.json`])) as JsonRecord;
  return {
    target_config: "acquisition/config/s3-target.json",
    guard_commit: GUARD_COMMIT,
    target_at_guard_commit: {
      endpoint: targetAtGuard.endpoint,
      region: targetAtGuard.region,
      bucket: targetAtGuard.bucket,
    },
    common_guard: {
      source: "acquisition/src/lib/s3.ts:110-145",
      behavior: "s3Client rejects an explicit endpoint/region that differs from the declared target, then constructs S3Client with the declared endpoint and region; BUCKET is s3Target().bucket.",
    },
    inventory_run: {
      report: INVENTORY_REPORT,
      report_commit: INVENTORY_REPORT_COMMIT,
      guard_commit_is_ancestor: isAncestor(GUARD_COMMIT, INVENTORY_REPORT_COMMIT),
      s3_client_call: "acquisition/src/_pv-ocr-pages-inventory.ts:473",
      size_measurement: "acquisition/src/_pv-ocr-pages-inventory.ts:248-252 (HeadObject Bucket=BUCKET, Key=key; ContentLength)",
    },
    ocr_stop_run: {
      report: STAGE_REPORT,
      report_commit: OCR_STOP_REPORT_COMMIT,
      guard_commit_is_ancestor: isAncestor(GUARD_COMMIT, OCR_STOP_REPORT_COMMIT),
      s3_client_call: "acquisition/src/pv-ocr-186-stage.ts:387",
      size_comparison: "acquisition/src/pv-ocr-186-stage.ts:410-415 (objectHead against BUCKET then compares ContentLength)",
    },
  };
}

function markdown(report: JsonRecord): string {
  const summary = asRecord(report.summary, "summary");
  const checks = report.checks as Check[];
  const lines = [
    "# Intégrité SHA-256 du CAS PV",
    "",
    `Résultat: **${String(summary.equal)} / ${String(summary.requested)}** clés ont SHA-256(octets) égal au nom; différent=${String(summary.different)}, unknown=${String(summary.unknown)}. Conclusion: **${String(summary.conclusion)}**.`,
    "",
    "Chaque objet a été lu une seule fois par `GetObject` et haché flux par flux; aucun PDF n'a été mis en mémoire intégralement.",
    "",
    "| Clé | Taille flux | SHA-256 recalculé | Nom |",
    "| --- | ---: | --- | --- |",
    ...checks.map((check) => `| \`${check.storage_key}\` | ${check.streamed_bytes === null ? "unknown" : String(check.streamed_bytes)} | ${check.recalculated_sha256 ?? "unknown"} | ${check.comparison} |`),
    "",
    `Endpoint/bucket: \`${String(asRecord(report.s3, "s3").endpoint)}\` / \`${String(asRecord(report.s3, "s3").bucket)}\`. La preuve historique des deux lanes et le détail par clé sont dans le JSON.`,
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const output = coveragePath(requiredArg("out"));
  const md = coveragePath(requiredArg("md"));
  assertS3RunEnvironment();
  const named = stageKeys();
  const target = s3Target();
  const checks: Check[] = [];
  let clientError: string | null = null;
  let client: S3Client | null = null;
  try {
    client = s3Client();
  } catch (error) {
    clientError = compactError(error);
  }

  if (client === null) {
    for (const key of named) {
      checks.push({
        storage_key: key,
        category: "named_by_ocr_stop",
        expected_sha256: expectedSha256(key),
        recalculated_sha256: null,
        comparison: "UNKNOWN",
        get_content_length: null,
        streamed_bytes: null,
        content_length_matches_streamed_bytes: null,
        error: clientError,
      });
    }
  } else {
    for (const key of named) checks.push(await verifyStream(client, key, "named_by_ocr_stop"));
  }

  const namedMismatch = checks.some((check) => check.comparison === "DIFFERENT");
  let sample: JsonRecord = {
    requested: INDEXED_WITNESSES + OTHER_WITNESSES,
    selection: "not_run",
    reason: namedMismatch ? "au moins une des 10 clés nommées diffère; arrêt imposé avant tout échantillon additionnel" : client === null ? "s3Client refusé; 20 clés non vérifiables" : null,
  };
  if (!namedMismatch && client !== null) {
    try {
      const selected = await randomControls(client, new Set(named), indexedSuccessKeys());
      sample = {
        requested: INDEXED_WITNESSES + OTHER_WITNESSES,
        selection: "stratified_random",
        method: "seed aléatoire 256-bit; les clés aux plus petits SHA-256(seed + newline + key) sont retenues dans chaque strate, sans remise",
        seed: selected.seed,
        listed_cas_pdfs: selected.listed_cas_pdfs,
        indexed_success_witnesses: selected.indexed,
        other_cas_witnesses: selected.other,
      };
      for (const key of selected.indexed) checks.push(await verifyStream(client, key, "random_indexed_success"));
      for (const key of selected.other) checks.push(await verifyStream(client, key, "random_other_cas"));
    } catch (error) {
      sample = {
        requested: INDEXED_WITNESSES + OTHER_WITNESSES,
        selection: "unknown",
        reason: compactError(error),
      };
    }
  }

  const equal = checks.filter((check) => check.comparison === "EQUAL").length;
  const different = checks.filter((check) => check.comparison === "DIFFERENT").length;
  const unknown = checks.filter((check) => check.comparison === "UNKNOWN").length;
  const fullSample = checks.length === named.length + INDEXED_WITNESSES + OTHER_WITNESSES;
  const healthy = fullSample && different === 0 && unknown === 0;
  const conclusion = different > 0
    ? "CAS_INTEGRITY_INCIDENT_STOPPED"
    : healthy
      ? "CAS_HEALTHY"
      : "CAS_INDETERMINATE";
  const report: JsonRecord = {
    contract: "pv-cas-integrite-sha256/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    s3: {
      target_config: "acquisition/config/s3-target.json",
      endpoint: target.endpoint,
      region: target.region,
      bucket: BUCKET,
      s3_client_constructed_after_guard: client !== null,
      ...(clientError === null ? {} : { s3_client_error: clientError }),
    },
    method: {
      transport: "S3 GetObject",
      hash: "sha256",
      memory: "streaming only; no PDF buffered in full",
      maximum_full_object_buffer_bytes: 0,
    },
    scope: {
      named_ocr_stop_report: STAGE_REPORT,
      named_keys_requested: named.length,
      additional_random_keys_requested: INDEXED_WITNESSES + OTHER_WITNESSES,
      sample,
    },
    historical_endpoint_evidence: historicalEndpointEvidence(),
    checks,
    summary: {
      requested: named.length + INDEXED_WITNESSES + OTHER_WITNESSES,
      attempted: checks.length,
      equal,
      different,
      unknown,
      conclusion,
      ...(healthy
        ? {
          inventory_fault: {
            source: "acquisition/src/_pv-ocr-pages-inventory.ts:312",
            association_line: "acquisition/src/_pv-ocr-pages-inventory.ts:318",
            measurement: "L'inventaire a bien mesuré HeadObject.ContentLength du même objet CAS à acquisition/src/_pv-ocr-pages-inventory.ts:248-252 (pas une URL d'origine, redirection ou préfixe homonyme).",
            finding: "uniqueRows est mesuré dans son ordre d'insertion à :474, puis uniqueDocuments trie seulement les clés à :312 et associe metadata[index] à la clé triée à :318. Les tailles sont donc attribuées à d'autres clés.",
            permutation_evidence: inventoryPermutationEvidence(checks),
          },
        }
        : {}),
    },
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(md, markdown(report), "utf8");
  process.stdout.write(JSON.stringify({ report: output.slice(ROOT.length + 1), md: md.slice(ROOT.length + 1), summary: report.summary }, null, 2) + "\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
