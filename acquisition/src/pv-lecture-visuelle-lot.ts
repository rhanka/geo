/**
 * Prepare a bounded visual-reading lot of scan-only PVs.
 *
 * Every selected CAS object is downloaded once, SHA-256 hashed while streaming,
 * and retained locally only when the digest equals its CAS filename.  It does
 * not OCR, interpret, graphify, or write to object storage.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-lecture-visuelle-lot.ts \
 *     --out=work/coverage/pv-lecture-visuelle-lot-01-preflight-YYYYMMDDTHHMMSSZ.json \
 *     [--prior-report=work/coverage/pv-lecture-visuelle-lot-01-YYYYMMDDTHHMMSSZ.json ...]
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import { basename, resolve } from "node:path";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const TRIAGE = resolve(COVERAGE, "pv-extraction-failures-triage-20260729T115007Z.json");
const INVENTORY = resolve(COVERAGE, "pv-ocr-inventaire-pages-20260729T122121Z.json");
const MAX_LOCAL_JSON_BYTES = 5 * 1024 * 1024;
const DEFAULT_LOT_SIZE = 20;
const MAX_LOT_SIZE = 186;
const MISMATCH_STOP = 3;
const CAS_PREFIX = "raw/pv-index/cas/";
const TERRITORIAL_V1_CLASSIFICATION_REPORTS = [
  "pv-capture-octets-classification-20260729t222149z-lot-0001.json",
  "pv-capture-octets-classification-20260729t222149z-lot-0002.json",
  "pv-capture-octets-classification-20260729t222149z-lot-0003.json",
  "pv-capture-octets-classification-20260729t222149z-lot-0004.json",
  "pv-capture-octets-classification-20260729t222149z-lot-0005.json",
  "pv-capture-octets-classification-20260729t222149z-lot-0006.json",
] as const;
const TERRITORIAL_V2_CLASSIFICATION_REPORTS = [
  "pv-capture-octets-classification-20260729t231834z-lot-0001.json",
  "pv-capture-octets-classification-20260729t231834z-lot-0002.json",
  "pv-capture-octets-classification-20260729t231834z-lot-0003.json",
  "pv-capture-octets-classification-20260729t231834z-lot-0004.json",
  "pv-capture-octets-classification-20260729t231834z-lot-0005.json",
  "pv-capture-octets-classification-20260729t231834z-lot-0006.json",
] as const;
const TERRITORIAL_V1_TARGETS = [
  ["020e9d0e", "4173"], ["07a2c09c", "c191"], ["1bb6c50a", "39e1"], ["1c7b0b22", "a388"],
  ["2168ba03", "9df8"], ["29d2ee15", "fb30"], ["2b3510fd", "0c9a"], ["2d29f473", "8e10"],
  ["3062d845", "a2fd"], ["332c4fff", "0bca"], ["397a02b0", "e792"], ["42559b4e", "79f0"],
  ["4bef4cb8", "5e7d"], ["75180933", "2b1d"], ["785eb6f4", "bda6"], ["948447cb", "51a9"],
  ["94ed636d", "6bd9"], ["9612c3dc", "532a"], ["9b4ac4f9", "1e12"], ["9e098919", "b4ee"],
  ["ab20f02a", "ad72"], ["b578c705", "df58"], ["cf9b58f8", "cb6e"], ["d376f4ed", "c6c0"],
  ["d6b5cd56", "b42a"], ["d94ea5db", "bc51"], ["dcb277af", "351a"], ["e0199770", "9232"],
  ["ec9ef5ee", "34a1"], ["ed2a4de8", "0151"], ["f15b3a46", "5fb9"], ["f5199086", "6ca8"],
  ["f8591bac", "0a53"], ["ff49faec", "9acc"],
] as const;
const TERRITORIAL_V2_EXACT_TARGETS = [
  "0a69d072b10d3faa88b96bde76b81159a03c68da26897b6e4ee12ab373ca06a1",
  "1b2be48854757cd5ee7d1361afc8c2b1305378b7629ed75d39338ba411d02f5c",
  "21a7e2cb1b98e0697d548db9749cd8b31bb2dfedc7357b72057d3a3bb9fbe2b7",
  "25a5a87891dbf5d02fc7cb4629cef0f73227f88e93bad00ff79f95586d319d82",
  "263d84f38fb86bd4a70334a36a4699799ac7e66f82dce42945a7648609123061",
  "349837e9ddaaaa104f1b6835323c78ea3c02b01e1572754d6d61419ee63042b7",
  "37609e7b07c9daf499ff2fa72c977cb236f485746dbe99dd2083d77a77f2f251",
  "3d59cade47ff6b300bab4b955344c9d1648391dc6c6b1f7e5f8dcc4d539c70ac",
  "3fd4d4b8e39c93daab0a499834e1a10fa8331627786504f0f1de92d41ac4a15a",
  "4c2450729eb6354713d53ea275893efa7ceb9efef2bafee03f3cf8847102fcc6",
  "618a31b83f3b8d8b7f2d270f2c86b068a88caa9f01346c2b0394166e1421a8d2",
  "6e02331ed6e36e60732781225f4da5fbc9fa74b0e98d4df7cab989dea6dc8ac1",
  "719bab8ad24c908ba5773a35b5d24c0823524a939f66c4fc7c9548f3ef46aecb",
  "71bdca47d14aa4345a67d4206113214f1f8f9c87502557d65fdd0161c0e5276d",
  "8c924cccf3d5fb2a865fe122b661e84692924da22ff65b4ee53b9ae01ec47207",
  "9472469330f1f4403f1fe891ef7caaf8e03bc070497b4dafef5dddf75c6d9616",
  "a451790d34daf1470e50b67011ad17bf455b2be6ba8e08eab93b81376d82beed",
  "a9c097b291b98863abc13fe9f55223b11c468ccc6b9e6df53ce2df297ae30599",
  "af33883c1c4c97ed11dea2cba333dc8c0a8156aa895220e789f78ae870419fce",
  "b2f1e4329332e7c33fb0d2b39cc304a48a4728350c1ee51a66b7b5cd10f50301",
  "c0709b3987bdb03eac705437414f38188ddf769cfeab9ffd6143c3c31ea0967b",
  "cc47fbd82813f9c9ec22fda9e8756608312bb144a35675ea906460d4dd734f4f",
  "cd00d92acbff6b82b836834d2d924724b04ae43c8a90b6b11bb29c0541cd5f99",
  "e43ac047ac0190b5ef2b3bbeebc2fc3155c3165d4948c5874f1147a69c7b70b7",
  "e6904d6df88cbe9a5356c033e96933474fc60c12f98ddeaf36ed76e50952c129",
  "f1b831a4192675639c880901ec5d3efb30ad4da3befca187905a145480fa9615",
  "f1fb57063d56b7ea2875139f50a0259563dbe06533b09eb8d29091a540d45ff3",
  "f73e5e816c80eda60ba1f0f99c25505d03854c36ffd81ba50c24a890cf46ee23",
] as const;
const TERRITORIAL_V2_TRUNCATED_TARGET = "5c42ed1778c7260f75267c6b0786a6bdd612e5a60cc5b99efbf62fa29ecab1";

type JsonRecord = Record<string, unknown>;
type IntegrityOutcome = "SHA_PASSED" | "CAS_SHA_MISMATCH" | "GET_FAILED";

interface SelectedDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string | null;
}

interface DocumentSelection {
  readonly description: string;
  readonly prior_lot_reports: readonly string[];
  readonly source_inventory: string | null;
  readonly candidate_cas_keys: number;
  readonly prior_lot_collisions_avoided: number;
  readonly remaining_after_dedupe: number;
  readonly unresolved_targets?: readonly { readonly prefix: string; readonly suffix: string; readonly status: "MISSING" | "AMBIGUOUS" | "MISMATCH"; readonly matching_keys: readonly string[] }[];
  readonly documents: SelectedDocument[];
}

interface GuardResult extends SelectedDocument {
  readonly expected_sha256: string;
  readonly calculated_sha256: string | null;
  readonly streamed_bytes: number | null;
  readonly outcome: IntegrityOutcome;
  readonly local_pdf_available: boolean;
  readonly error: string | null;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function requiredArg(name: string): string {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0]!;
}

function repeatedArg(name: string): string[] {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.some((value) => !value)) throw new Error(`--${name}=... ne peut pas être vide`);
  return values;
}

function optionalPositiveIntegerArg(name: string, fallback: number, maximum: number): number {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^[1-9][0-9]*$/u.test(values[0]!)) throw new Error(`--${name}=entier positif requis une seule fois`);
  const parsed = Number(values[0]);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`--${name}: entier entre 1 et ${maximum} requis`);
  return parsed;
}

function hasFlag(name: string): boolean {
  const occurrences = process.argv.slice(2).filter((value) => value === `--${name}`);
  if (occurrences.length > 1) throw new Error(`--${name} ne peut apparaître qu'une fois`);
  return occurrences.length === 1;
}

function record(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as JsonRecord;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, where);
}

function expectedSha256(key: string): string {
  const match = /^raw\/pv-index\/cas\/([a-f0-9]{64})\.pdf$/u.exec(key);
  if (!match) throw new Error(`${key}: clé CAS PDF sha256 requise`);
  return match[1]!;
}

function readSmallJson(path: string): JsonRecord {
  if (statSync(path).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${path}: lecture > 5 MiB interdite`);
  return record(JSON.parse(readFileSync(path, "utf8")), path);
}

function priorLotCasKeys(path: string): Set<string> {
  const prior = readSmallJson(path);
  if (!Array.isArray(prior.documents) || prior.documents.length !== DEFAULT_LOT_SIZE) {
    throw new Error(`${path}: documents[20] requis pour la déduplication du lot antérieur`);
  }
  const keys = prior.documents.map((value, index) => {
    const document = record(value, `${path}.documents[${index}]`);
    const key = string(document.storage_key, `${path}.documents[${index}].storage_key`);
    expectedSha256(key);
    return key;
  });
  if (new Set(keys).size !== DEFAULT_LOT_SIZE) throw new Error(`${path}: clés CAS du lot antérieur dupliquées`);
  return new Set(keys);
}

function initialSampleSelection(limit: number): DocumentSelection {
  if (statSync(TRIAGE).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${TRIAGE}: lecture > 5 MiB interdite`);
  const triage = readSmallJson(TRIAGE);
  const sample = record(triage.sample, "triage.sample");
  if (sample.inspected_documents !== 30 || !Array.isArray(sample.documents) || sample.documents.length !== 30) {
    throw new Error("triage: l'échantillon pur-scan attendu de 30 documents est invalide");
  }
  if (limit > sample.documents.length) throw new Error(`triage: --limit ne peut excéder les ${sample.documents.length} documents de l'échantillon initial`);
  const documents = sample.documents.slice(0, limit).map((value, index) => {
    const document = record(value, `triage.sample.documents[${index}]`);
    const key = string(document.storage_key, `triage.sample.documents[${index}].storage_key`);
    expectedSha256(key);
    return {
      storage_key: key,
      slug: string(document.slug, `triage.sample.documents[${index}].slug`),
      municipality_name: null,
    };
  });
  // `documents.length`, pas une constante: le dernier lot des 186 n'en compte que
  // 26, et comparer a une taille figee ferait lever un lot parfaitement valide.
  // Ce que le garde doit dire est « aucune cle en double », rien de plus.
  if (new Set(documents.map((document) => document.storage_key)).size !== documents.length) {
    throw new Error("triage: clés du lot dupliquées");
  }
  return {
    description: "les 20 premières entrées ordonnées de triage.sample.documents",
    prior_lot_reports: [],
    source_inventory: null,
    candidate_cas_keys: documents.length,
    prior_lot_collisions_avoided: 0,
    remaining_after_dedupe: 0,
    documents,
  };
}

function dedupedInventorySelection(priorReports: readonly string[], limit: number): DocumentSelection {
  if (priorReports.length === 0) throw new Error("au moins un --prior-report est requis pour la sélection sur inventaire");
  if (new Set(priorReports).size !== priorReports.length) throw new Error("--prior-report ne peut pas être répété");
  const inventory = readSmallJson(INVENTORY);
  if (inventory.input_commit !== "14c60a04" || inventory.source_triage !== "work/coverage/pv-extraction-failures-triage-20260729T115007Z.json") {
    throw new Error(`${INVENTORY}: ancrage triage inattendu`);
  }
  if (inventory.unique_failed_documents !== 186 || !Array.isArray(inventory.failed_documents) || inventory.failed_documents.length !== 186) {
    throw new Error(`${INVENTORY}: liste fermée de 186 clés CAS requise`);
  }
  const candidates = inventory.failed_documents.map((value, index) => {
    const document = record(value, `${INVENTORY}.failed_documents[${index}]`);
    const key = string(document.storage_key, `${INVENTORY}.failed_documents[${index}].storage_key`);
    expectedSha256(key);
    if (!Array.isArray(document.selection_offsets) || document.selection_offsets.some((offset) => !Number.isSafeInteger(offset) || (offset as number) < 0)) {
      throw new Error(`${INVENTORY}.failed_documents[${index}].selection_offsets: entiers positifs requis`);
    }
    if (document.selection_offsets.length === 0) throw new Error(`${INVENTORY}.failed_documents[${index}].selection_offsets: au moins un offset requis`);
    return {
      storage_key: key,
      slug: string(document.slug, `${INVENTORY}.failed_documents[${index}].slug`),
      municipality_name: nullableString(document.municipality_name, `${INVENTORY}.failed_documents[${index}].municipality_name`),
      first_selection_offset: Math.min(...document.selection_offsets as number[]),
    };
  });
  if (new Set(candidates.map((candidate) => candidate.storage_key)).size !== candidates.length) {
    throw new Error(`${INVENTORY}: clés CAS dupliquées`);
  }
  const priorKeys = new Set<string>();
  for (const report of priorReports) {
    for (const key of priorLotCasKeys(report)) {
      if (priorKeys.has(key)) throw new Error(`${report}: clé CAS déjà présente dans un lot antérieur`);
      priorKeys.add(key);
    }
  }
  const collisions = candidates.filter((candidate) => priorKeys.has(candidate.storage_key));
  if (collisions.length !== priorKeys.size) throw new Error(`${INVENTORY}: au moins une clé d'un lot antérieur manque de la liste des 186`);
  const remaining = candidates
    .filter((candidate) => !priorKeys.has(candidate.storage_key))
    .sort((left, right) => left.first_selection_offset - right.first_selection_offset || left.storage_key.localeCompare(right.storage_key));
  if (remaining.length !== candidates.length - priorKeys.size) throw new Error(`${INVENTORY}: déduplication incohérente, obtenue ${remaining.length}`);
  return {
    description: `les ${Math.min(limit, remaining.length)} clés CAS suivantes parmi les 186 échecs, ordonnées par premier offset de sélection puis clé CAS, après exclusion de tous les lots antérieurs`,
    prior_lot_reports: priorReports.map((report) => report.slice(ROOT.length + 1)),
    source_inventory: "work/coverage/pv-ocr-inventaire-pages-20260729T122121Z.json (clés, slugs et offsets seulement; pages/taille ignorées)",
    candidate_cas_keys: candidates.length,
    prior_lot_collisions_avoided: collisions.length,
    remaining_after_dedupe: remaining.length,
    documents: remaining.slice(0, limit).map(({ first_selection_offset: _offset, ...document }) => document),
  };
}

function territorialV1Selection(): DocumentSelection {
  const candidates: SelectedDocument[] = [];
  for (const name of TERRITORIAL_V1_CLASSIFICATION_REPORTS) {
    const path = resolve(COVERAGE, name);
    const report = readSmallJson(path);
    if (report.contract !== "pv-capture-octets-classification/v1" || !Array.isArray(report.lines)) {
      throw new Error(`${path}: inventaire territorial de classification invalide`);
    }
    for (const [index, value] of report.lines.entries()) {
      const line = record(value, `${path}.lines[${index}]`);
      if (line.storage_key === null || line.storage_key === undefined) continue;
      const key = string(line.storage_key, `${path}.lines[${index}].storage_key`);
      try {
        expectedSha256(key);
      } catch {
        continue;
      }
      candidates.push({
        storage_key: key,
        slug: string(line.slug, `${path}.lines[${index}].slug`),
        municipality_name: nullableString(line.municipality_name, `${path}.lines[${index}].municipality_name`),
      });
    }
  }
  if (new Set(candidates.map((candidate) => candidate.storage_key)).size !== candidates.length) {
    throw new Error("inventaire territorial: clé CAS dupliquée entre classifications");
  }
  const documents: SelectedDocument[] = [];
  const unresolved: { prefix: string; suffix: string; status: "MISSING" | "AMBIGUOUS" | "MISMATCH"; matching_keys: string[] }[] = [];
  for (const [prefix, suffix] of TERRITORIAL_V1_TARGETS) {
    const matches = candidates.filter((candidate) => candidate.storage_key.startsWith(`${CAS_PREFIX}${prefix}`));
    const keys = matches.map((candidate) => candidate.storage_key).sort((left, right) => left.localeCompare(right));
    if (matches.length === 0) {
      unresolved.push({ prefix, suffix, status: "MISSING", matching_keys: keys });
      continue;
    }
    if (matches.length !== 1) {
      unresolved.push({ prefix, suffix, status: "AMBIGUOUS", matching_keys: keys });
      continue;
    }
    if (!matches[0]!.storage_key.endsWith(`${suffix}.pdf`)) {
      unresolved.push({ prefix, suffix, status: "MISMATCH", matching_keys: keys });
      continue;
    }
    documents.push(matches[0]!);
  }
  return {
    description: "les 34 clés CAS du reliquat territorial v1, résolues par préfixe et suffixe depuis les six classifications de la vague 20260729t222149z",
    prior_lot_reports: [],
    source_inventory: TERRITORIAL_V1_CLASSIFICATION_REPORTS.map((name) => `work/coverage/${name}`).join(", "),
    candidate_cas_keys: candidates.length,
    prior_lot_collisions_avoided: 0,
    remaining_after_dedupe: documents.length,
    ...(unresolved.length > 0 ? { unresolved_targets: unresolved } : {}),
    documents,
  };
}

function territorialV2Selection(): DocumentSelection {
  const candidates: SelectedDocument[] = [];
  for (const name of TERRITORIAL_V2_CLASSIFICATION_REPORTS) {
    const path = resolve(COVERAGE, name);
    const report = readSmallJson(path);
    if (report.contract !== "pv-capture-octets-classification/v1" || !Array.isArray(report.lines)) {
      throw new Error(`${path}: inventaire territorial v2 de classification invalide`);
    }
    for (const [index, value] of report.lines.entries()) {
      const line = record(value, `${path}.lines[${index}]`);
      if (line.storage_key === null || line.storage_key === undefined) continue;
      const key = string(line.storage_key, `${path}.lines[${index}].storage_key`);
      try {
        expectedSha256(key);
      } catch {
        continue;
      }
      candidates.push({
        storage_key: key,
        slug: string(line.slug, `${path}.lines[${index}].slug`),
        municipality_name: nullableString(line.municipality_name, `${path}.lines[${index}].municipality_name`),
      });
    }
  }
  if (new Set(candidates.map((candidate) => candidate.storage_key)).size !== candidates.length) {
    throw new Error("inventaire territorial v2: clé CAS dupliquée entre classifications");
  }
  const documents: SelectedDocument[] = [];
  const unresolved: { prefix: string; suffix: string; status: "MISSING" | "AMBIGUOUS" | "MISMATCH"; matching_keys: string[] }[] = [];
  for (const sha256 of TERRITORIAL_V2_EXACT_TARGETS) {
    const key = `${CAS_PREFIX}${sha256}.pdf`;
    const matches = candidates.filter((candidate) => candidate.storage_key === key);
    if (matches.length !== 1) {
      unresolved.push({ prefix: sha256, suffix: "", status: matches.length === 0 ? "MISSING" : "AMBIGUOUS", matching_keys: matches.map((match) => match.storage_key).sort((left, right) => left.localeCompare(right)) });
      continue;
    }
    documents.push(matches[0]!);
  }
  const truncatedMatches = candidates.filter((candidate) => candidate.storage_key.startsWith(`${CAS_PREFIX}${TERRITORIAL_V2_TRUNCATED_TARGET}`));
  unresolved.push({
    prefix: TERRITORIAL_V2_TRUNCATED_TARGET,
    suffix: "",
    status: truncatedMatches.length === 0 ? "MISSING" : truncatedMatches.length === 1 ? "MISMATCH" : "AMBIGUOUS",
    matching_keys: truncatedMatches.map((match) => match.storage_key).sort((left, right) => left.localeCompare(right)),
  });
  return {
    description: "les 28 clés CAS complètes du reliquat territorial v2, résolues exactement depuis les six classifications de la vague 20260729t231834z; la 29e clé tronquée est exclue sans complétion devinée",
    prior_lot_reports: [],
    source_inventory: TERRITORIAL_V2_CLASSIFICATION_REPORTS.map((name) => `work/coverage/${name}`).join(", "),
    candidate_cas_keys: candidates.length,
    prior_lot_collisions_avoided: 0,
    remaining_after_dedupe: documents.length,
    unresolved_targets: unresolved,
    documents,
  };
}

function selectedDocuments(priorReports: readonly string[], limit: number, territorialV1: boolean, territorialV2: boolean): DocumentSelection {
  if (territorialV1 && territorialV2) throw new Error("--territorial-v1 et --territorial-v2 ne peuvent pas être combinés");
  if (territorialV1) {
    if (priorReports.length > 0) throw new Error("--territorial-v1 ne peut pas être combiné avec --prior-report");
    if (limit !== DEFAULT_LOT_SIZE) throw new Error("--territorial-v1 ne peut pas être combiné avec --limit");
    return territorialV1Selection();
  }
  if (territorialV2) {
    if (priorReports.length > 0) throw new Error("--territorial-v2 ne peut pas être combiné avec --prior-report");
    if (limit !== DEFAULT_LOT_SIZE) throw new Error("--territorial-v2 ne peut pas être combiné avec --limit");
    return territorialV2Selection();
  }
  return priorReports.length === 0 ? initialSampleSelection(limit) : dedupedInventorySelection(priorReports, limit);
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

async function downloadAndHash(document: SelectedDocument, workspace: string): Promise<GuardResult> {
  const expected = expectedSha256(document.storage_key);
  const finalPath = resolve(workspace, `${expected}.pdf`);
  const partialPath = `${finalPath}.${process.pid}.partial`;
  let streamed = 0;
  try {
    const response = await s3Client().send(new GetObjectCommand({ Bucket: BUCKET, Key: document.storage_key }));
    const body = response.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("GetObject sans flux asynchrone");
    const hash = createHash("sha256");
    const destination = createWriteStream(partialPath, { flags: "wx" });
    try {
      for await (const chunk of body) {
        streamed += chunk.byteLength;
        hash.update(chunk);
        if (!destination.write(chunk)) await once(destination, "drain");
      }
      destination.end();
      await finished(destination);
    } catch (error) {
      destination.destroy();
      throw error;
    }
    const calculated = hash.digest("hex");
    if (calculated !== expected) {
      rmSync(partialPath, { force: true });
      return { ...document, expected_sha256: expected, calculated_sha256: calculated, streamed_bytes: streamed, outcome: "CAS_SHA_MISMATCH", local_pdf_available: false, error: null };
    }
    if (existsSync(finalPath)) rmSync(finalPath, { force: true });
    renameSync(partialPath, finalPath);
    return { ...document, expected_sha256: expected, calculated_sha256: calculated, streamed_bytes: streamed, outcome: "SHA_PASSED", local_pdf_available: true, error: null };
  } catch (error) {
    rmSync(partialPath, { force: true });
    return { ...document, expected_sha256: expected, calculated_sha256: null, streamed_bytes: streamed === 0 ? null : streamed, outcome: "GET_FAILED", local_pdf_available: false, error: compactError(error) };
  }
}

function writeAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const output = resolve(ROOT, requiredArg("out"));
  const priorReportArgs = repeatedArg("prior-report");
  const requested = optionalPositiveIntegerArg("limit", DEFAULT_LOT_SIZE, MAX_LOT_SIZE);
  const territorialV1 = hasFlag("territorial-v1");
  const territorialV2 = hasFlag("territorial-v2");
  if (!output.startsWith(`${COVERAGE}/`)) throw new Error("--out doit rester sous work/coverage");
  if (existsSync(output)) throw new Error(`artefact déjà présent: ${output}`);
  const priorReports = priorReportArgs.map((report) => resolve(ROOT, report));
  if (priorReports.some((report) => !report.startsWith(`${COVERAGE}/`))) throw new Error("--prior-report doit rester sous work/coverage");
  assertS3RunEnvironment();
  const workspace = resolve(ROOT, "work", "graphify", basename(output, ".json"));
  mkdirSync(workspace, { recursive: true });
  const results: GuardResult[] = [];
  const selection = selectedDocuments(priorReports, requested, territorialV1, territorialV2);
  for (const document of selection.documents) {
    const result = await downloadAndHash(document, workspace);
    results.push(result);
    const mismatches = results.filter((value) => value.outcome === "CAS_SHA_MISMATCH").length;
    if (mismatches > MISMATCH_STOP) break;
  }
  const passed = results.filter((value) => value.outcome === "SHA_PASSED").length;
  const mismatches = results.filter((value) => value.outcome === "CAS_SHA_MISMATCH").length;
  const getFailed = results.filter((value) => value.outcome === "GET_FAILED").length;
  const stopped = mismatches > MISMATCH_STOP;
  const report = {
    contract: "pv-lecture-visuelle-preflight/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    source_triage: "work/coverage/pv-extraction-failures-triage-20260729T115007Z.json",
    selection: {
      description: selection.description,
      prior_lot_reports: selection.prior_lot_reports,
      source_inventory: selection.source_inventory,
      candidate_cas_keys: selection.candidate_cas_keys,
      prior_lot_collisions_avoided: selection.prior_lot_collisions_avoided,
      remaining_after_dedupe: selection.remaining_after_dedupe,
      ...(selection.unresolved_targets ? { unresolved_targets: selection.unresolved_targets } : {}),
    },
    guard: {
      before_visual_reading: true,
      transport: "S3 GetObject",
      hash: "sha256 streamé; aucune mise en mémoire intégrale du PDF",
      mismatch_stop_threshold: MISMATCH_STOP,
      stopped_for_integrity_incident: stopped,
    },
    summary: { requested: territorialV1 ? TERRITORIAL_V1_TARGETS.length : territorialV2 ? TERRITORIAL_V2_EXACT_TARGETS.length + 1 : requested, attempted: results.length, sha_passed: passed, cas_sha_mismatch: mismatches, get_failed: getFailed },
    local_visual_workspace: workspace,
    documents: results,
  };
  writeAtomic(output, report);
  process.stdout.write(`${JSON.stringify({ output: output.slice(ROOT.length + 1), summary: report.summary, stopped }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
