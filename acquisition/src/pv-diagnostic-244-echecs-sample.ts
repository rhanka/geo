/**
 * Read-only sample diagnostic for the preserved 244-candidate PV trace list.
 *
 * It never calls fetch/capturedFetch and never writes S3.  The only remote
 * reads are bounded S3 reads of already-captured run manifests and (only for
 * the sampled HTML / readable-non-PV cases) their already-captured CAS body.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-diagnostic-244-echecs-sample.ts \
 *     --list=work/coverage/pv-diagnostic-244-echecs-...json \
 *     --out=work/coverage/pv-diagnostic-244-echecs-...json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseManifestJsonl, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { assessPvHtmlResource } from "./lib/pv-html-resource-verdict.js";
import { getBytes, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_LOCAL_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_S3_READ_BYTES = 5 * 1024 * 1024;
const SAMPLE_SIZE = 40;
const SAMPLE_SEED = "pv-diagnostic-244-echecs/20260730";

type SourceVerdict =
  | "AUTRE"
  | "CAPTURE_SANS_OCTETS"
  | "DOCUMENT_LISIBLE_NON_PV"
  | "HTTP_403"
  | "HTTP_404"
  | "HTTP_AUTRE"
  | "PAGE_HTML"
  | "PDF_SANS_COUCHE_TEXTE"
  | "PV_LISIBLE_PROPRIETAIRE_CONFIRME"
  | "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME";

type Cause =
  | "PV_CONFIRMÉ_NON_INDEXÉ"
  | "PDF_SANS_COUCHE_TEXTE"
  | "HTTP_404"
  | "HTTP_403_ANTIBOT_UA_NAVIGATEUR"
  | "HTTP_403_UA_NON_RÉVÉRIFIÉ"
  | "OCTETS_NON_PV"
  | "ÉCHEC_TRANSPORT_OPAQUE"
  | "PV_PROPRIÉTAIRE_NON_CONFIRMÉ"
  | "CAPTURE_SANS_OCTETS"
  | "AUTRE"
  | "TRACE_ABSENTE";

interface Attempt {
  readonly campaign: string;
  readonly url: string;
  readonly verdict: SourceVerdict;
  readonly http_status: number | null;
  readonly host: string;
  readonly source_report: string;
  readonly manifest_key: string;
  readonly line_index: number;
  readonly run_id: string;
  readonly storage_key: string | null;
  readonly detail: string;
  readonly owner_verbatim: string | null;
  readonly pv_verbatim: string | null;
}

interface Municipality {
  readonly slug: string;
  readonly municipality_name: string | null;
  readonly candidate: { readonly source: "pv-index"; readonly url: string; readonly host: string };
  readonly attempts: readonly Attempt[];
}

interface TraceList {
  readonly contract: "pv-diagnostic-244-echecs-trace-list/v1";
  readonly trace_counts: {
    readonly candidates: number;
    readonly candidates_with_trace: number;
    readonly candidates_without_trace: number;
    readonly candidates_with_one_trace: number;
    readonly candidates_with_multiple_traces: number;
    readonly matched_attempts: number;
  };
  readonly verdict_counts: Record<SourceVerdict, number>;
  readonly municipalities: readonly Municipality[];
}

interface ManifestEvidence {
  readonly line: CaptureManifestLine;
  readonly line_index_match: "exact" | "url_fallback";
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: chaîne non vide requise`);
  return value.trim();
}

function insideRepo(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function readSmallJson(path: string): unknown {
  const absolute = insideRepo(path);
  const size = statSync(absolute).size;
  if (size > MAX_LOCAL_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture`);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function requiredOption(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=... est requis`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function assertTraceList(value: unknown, path: string): TraceList {
  const root = record(value, path);
  if (root.contract !== "pv-diagnostic-244-echecs-trace-list/v1") throw new Error(`${path}: contrat trace-list requis`);
  const traceCounts = record(root.trace_counts, `${path}.trace_counts`);
  const numbers = ["candidates", "candidates_with_trace", "candidates_without_trace", "candidates_with_one_trace", "candidates_with_multiple_traces", "matched_attempts"] as const;
  for (const name of numbers) if (!Number.isInteger(traceCounts[name])) throw new Error(`${path}.trace_counts.${name}: entier requis`);
  const verdictCounts = record(root.verdict_counts, `${path}.verdict_counts`);
  const verdictTotal = Object.values(verdictCounts).reduce<number>((sum, count) => {
    if (!Number.isInteger(count)) throw new Error(`${path}.verdict_counts: entier requis`);
    return sum + Number(count);
  }, 0);
  if (verdictTotal !== Number(traceCounts.matched_attempts)) throw new Error(`${path}.verdict_counts: total divergent des traces`);
  if (!Array.isArray(root.municipalities)) throw new Error(`${path}.municipalities: tableau requis`);
  return root as unknown as TraceList;
}

/** Deterministic pseudo-random selection, avoiding a first-40 alphabetical bias. */
function sampleWithoutReplacement<T>(values: readonly T[], count: number, seed: string): T[] {
  if (count > values.length) throw new Error(`échantillon ${count}/${values.length} impossible`);
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32BE(0);
  const random = (): number => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled.slice(0, count).sort((left, right) => {
    const leftSlug = (left as Municipality).slug;
    const rightSlug = (right as Municipality).slug;
    return leftSlug.localeCompare(rightSlug);
  });
}

function causeFor(attempt: Attempt | null, s3Available: boolean): Cause {
  if (attempt === null) return "TRACE_ABSENTE";
  switch (attempt.verdict) {
    case "PV_LISIBLE_PROPRIETAIRE_CONFIRME": return "PV_CONFIRMÉ_NON_INDEXÉ";
    case "PDF_SANS_COUCHE_TEXTE": return "PDF_SANS_COUCHE_TEXTE";
    case "HTTP_404": return "HTTP_404";
    case "HTTP_403": return s3Available ? "HTTP_403_ANTIBOT_UA_NAVIGATEUR" : "HTTP_403_UA_NON_RÉVÉRIFIÉ";
    case "PAGE_HTML":
    case "DOCUMENT_LISIBLE_NON_PV": return "OCTETS_NON_PV";
    case "HTTP_AUTRE": return "ÉCHEC_TRANSPORT_OPAQUE";
    case "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME": return "PV_PROPRIÉTAIRE_NON_CONFIRMÉ";
    case "CAPTURE_SANS_OCTETS": return "CAPTURE_SANS_OCTETS";
    case "AUTRE": return "AUTRE";
  }
}

async function readBoundedS3Object(s3: ReturnType<typeof s3Client>, key: string): Promise<Buffer> {
  const metadata = await objectHead(s3, key);
  if (!metadata.exists || metadata.contentLength === undefined) throw new Error(`S3 absent ou sans taille: ${key}`);
  if (metadata.contentLength > MAX_S3_READ_BYTES) throw new Error(`${key}: ${metadata.contentLength} octets > plafond de lecture`);
  return getBytes(s3, key);
}

async function manifestEvidence(
  s3: ReturnType<typeof s3Client>,
  attempt: Attempt,
  cache: Map<string, readonly CaptureManifestLine[]>,
): Promise<ManifestEvidence> {
  let lines = cache.get(attempt.manifest_key);
  if (lines === undefined) {
    lines = parseManifestJsonl((await readBoundedS3Object(s3, attempt.manifest_key)).toString("utf8"));
    cache.set(attempt.manifest_key, lines);
  }
  const indexed = lines[attempt.line_index];
  if (indexed !== undefined && canonicalUrl(indexed.url) === canonicalUrl(attempt.url)) {
    return { line: indexed, line_index_match: "exact" };
  }
  const matches = lines.filter((line) => canonicalUrl(line.url) === canonicalUrl(attempt.url));
  if (matches.length !== 1) throw new Error(`${attempt.manifest_key}: ligne ${attempt.line_index} non retraçable pour ${attempt.url}`);
  return { line: matches[0]!, line_index_match: "url_fallback" };
}

async function inspectNonPvBody(
  s3: ReturnType<typeof s3Client>,
  municipality: Municipality,
  attempt: Attempt,
): Promise<Record<string, unknown>> {
  if (attempt.storage_key === null) return { opened: false, reason: "aucune clé CAS" };
  const bytes = await readBoundedS3Object(s3, attempt.storage_key);
  if (attempt.verdict === "PAGE_HTML") {
    const assessment = assessPvHtmlResource(bytes, attempt.url, municipality.municipality_name ?? municipality.slug);
    return {
      opened: true,
      bytes: bytes.byteLength,
      kind: "html",
      verdict: assessment.verdict,
      reason: assessment.reason,
      title: assessment.title,
      evidence: assessment.evidence,
      visible_text_excerpt: assessment.visible_text_excerpt,
    };
  }
  const native = extractNativeDocumentText(bytes, { sourceName: attempt.url });
  return {
    opened: true,
    bytes: bytes.byteLength,
    kind: bytes.subarray(0, 4).equals(Buffer.from("%PDF")) ? "pdf" : "other",
    native_text_available: native.text !== null,
    native_text_excerpt: native.text?.replace(/\s+/gu, " ").slice(0, 600) ?? null,
    extraction_blocker: native.blocker ?? null,
  };
}

function recoveryClass(cause: Cause): "immédiat" | "investigation" | "non_direct" | "inconnu" {
  switch (cause) {
    case "PV_CONFIRMÉ_NON_INDEXÉ":
    case "PDF_SANS_COUCHE_TEXTE": return "immédiat";
    case "PV_PROPRIÉTAIRE_NON_CONFIRMÉ":
    case "HTTP_404":
    case "TRACE_ABSENTE": return "investigation";
    case "ÉCHEC_TRANSPORT_OPAQUE":
    case "AUTRE":
    case "CAPTURE_SANS_OCTETS": return "inconnu";
    case "HTTP_403_ANTIBOT_UA_NAVIGATEUR":
    case "HTTP_403_UA_NON_RÉVÉRIFIÉ":
    case "OCTETS_NON_PV": return "non_direct";
  }
}

function markdown(report: Record<string, unknown>, out: string): string {
  const sample = report.sample as { population: number; size: number; cause_counts: Record<string, number>; plausible_recoverable: number; extrapolated_recoverable: number };
  const trace = report.trace_list as { trace_counts: { candidates_with_trace: number; candidates_without_trace: number } };
  const census = report.full_trace_census as { confirmed_pv_not_indexed: number; pdf_without_text_layer: number; immediate_queue: number };
  const readOnly = report.read_only as { s3_read_mode: string };
  const causes = Object.entries(sample.cause_counts).map(([cause, count]) => `${cause}: ${count}`).join("; ");
  return [
    "# Diagnostic des 244 échecs PV",
    "",
    `Rapport: \`${out}\`. Jointure: ${trace.trace_counts.candidates_with_trace} traces / ${trace.trace_counts.candidates_without_trace} sans trace.`,
    `Échantillon aléatoire déterministe: ${sample.size}/${sample.population}; partition fermée: ${causes}.`,
    `Census des traces: ${census.confirmed_pv_not_indexed} PV confirmés non indexés + ${census.pdf_without_text_layer} PDF sans texte = file immédiate ${census.immediate_queue}.`,
    `Réparable plausible dans l'échantillon: ${sample.plausible_recoverable}/${sample.size}; extrapolation descriptive: ${sample.extrapolated_recoverable}/${sample.population}.`,
    readOnly.s3_read_mode === "manifeste et corps bornés"
      ? "Les 403 ont été vérifiés contre l'UA navigateur journalisé; les échecs transport opaques ne sont pas déclarés hôtes morts."
      : "Les 403 ne sont pas déclarés anti-bot sans ré-vérification; les échecs transport opaques ne sont pas déclarés hôtes morts.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const listPath = requiredOption("list");
  const outRelative = requiredOption("out");
  const offlineS3 = hasFlag("offline-s3");
  const out = insideRepo(outRelative);
  const markdownOut = `${out.slice(0, -".json".length)}.md`;
  if (!out.endsWith(".json")) throw new Error("--out doit finir par .json");
  const trace = assertTraceList(readSmallJson(listPath), listPath);
  if (trace.trace_counts.candidates !== trace.municipalities.length) throw new Error(`${listPath}: cardinal candidat divergent`);
  if (trace.trace_counts.candidates !== 244) throw new Error(`${listPath}: population attendue 244, observée ${trace.trace_counts.candidates}`);
  const sample = sampleWithoutReplacement(trace.municipalities, SAMPLE_SIZE, SAMPLE_SEED);
  const s3 = offlineS3 ? null : s3Client();
  const manifestCache = new Map<string, readonly CaptureManifestLine[]>();
  const rows = await Promise.all(sample.map(async (municipality) => {
    if (municipality.attempts.length > 1) throw new Error(`${municipality.slug}: plusieurs tentatives inattendues`);
    const attempt = municipality.attempts[0] ?? null;
    const cause = causeFor(attempt, s3 !== null);
    const manifest = attempt === null || s3 === null ? null : await manifestEvidence(s3, attempt, manifestCache);
    if (attempt !== null && manifest !== null && manifest.line.http_status !== attempt.http_status) {
      throw new Error(`${municipality.slug}: statut du manifeste divergent du rapport de classification`);
    }
    if (attempt !== null && manifest !== null && manifest.line.run_id !== attempt.run_id) {
      throw new Error(`${municipality.slug}: run_id du manifeste divergent du rapport de classification`);
    }
    const browserUaVerified = (cause === "HTTP_403_ANTIBOT_UA_NAVIGATEUR" || cause === "HTTP_403_UA_NON_RÉVÉRIFIÉ")
      ? /^Mozilla\/5\.0\b/u.test(manifest?.line.user_agent ?? "")
      : null;
    if (cause === "HTTP_403_ANTIBOT_UA_NAVIGATEUR" && s3 !== null && browserUaVerified !== true) {
      throw new Error(`${municipality.slug}: 403 sans UA navigateur prouvé; ne pas conclure anti-bot`);
    }
    const body = attempt !== null && (attempt.verdict === "PAGE_HTML" || attempt.verdict === "DOCUMENT_LISIBLE_NON_PV")
      ? s3 === null
        ? { opened: false, reason: "lecture S3 indisponible; verdict du rapport de classification conservé sans réouverture" }
        : await inspectNonPvBody(s3, municipality, attempt)
      : null;
    if (s3 !== null && attempt?.verdict === "PAGE_HTML" && body?.verdict !== "HTML_PORTAL_OR_SOFT_404") {
      throw new Error(`${municipality.slug}: HTML ne démontre pas une ressource non-PV`);
    }
    return {
      slug: municipality.slug,
      municipality_name: municipality.municipality_name,
      candidate: municipality.candidate,
      cause,
      recovery_class: recoveryClass(cause),
      attempt: attempt === null ? null : {
        campaign: attempt.campaign,
        url: attempt.url,
        verdict: attempt.verdict,
        http_status: attempt.http_status,
        host: attempt.host,
        detail: attempt.detail,
        source_report: attempt.source_report,
        manifest_key: attempt.manifest_key,
        line_index: attempt.line_index,
        line_index_match: manifest?.line_index_match ?? null,
        run_id: attempt.run_id,
        user_agent: manifest?.line.user_agent ?? null,
        browser_user_agent_verified: browserUaVerified,
        transport_error: manifest?.line.error ?? null,
        final_url: manifest?.line.final_url ?? null,
        storage_key: attempt.storage_key,
        owner_verbatim: attempt.owner_verbatim,
        pv_verbatim: attempt.pv_verbatim,
      },
      body_inspection: body,
    };
  }));
  const causeCounts = new Map<Cause, number>();
  for (const row of rows) causeCounts.set(row.cause, (causeCounts.get(row.cause) ?? 0) + 1);
  const recoveryCounts = new Map<string, number>();
  for (const row of rows) recoveryCounts.set(row.recovery_class, (recoveryCounts.get(row.recovery_class) ?? 0) + 1);
  const plausibleRecoverable = rows.filter((row) => row.recovery_class === "immédiat" || row.recovery_class === "investigation").length;
  const extrapolatedRecoverable = Math.round((plausibleRecoverable / SAMPLE_SIZE) * trace.trace_counts.candidates);
  const confirmedNotIndexed = trace.verdict_counts.PV_LISIBLE_PROPRIETAIRE_CONFIRME;
  const scansWithoutText = trace.verdict_counts.PDF_SANS_COUCHE_TEXTE;
  const report = {
    contract: "pv-diagnostic-244-echecs/v1",
    generated_at: new Date().toISOString(),
    read_only: {
      external_http_fetch: false,
      capture: false,
      s3_writes: false,
      local_input_max_bytes: MAX_LOCAL_INPUT_BYTES,
      s3_read_max_bytes: MAX_S3_READ_BYTES,
      note: "Les objets S3 lus sont les manifestes et octets déjà capturés; aucune URL municipale n'est recontactée.",
      s3_read_mode: offlineS3 ? "indisponible: aucun manifeste ni corps réouvert" : "manifeste et corps bornés",
    },
    trace_list: { path: listPath, trace_counts: trace.trace_counts },
    full_trace_census: {
      source_verdict_counts: trace.verdict_counts,
      confirmed_pv_not_indexed: confirmedNotIndexed,
      pdf_without_text_layer: scansWithoutText,
      immediate_queue: confirmedNotIndexed + scansWithoutText,
      note: "Les PV confirmés sont une récupération sans nouvelle capture; les PDF sans texte exigent une lecture visuelle avant indexation.",
    },
    sample: {
      population: trace.trace_counts.candidates,
      size: SAMPLE_SIZE,
      sampling: { method: "Fisher-Yates pseudo-aléatoire déterministe", seed: SAMPLE_SEED, ordered_after_sampling_by: "slug" },
      cause_counts: Object.fromEntries([...causeCounts].sort(([left], [right]) => left.localeCompare(right))),
      recovery_counts: Object.fromEntries([...recoveryCounts].sort(([left], [right]) => left.localeCompare(right))),
      partition_total: rows.length,
      partition_matches_sample: rows.length === SAMPLE_SIZE,
      plausible_recoverable: plausibleRecoverable,
      extrapolated_recoverable: extrapolatedRecoverable,
      extrapolation: {
        statement: `Projection descriptive de ${plausibleRecoverable}/${SAMPLE_SIZE} vers ${trace.trace_counts.candidates}: ${extrapolatedRecoverable} récupérables plausibles.`,
        includes: ["PV confirmé mais non indexé", "PDF sans couche texte", "PV propriétaire non confirmé", "trace absente"],
        excludes: ["HTTP 403 malgré UA navigateur", "octets démontrés non-PV"],
        can_be_false_if: [
          "les 40 tirés ne représentent pas les 244, particulièrement les 5 traces absentes",
          "la revue de propriétaire échoue ou les PDF scannés restent illisibles visuellement",
          "un PV confirmé ne peut finalement pas être indexé pour une garde de provenance hors de cette mesure",
        ],
      },
      limitations: offlineS3 ? [
        "S3 a refusé la relecture des manifestes et CAS (UnknownError), y compris hors sandbox.",
        "Les 403 restent le verdict historique « malgré User-Agent navigateur », non ré-vérifié par cette exécution.",
        "Les octets PAGE_HTML et DOCUMENT_LISIBLE_NON_PV ne sont pas réouverts dans ce rapport; le verdict provient de leur rapport de classification déjà committé.",
      ] : [],
      rows,
    },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body, { flag: "wx" });
  writeFileSync(markdownOut, markdown(report as unknown as Record<string, unknown>, outRelative), { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    out: outRelative,
    markdown: markdownOut.slice(ROOT.length + 1),
    sample_size: SAMPLE_SIZE,
    cause_counts: report.sample.cause_counts,
    plausible_recoverable: plausibleRecoverable,
    extrapolated_recoverable: extrapolatedRecoverable,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
