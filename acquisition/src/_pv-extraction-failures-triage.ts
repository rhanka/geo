/**
 * Audit read-only des échecs PDF du runner PV Graphify.
 *
 * Le script lit exclusivement les rapports batch déjà committés et des octets
 * CAS S3. Il ne lance ni Graphify ni OCR, ne capture rien et ne télécharge en
 * entier qu'un objet dont HeadObject confirme une taille <= 5 MiB.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_pv-extraction-failures-triage.ts \
 *     --out=work/coverage/pv-extraction-failures-triage-YYYYMMDDTHHMMSSZ.json \
 *     --md=work/coverage/pv-extraction-failures-triage-YYYYMMDDTHHMMSSZ.md
 */
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_LOCAL_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_FULL_OBJECT_BYTES = 5 * 1024 * 1024;
const PREFIX_BYTES = 64 * 1024;
const SUFFIX_BYTES = 64 * 1024;
const SAMPLE_SIZE = 30;
const FAILED = "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED";
const REPORT_PATTERN = /^work\/coverage\/pv-graphify-semantic-real-universe-20260729-batch-01-part-\d+\.json$/u;
const CAUSES = [
  "a_pdf_sans_couche_texte_scan_pur",
  "b_pdf_chiffre_ou_protege",
  "c_contenu_non_pdf",
  "d_pdf_valide_extracteur_en_echec",
  "e_fichier_tronque_ou_octets_manquants",
  "f_autre",
] as const;
type Cause = typeof CAUSES[number];

interface JsonRecord { readonly [key: string]: unknown }

interface Failure {
  readonly document_offset: number | null;
  readonly selection_offset: number;
  readonly selection_offset_hundred: number;
  readonly report: string;
  readonly storage_key: string;
  readonly slug: string;
  readonly failure_reason: string | null;
  readonly reported_failure_kind: string;
}

interface HeadedFailure extends Failure {
  readonly content_length: number;
}

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function asRecord(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet JSON requis`);
  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}.${key}: chaîne non vide requise`);
  return value;
}

function optionalString(record: JsonRecord, key: string, where: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${where}.${key}: chaîne ou null requis`);
  return value;
}

function requiredArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function optionalArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function insideRepo(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt refusé: ${path}`);
  return absolute;
}

function resolvedCommit(value: string | null): string {
  return execFileSync("git", ["rev-parse", "--verify", `${value ?? "HEAD"}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function committedReportPaths(commit: string): string[] {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "work/coverage"], {
    cwd: ROOT,
    encoding: "utf8",
  }).split("\n").filter((path) => REPORT_PATTERN.test(path));
  if (paths.length === 0) throw new Error("aucun rapport batch 20260729 committé trouvé");
  return paths.sort((left, right) => left.localeCompare(right));
}

function parseCommittedJson(commit: string, path: string): unknown {
  const size = Number(execFileSync("git", ["cat-file", "-s", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8" }));
  if (size > MAX_LOCAL_REPORT_BYTES) throw new Error(`${path}: ${size} octets > plafond ${MAX_LOCAL_REPORT_BYTES}`);
  return JSON.parse(execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: MAX_LOCAL_REPORT_BYTES + 1024,
  }));
}

function reportedFailureKind(reason: string | null): string {
  if (reason?.startsWith("pas de couche texte:")) return "NO_TEXT_LAYER_REPORTED";
  if (reason === "aborted") return "ABORTED";
  return "OTHER_REPORTED_FAILURE";
}

function collectFailures(commit: string, paths: readonly string[]): {
  failures: Failure[];
  reports: { path: string; failure_count: number; document_count: number }[];
} {
  const failures: Failure[] = [];
  const reports: { path: string; failure_count: number; document_count: number }[] = [];
  for (const path of paths) {
    const report = asRecord(parseCommittedJson(commit, path), path);
    if (report.contract !== "pv-graphify-semantic-control/v1") throw new Error(`${path}: contrat invalide`);
    const indexing = asRecord(report.indexing, `${path}.indexing`);
    const outcomes = asRecord(indexing.outcomes, `${path}.indexing.outcomes`);
    const declaredFailureCount = outcomes[FAILED];
    if (!Number.isInteger(declaredFailureCount) || (declaredFailureCount as number) < 0) {
      throw new Error(`${path}: ${FAILED} invalide`);
    }
    if (!Array.isArray(report.documents)) throw new Error(`${path}.documents invalide: les clés CAS ne sont pas observables`);
    const selection = asRecord(report.universe_selection, `${path}.universe_selection`);
    const selectionOffset = selection.offset;
    const selected = selection.selected;
    const requested = selection.requested ?? selected;
    const skipped = selection.skipped_indexed_cas_keys ?? [];
    if (!Number.isInteger(selectionOffset) || (selectionOffset as number) < 0 || !Number.isInteger(requested) || !Number.isInteger(selected)) {
      throw new Error(`${path}.universe_selection: offset/requested/selected invalides`);
    }
    if (!Array.isArray(skipped) || skipped.some((key) => typeof key !== "string")) throw new Error(`${path}.universe_selection.skipped_indexed_cas_keys invalide`);
    if (report.documents.length !== selected) throw new Error(`${path}: documents ${report.documents.length} != selected ${selected}`);
    const documentOffsetsObservable = skipped.length === 0 && selected === requested;
    let actualFailureCount = 0;
    for (const [index, raw] of report.documents.entries()) {
      const document = asRecord(raw, `${path}.documents[${index}]`);
      if (document.outcome !== FAILED) continue;
      actualFailureCount++;
      const storageKey = requiredString(document, "storage_key", `${path}.documents[${index}]`);
      failures.push({
        document_offset: documentOffsetsObservable ? (selectionOffset as number) + index : null,
        selection_offset: selectionOffset as number,
        selection_offset_hundred: Math.floor((selectionOffset as number) / 100) * 100,
        report: path,
        storage_key: storageKey,
        slug: requiredString(document, "slug", `${path}.documents[${index}]`),
        failure_reason: optionalString(document, "failure_reason", `${path}.documents[${index}]`),
        reported_failure_kind: reportedFailureKind(optionalString(document, "failure_reason", `${path}.documents[${index}]`)),
      });
    }
    if (actualFailureCount !== declaredFailureCount) {
      throw new Error(`${path}: ${FAILED} déclaré ${declaredFailureCount}, documents observés ${actualFailureCount}`);
    }
    reports.push({ path, failure_count: actualFailureCount, document_count: report.documents.length });
  }
  return { failures, reports };
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

async function contentLength(s3: S3Client, failure: Failure): Promise<HeadedFailure> {
  const response = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: failure.storage_key }));
  if (!Number.isInteger(response.ContentLength) || response.ContentLength === undefined || response.ContentLength < 0) {
    throw new Error(`${failure.storage_key}: HeadObject sans ContentLength valable`);
  }
  return { ...failure, content_length: response.ContentLength };
}

async function readRange(s3: S3Client, key: string, start: number, end: number): Promise<Buffer> {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${end}` }));
  const body = response.Body as AsyncIterable<Buffer> & { destroy?: (error?: Error) => void };
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.length;
    if (length > MAX_FULL_OBJECT_BYTES) {
      body.destroy?.(new Error(`réponse S3 hors plafond: ${key}`));
      throw new Error(`${key}: réponse range > plafond`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function command(command: string, args: readonly string[], input: Buffer, maxBuffer = 256 * 1024): CommandResult {
  const result = spawnSync(command, args, { input, encoding: "utf8", maxBuffer });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function countFontRows(stdout: string): number | null {
  const line = stdout.split("\n").findIndex((value) => /^(?:-+\s*)+$/u.test(value.trim()));
  if (line < 0) return null;
  return stdout.split("\n").slice(line + 1).filter((value) => value.trim()).length;
}

function countImageRows(stdout: string): number | null {
  if (!stdout.includes("page")) return null;
  return stdout.split("\n").filter((value) => /^\s*\d+\s+\d+\s+/u.test(value)).length;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 300);
}

function classifyPdf(args: {
  readonly full: Buffer | null;
  readonly prefix: Buffer;
  readonly suffix: Buffer;
  readonly contentLength: number;
}): {
  cause: Cause;
  magic: string;
  header_hex: string;
  pdf_version: string | null;
  eof_marker_present: boolean;
  encrypted_marker_present: boolean;
  inspection_mode: "full_lte_5_mib" | "prefix_and_suffix_only";
  observations: string[];
  tools: JsonRecord | null;
} {
  const headerHex = args.prefix.subarray(0, 32).toString("hex");
  const headerText = args.prefix.subarray(0, 1024).toString("latin1");
  const tailText = args.suffix.toString("latin1");
  const pdfAt = headerText.indexOf("%PDF-");
  const isPdf = pdfAt >= 0 && pdfAt <= 1024;
  const version = isPdf ? headerText.slice(pdfAt).match(/^%PDF-(\d\.\d)/u)?.[1] ?? null : null;
  const eof = tailText.includes("%%EOF");
  const encryptedMarker = /\/Encrypt\b/u.test(`${headerText}\n${tailText}`);
  const mode = args.full === null ? "prefix_and_suffix_only" : "full_lte_5_mib";
  if (!isPdf) {
    const leading = args.prefix.subarray(0, 16).toString("latin1").replace(/[\x00-\x1f\x7f-\xff]/gu, ".");
    return {
      cause: "c_contenu_non_pdf",
      magic: leading,
      header_hex: headerHex,
      pdf_version: null,
      eof_marker_present: eof,
      encrypted_marker_present: encryptedMarker,
      inspection_mode: mode,
      observations: ["Les premiers octets ne portent pas %PDF-; contenu réel non-PDF."],
      tools: null,
    };
  }
  if (args.full === null) {
    return {
      cause: !eof ? "e_fichier_tronque_ou_octets_manquants" : encryptedMarker ? "b_pdf_chiffre_ou_protege" : "f_autre",
      magic: "%PDF-",
      header_hex: headerHex,
      pdf_version: version,
      eof_marker_present: eof,
      encrypted_marker_present: encryptedMarker,
      inspection_mode: mode,
      observations: !eof
        ? ["PDF annoncé mais le suffixe borné ne contient pas %%EOF: octets terminaux manquants."]
        : encryptedMarker
          ? ["PDF annoncé; /Encrypt apparaît dans les octets inspectés."]
          : ["PDF avec %%EOF, mais > 5 MiB: inspection bornée; ni extraction complète ni OCR n'ont été lancés."],
      tools: null,
    };
  }

  const pdfinfo = command("pdfinfo", ["-"], args.full);
  const text = command("pdftotext", ["-layout", "-", "-"], args.full);
  const fonts = command("pdffonts", ["-"], args.full);
  const images = command("pdfimages", ["-list", "-"], args.full);
  const encrypted = encryptedMarker || /^Encrypted:\s+yes/im.test(pdfinfo.stdout) || /password|encrypt/iu.test(`${pdfinfo.stderr}\n${text.stderr}`);
  const textPresent = /\S/u.test(text.stdout);
  const fontRows = countFontRows(fonts.stdout);
  const imageRows = countImageRows(images.stdout);
  const pdfinfoOk = pdfinfo.status === 0;
  const parseFailure = /trailer|xref|endobj|damaged|syntax error|couldn't find/iu.test(`${pdfinfo.stderr}\n${text.stderr}`);
  const tools = {
    pdfinfo: { exit_code: pdfinfo.status, summary: compact(pdfinfo.stdout), stderr: compact(pdfinfo.stderr) },
    pdftotext: { exit_code: text.status, non_whitespace_text: textPresent, stderr: compact(text.stderr) },
    pdffonts: { exit_code: fonts.status, font_rows: fontRows, stderr: compact(fonts.stderr) },
    pdfimages: { exit_code: images.status, image_rows: imageRows, stderr: compact(images.stderr) },
  };
  let cause: Cause;
  let observation: string;
  if (encrypted) {
    cause = "b_pdf_chiffre_ou_protege";
    observation = "PDF valide ou annoncé, mais marqueur /Encrypt ou refus par mot de passe observé.";
  } else if (!eof && (!pdfinfoOk || parseFailure)) {
    cause = "e_fichier_tronque_ou_octets_manquants";
    observation = "PDF annoncé sans %%EOF et les outils signalent une structure incomplète.";
  } else if (pdfinfoOk && text.status === 0 && !textPresent && fontRows === 0 && (imageRows ?? 0) > 0) {
    cause = "a_pdf_sans_couche_texte_scan_pur";
    observation = "pdfinfo lit le PDF; pdftotext retourne zéro texte; pdffonts ne trouve aucune police et pdfimages trouve des images.";
  } else if (pdfinfoOk && text.status !== 0) {
    cause = "d_pdf_valide_extracteur_en_echec";
    observation = "pdfinfo valide le PDF mais pdftotext échoue hors chiffrement/troncature.";
  } else if (pdfinfoOk && !textPresent && (fontRows ?? 0) > 0) {
    cause = "d_pdf_valide_extracteur_en_echec";
    observation = "PDF valide avec des polices; pdftotext ne rend aucun texte: échec de l'extracteur, pas scan pur démontré.";
  } else if (!pdfinfoOk && parseFailure) {
    cause = "e_fichier_tronque_ou_octets_manquants";
    observation = "Les parseurs signalent une structure PDF endommagée/incomplète.";
  } else {
    cause = "f_autre";
    observation = textPresent
      ? "pdftotext rend aujourd'hui du texte malgré l'échec historisé: échec du run à investiguer."
      : "PDF lu sans preuve suffisante pour l'une des cinq causes prescrites.";
  }
  return {
    cause,
    magic: "%PDF-",
    header_hex: headerHex,
    pdf_version: version,
    eof_marker_present: eof,
    encrypted_marker_present: encryptedMarker,
    inspection_mode: mode,
    observations: [observation],
    tools,
  };
}

function selectSample(candidates: readonly HeadedFailure[]): HeadedFailure[] {
  const ordered = [...candidates].sort((left, right) =>
    left.selection_offset - right.selection_offset || left.storage_key.localeCompare(right.storage_key));
  const chosen: HeadedFailure[] = [];
  const chosenKeys = new Set<string>();
  const add = (candidate: HeadedFailure | undefined): void => {
    if (candidate && !chosenKeys.has(candidate.storage_key) && chosen.length < SAMPLE_SIZE) {
      chosen.push(candidate);
      chosenKeys.add(candidate.storage_key);
    }
  };
  // Chaque motif d'échec du runner est représenté avant de répartir le reste
  // par tranche de 100 offsets; un objet <=5 MiB est préféré pour une preuve
  // structurale complète, sans exclure un motif qui ne l'est pas.
  for (const kind of [...new Set(ordered.map((candidate) => candidate.reported_failure_kind))].sort()) {
    const ofKind = ordered.filter((candidate) => candidate.reported_failure_kind === kind);
    add(ofKind.find((candidate) => candidate.content_length <= MAX_FULL_OBJECT_BYTES) ?? ofKind[0]);
  }
  const hundreds = [...new Set(ordered.map((candidate) => candidate.selection_offset_hundred))].sort((left, right) => left - right);
  for (let round = 0; chosen.length < SAMPLE_SIZE; round++) {
    let added = false;
    for (const hundred of hundreds) {
      const inBucket = ordered.filter((candidate) => candidate.selection_offset_hundred === hundred && !chosenKeys.has(candidate.storage_key));
      add(inBucket.find((candidate) => candidate.content_length <= MAX_FULL_OBJECT_BYTES) ?? inBucket[0]);
      added ||= inBucket.length > 0;
      if (chosen.length === SAMPLE_SIZE) break;
    }
    if (!added) break;
  }
  if (chosen.length !== SAMPLE_SIZE) throw new Error(`échantillon incomplet: ${chosen.length}/${SAMPLE_SIZE}`);
  return chosen.sort((left, right) => left.selection_offset - right.selection_offset || left.storage_key.localeCompare(right.storage_key));
}

function counts<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce((total, value) => ({ ...total, [value]: (total[value] ?? 0) + 1 }), {} as Record<T, number>);
}

function distributionByHundred(failures: readonly Failure[]): { offset_start: number; offset_end_inclusive: number; failures: number }[] {
  return [...new Set(failures.map((failure) => failure.selection_offset_hundred))].sort((left, right) => left - right)
    .map((start) => ({ offset_start: start, offset_end_inclusive: start + 99, failures: failures.filter((failure) => failure.selection_offset_hundred === start).length }));
}

function markdown(report: JsonRecord): string {
  const census = asRecord(report.failure_census, "report.failure_census");
  const sample = asRecord(report.sample, "report.sample");
  const outcomeDistribution = census.failure_outcome_distribution_by_selection_offset_hundred as { offset_start: number; offset_end_inclusive: number; failures: number }[];
  const causeCounts = sample.cause_counts as Record<Cause, number>;
  const sampleDocuments = sample.documents as JsonRecord[];
  const example = (cause: Cause): JsonRecord | null => sampleDocuments.find((document) => document.cause === cause) ?? null;
  const lines = [
    "# Triage des échecs d'extraction PV",
    "",
    `Rapports batch committés lus: ${String(census.report_count)}. Les clés CAS sont présentes dans \`documents[].storage_key\`; ${String(census.failure_documents_with_exact_document_offset_unobservable)} échecs n'ont pas d'offset individuel reconstruisible après skips, donc le tableau groupe l'offset de sélection porté par chaque rapport.`,
    "",
    "## Recensement",
    "",
    "| Offsets de sélection | Issues d'échec |",
    "| --- | ---: |",
    ...outcomeDistribution.map((row) => `| ${row.offset_start}-${row.offset_end_inclusive} | ${row.failures} |`),
    "",
    "## Échantillon fermé de 30",
    "",
    "| Cause | N | Exemple CAS / premiers octets / constat |",
    "| --- | ---: | --- |",
    ...CAUSES.map((cause) => {
      const value = example(cause);
      return value === null
        ? `| ${cause} | ${causeCounts[cause] ?? 0} | — |`
        : `| ${cause} | ${causeCounts[cause] ?? 0} | \`${String(value.storage_key)}\`; \`${String(value.header_hex)}\`; ${String((value.observations as string[])[0])} |`;
    }),
    "",
    "## Limite et arbitrage OCR",
    "",
    String(report.conclusion),
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const out = requiredArg("out");
  const md = requiredArg("md");
  const outputPath = insideRepo(out);
  const markdownPath = insideRepo(md);
  const commit = resolvedCommit(optionalArg("commit"));
  const reportPaths = committedReportPaths(commit);
  const { failures, reports } = collectFailures(commit, reportPaths);
  const uniqueFailures = [...new Map(failures.map((failure) => [failure.storage_key, failure])).values()];
  const duplicateRows = failures.length - uniqueFailures.length;
  const outcomeDistribution = distributionByHundred(failures);
  const reportedKinds = counts(failures.map((failure) => failure.reported_failure_kind));
  const s3 = s3Client();
  const headed = await mapConcurrent(failures, 4, async (failure) => contentLength(s3, failure));
  const selected = selectSample(headed);
  const documents = await mapConcurrent(selected, 4, async (failure) => {
    const full = failure.content_length <= MAX_FULL_OBJECT_BYTES
      ? await readRange(s3, failure.storage_key, 0, Math.max(0, failure.content_length - 1))
      : null;
    const prefix = full ?? await readRange(s3, failure.storage_key, 0, Math.min(PREFIX_BYTES, failure.content_length) - 1);
    const suffix = full ?? await readRange(s3, failure.storage_key, Math.max(0, failure.content_length - SUFFIX_BYTES), failure.content_length - 1);
    return { ...failure, ...classifyPdf({ full, prefix, suffix, contentLength: failure.content_length }) };
  });
  const causeCounts = Object.fromEntries(CAUSES.map((cause) => [cause, documents.filter((document) => document.cause === cause).length])) as Record<Cause, number>;
  const partitionTotal = Object.values(causeCounts).reduce((total, count) => total + count, 0);
  if (partitionTotal !== SAMPLE_SIZE) throw new Error(`partition non fermée: ${partitionTotal}/${SAMPLE_SIZE}`);
  const reportedNoText = reportedKinds.NO_TEXT_LAYER_REPORTED ?? 0;
  const ocrScope = reportedNoText;
  const ocrScopeUnique = new Set(failures
    .filter((failure) => failure.reported_failure_kind === "NO_TEXT_LAYER_REPORTED")
    .map((failure) => failure.storage_key)).size;
  const conclusion =
    `${causeCounts.a_pdf_sans_couche_texte_scan_pur}/${SAMPLE_SIZE} échantillons sont des scans purs démontrés; ceci ne classe pas par extrapolation les ${ocrScopeUnique} CAS uniques. ` +
    `${ocrScope} issues d'échec, soit ${ocrScopeUnique} CAS uniques, portent explicitement «pas de couche texte» dans le rapport source: c'est le périmètre candidat OCR, pas une preuve octet par octet hors échantillon. ` +
    `OCR n'a pas été lancé. Le tarif documenté est 0,001 USD/page; aucun total USD n'est calculé sans dénombrement complet des pages, pour ne pas estimer. ` +
    `${causeCounts.d_pdf_valide_extracteur_en_echec > 0 ? "Des PDF valides en échec d'extracteur existent: défaut chez nous à corriger." : "Aucun PDF valide en échec d'extracteur dans l'échantillon: le défaut n'est pas démontré chez nous."}`;
  const report: JsonRecord = {
    contract: "pv-extraction-failures-triage/v1",
    generated_at: new Date().toISOString(),
    input_commit: commit,
    method: {
      read_only: true,
      ocr_launched: false,
      graphify_or_indexing_launched: false,
      local_report_limit_bytes: MAX_LOCAL_REPORT_BYTES,
      object_read_policy: "HeadObject pour tous les échecs; GET complet seulement si <= 5 MiB, sinon préfixe et suffixe de 64 KiB.",
      sample_selection: "Motifs d'échec reportés représentés d'abord, puis répartition en tours sur les tranches de 100 offsets; petit objet préféré.",
      ocr_price_usd_per_page: 0.001,
      ocr_price_source: "docs/spec/methodes-acquisition.md:282",
    },
    failure_census: {
      report_count: reports.length,
      reports,
      exact_failed_outcome_rows: failures.length,
      exact_unique_failed_cas_keys: failures.length - duplicateRows,
      duplicate_failure_rows: duplicateRows,
      cas_keys_observable_in_reports: true,
      failure_outcome_distribution_by_selection_offset_hundred: outcomeDistribution,
      failure_documents_with_exact_document_offset_unobservable: failures.filter((failure) => failure.document_offset === null).length,
      reported_failure_kinds: reportedKinds,
      ocr_candidate_failure_outcomes_from_reported_no_text_layer: ocrScope,
      ocr_candidate_unique_documents_from_reported_no_text_layer: ocrScopeUnique,
    },
    sample: {
      requested_documents: SAMPLE_SIZE,
      inspected_documents: documents.length,
      partition_total: partitionTotal,
      cause_counts: causeCounts,
      documents,
    },
    conclusion,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(report), "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
