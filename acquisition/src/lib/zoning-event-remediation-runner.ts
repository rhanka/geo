import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CAS_KEY_RE,
  CaptureRunHeaderSchema,
  parseManifestJsonl,
} from "../../../packages/qc-sources/src/capture/index.js";

import type { ZoningEventsDocument } from "../zoning-events-emit.js";
import {
  type ZoningEventDocumentRead,
  type ZoningEventSourceAuditReport,
  ZONING_EVENT_AUDIT_CONTRACT,
} from "./zoning-event-source-audit-runner.js";
import {
  linkSourceFromGenericPv,
  planZoningEventRemediation,
  zoningEventRemediationArtifactSha256,
  ZONING_EVENT_EXHAUSTION_CONTRACT,
  ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT,
  ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT,
  type DurableEvidenceObjectRef,
  type Sha256Ref,
  type ZoningEventRemediationCityPlan,
  type ZoningEventRemediationEvidence,
} from "./zoning-event-remediation.js";

export const ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT =
  "zoning-event-remediation-inventory/v1" as const;

const ShaSchema = z.string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .transform((value) => value as Sha256Ref);
const ObjectKeySchema = z.string().min(1).refine((key) => {
  const parts = key.split("/");
  return !key.startsWith("/") && !key.includes("://") && parts.every((part) => part !== "." && part !== "..");
}, "clé objet durable invalide");
const DurableRefSchema = z.object({
  key: ObjectKeySchema,
  sha256: ShaSchema,
}).strict();
const CheckedSourceSchema = z.object({
  source_ref: z.string().min(1),
  outcome: z.literal("no-source"),
}).strict();
const ExhaustionSchema = z.object({
  contract: z.literal(ZONING_EVENT_EXHAUSTION_CONTRACT),
  status: z.literal("exhausted"),
  run_refs: z.array(DurableRefSchema).min(1),
  checked_sources: z.array(CheckedSourceSchema).min(1),
  as_of: z.string().min(1),
}).strict();
const LinkResolutionSchema = z.object({
  kind: z.literal("link"),
  evidence_ref: DurableRefSchema,
}).strict();
const RetractResolutionSchema = z.object({
  kind: z.literal("retract"),
  exhaustion: ExhaustionSchema,
}).strict();
const InventorySchema = z.object({
  contract: z.literal(ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT),
  cohort_sha256: ShaSchema,
  audit_sha256: ShaSchema,
  authenticated: z.object({
    origin: z.literal("immo-extraction"),
    extraction_ref: z.string().min(1),
    via: z.literal("geo-cond"),
    h2a_envelope_id: z.string().min(1),
  }).strict(),
  cities: z.array(z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    collection_sha256: ShaSchema,
    events: z.array(z.object({
      event_id: z.string().min(1),
      resolution: z.discriminatedUnion("kind", [LinkResolutionSchema, RetractResolutionSchema]),
    }).strict()),
  }).strict()),
}).strict();
const PvLinkReceiptSchema = z.object({
  contract: z.literal(ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT),
  status: z.literal("source-found"),
  receipt_key: ObjectKeySchema,
  event_id: z.string().min(1),
  target_bylaw_numero: z.string().min(1),
  detector_reglement_numero: z.string().min(1),
  source_url: z.string().min(1),
  source_span: z.string().min(1),
  as_of_date: z.string().min(1),
  producer: z.string().min(1),
  capture_run_ref: DurableRefSchema,
  capture_manifest_ref: DurableRefSchema,
  captured_pdf_ref: DurableRefSchema,
  pv_text_ref: DurableRefSchema,
  text_extraction_receipt_ref: DurableRefSchema,
}).strict();
const PvTextExtractionReceiptSchema = z.object({
  contract: z.literal(ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT),
  status: z.literal("extracted"),
  receipt_key: ObjectKeySchema,
  run_id: z.string().min(1),
  source_url: z.string().min(1),
  captured_pdf_ref: DurableRefSchema,
  pv_text_ref: DurableRefSchema,
  extraction_tool: z.string().min(1),
  extracted_at: z.string().datetime(),
}).strict();
const ExhaustionReceiptSchema = z.object({
  contract: z.literal(ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT),
  status: z.literal("exhausted"),
  receipt_key: ObjectKeySchema,
  event_id: z.string().min(1),
  checked_sources: z.array(CheckedSourceSchema).min(1),
  as_of: z.string().min(1),
}).strict();

export type ZoningEventRemediationInventory = z.infer<typeof InventorySchema>;

export interface ZoningEventRemediationDryRunCity {
  slug: string;
  collection_key: string;
  audit_collection_sha256: Sha256Ref | null;
  current_collection_sha256: Sha256Ref | null;
  dry_run_state: "planned" | "unknown";
  error: string | null;
  plan: ZoningEventRemediationCityPlan | null;
}

export interface ZoningEventRemediationDryRunReport {
  contract: typeof ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT;
  dry_run: true;
  executable: boolean;
  audit_sha256: Sha256Ref;
  inventory_sha256: Sha256Ref;
  cohort: {
    sha256: Sha256Ref;
    expected_count: number;
    slugs: string[];
  };
  authenticated: ZoningEventRemediationInventory["authenticated"];
  totals: {
    cities_total: number;
    cities_planned: number;
    cities_unknown: number;
    living_phantoms: number;
    to_link: number;
    to_retract: number;
    blocked: number;
  };
  cities: ZoningEventRemediationDryRunCity[];
}

export type DurableEvidenceReader = (key: string) => Promise<Buffer>;

export function parseZoningEventRemediationInventory(
  value: unknown,
): ZoningEventRemediationInventory {
  const parsed = InventorySchema.parse(value);
  const citySlugs = parsed.cities.map((city) => city.slug);
  if (new Set(citySlugs).size !== citySlugs.length) {
    throw new Error("inventaire zoning-event remediation: ville dupliquée");
  }
  for (const city of parsed.cities) {
    const ids = city.events.map((event) => event.event_id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`inventaire zoning-event remediation ${city.slug}: event_id dupliqué`);
    }
  }
  return {
    ...parsed,
    cities: [...parsed.cities]
      .sort((left, right) => left.slug.localeCompare(right.slug))
      .map((city) => ({
        ...city,
        events: [...city.events].sort((left, right) => left.event_id.localeCompare(right.event_id)),
      })),
  };
}

function sha256(value: string | Buffer): Sha256Ref {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function errorText(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = value?.$metadata?.httpStatusCode;
  return `${String(value?.name ?? "Error")}: ${String(value?.message ?? error)}${status ? ` (HTTP ${status})` : ""}`;
}

function assertAudit(
  audit: ZoningEventSourceAuditReport,
  auditSha256: Sha256Ref,
  inventory: ZoningEventRemediationInventory,
): void {
  if (audit.contract !== ZONING_EVENT_AUDIT_CONTRACT || audit.selected_layout !== "nested") {
    throw new Error("dry-run zoning-event: audit read-only v1 nested requis");
  }
  if (inventory.audit_sha256 !== auditSha256) {
    throw new Error("dry-run zoning-event: inventaire ne vise pas cet audit exact");
  }
  if (inventory.cohort_sha256 !== audit.cohort.sha256) {
    throw new Error("dry-run zoning-event: inventaire/audit ne visent pas la même cohorte");
  }
  const auditSlugs = audit.cities.map((city) => city.slug).sort();
  const inventorySlugs = inventory.cities.map((city) => city.slug).sort();
  if (
    auditSlugs.length !== audit.cohort.expected_count ||
    new Set(auditSlugs).size !== auditSlugs.length ||
    JSON.stringify(auditSlugs) !== JSON.stringify([...audit.cohort.slugs].sort()) ||
    JSON.stringify(auditSlugs) !== JSON.stringify(inventorySlugs)
  ) {
    throw new Error("dry-run zoning-event: partition ville audit/cohorte/inventaire non fermée");
  }
}

async function readVerified(
  ref: DurableEvidenceObjectRef,
  readEvidence: DurableEvidenceReader,
): Promise<Buffer> {
  const bytes = await readEvidence(ref.key);
  const actual = sha256(bytes);
  if (actual !== ref.sha256) {
    throw new Error(`preuve durable ${ref.key}: SHA divergent (${actual})`);
  }
  return bytes;
}

async function evidenceForCity(
  city: ZoningEventRemediationInventory["cities"][number],
  readEvidence: DurableEvidenceReader,
): Promise<ZoningEventRemediationEvidence[]> {
  const result: ZoningEventRemediationEvidence[] = [];
  for (const item of city.events) {
    if (item.resolution.kind === "link") {
      const receiptBytes = await readVerified(item.resolution.evidence_ref, readEvidence);
      let receipt: z.infer<typeof PvLinkReceiptSchema>;
      try {
        receipt = PvLinkReceiptSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes)));
      } catch {
        throw new Error(`preuve LINK ${item.resolution.evidence_ref.key}: reçu JSON contractuel invalide`);
      }
      if (receipt.receipt_key !== item.resolution.evidence_ref.key || receipt.event_id !== item.event_id) {
        throw new Error(`preuve LINK ${item.event_id}: reçu hors cible`);
      }
      const runBytes = await readVerified(receipt.capture_run_ref, readEvidence);
      let run: z.infer<typeof CaptureRunHeaderSchema>;
      try {
        run = CaptureRunHeaderSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(runBytes)));
      } catch {
        throw new Error(`preuve LINK ${item.event_id}: run de capture contractuel invalide`);
      }
      if (run.execution !== "cluster" || run.lane !== "pv" || run.finished_at === null || run.exit_code !== 0) {
        throw new Error(`preuve LINK ${item.event_id}: run PV cluster terminé requis`);
      }
      if (
        receipt.capture_run_ref.key !== `capture/_runs/${run.run_id}/run.json` ||
        receipt.capture_manifest_ref.key !== `capture/_runs/${run.run_id}/manifest.jsonl`
      ) {
        throw new Error(`preuve LINK ${item.event_id}: clés run/manifeste non canoniques`);
      }
      const cas = CAS_KEY_RE.exec(receipt.captured_pdf_ref.key);
      if (!cas || cas[2] !== receipt.captured_pdf_ref.sha256.slice("sha256:".length)) {
        throw new Error(`preuve LINK ${item.event_id}: PDF hors CAS canonique`);
      }
      const manifestBytes = await readVerified(receipt.capture_manifest_ref, readEvidence);
      let manifest;
      try {
        manifest = parseManifestJsonl(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
      } catch {
        throw new Error(`preuve LINK ${item.event_id}: manifeste de capture invalide`);
      }
      await readVerified(receipt.captured_pdf_ref, readEvidence);
      const captured = manifest.some((line) =>
        line.run_id === run.run_id &&
        line.lane === "pv" &&
        line.slugs.includes(city.slug) &&
        (line.url === receipt.source_url || line.final_url === receipt.source_url) &&
        line.http_status !== null && line.http_status >= 200 && line.http_status < 300 &&
        line.error === null &&
        line.redacted === false &&
        line.storage_key === receipt.captured_pdf_ref.key &&
        line.sha256 === receipt.captured_pdf_ref.sha256 &&
        line.content_type?.toLowerCase().includes("pdf") === true
      );
      if (!captured) {
        throw new Error(`preuve LINK ${item.event_id}: URL/PDF non liés au manifeste PV cluster`);
      }
      const extractionReceiptBytes = await readVerified(receipt.text_extraction_receipt_ref, readEvidence);
      let extractionReceipt: z.infer<typeof PvTextExtractionReceiptSchema>;
      try {
        extractionReceipt = PvTextExtractionReceiptSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(extractionReceiptBytes)),
        );
      } catch {
        throw new Error(`preuve LINK ${item.event_id}: reçu d'extraction PDF→texte invalide`);
      }
      if (
        extractionReceipt.receipt_key !== receipt.text_extraction_receipt_ref.key ||
        extractionReceipt.run_id !== run.run_id ||
        extractionReceipt.source_url !== receipt.source_url ||
        JSON.stringify(extractionReceipt.captured_pdf_ref) !== JSON.stringify(receipt.captured_pdf_ref) ||
        JSON.stringify(extractionReceipt.pv_text_ref) !== JSON.stringify(receipt.pv_text_ref)
      ) {
        throw new Error(`preuve LINK ${item.event_id}: extraction texte hors PDF/source cible`);
      }
      const pvBytes = await readVerified(receipt.pv_text_ref, readEvidence);
      let pvText: string;
      try {
        pvText = new TextDecoder("utf-8", { fatal: true }).decode(pvBytes);
      } catch {
        throw new Error(`preuve durable ${receipt.pv_text_ref.key}: texte PV UTF-8 invalide`);
      }
      result.push({
        event_id: item.event_id,
        link_source: linkSourceFromGenericPv({
          url: receipt.source_url,
          source_span: receipt.source_span,
          as_of_date: receipt.as_of_date,
          producer: receipt.producer,
          detector_reglement_numero: receipt.detector_reglement_numero,
          pv_text: pvText,
        }),
        link_mapping: {
          target_bylaw_numero: receipt.target_bylaw_numero,
          detector_reglement_numero: receipt.detector_reglement_numero,
        },
      });
      continue;
    }
    const receiptSources: { source_ref: string; outcome: "no-source" }[] = [];
    for (const ref of item.resolution.exhaustion.run_refs) {
      const receiptBytes = await readVerified(ref, readEvidence);
      let receipt: z.infer<typeof ExhaustionReceiptSchema>;
      try {
        receipt = ExhaustionReceiptSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes)));
      } catch {
        throw new Error(`preuve RETRACT ${ref.key}: reçu JSON contractuel invalide`);
      }
      if (
        receipt.receipt_key !== ref.key ||
        receipt.event_id !== item.event_id ||
        receipt.as_of !== item.resolution.exhaustion.as_of
      ) {
        throw new Error(`preuve RETRACT ${item.event_id}: reçu hors cible/as_of`);
      }
      receiptSources.push(...receipt.checked_sources);
    }
    const normalizedReceiptSources = [...receiptSources]
      .sort((left, right) => left.source_ref.localeCompare(right.source_ref));
    const normalizedClaimedSources = [...item.resolution.exhaustion.checked_sources]
      .sort((left, right) => left.source_ref.localeCompare(right.source_ref));
    if (
      new Set(normalizedReceiptSources.map((source) => source.source_ref)).size !== normalizedReceiptSources.length ||
      JSON.stringify(normalizedReceiptSources) !== JSON.stringify(normalizedClaimedSources)
    ) {
      throw new Error(`preuve RETRACT ${item.event_id}: sources reçues/inventaire divergentes`);
    }
    result.push({ event_id: item.event_id, exhaustion: item.resolution.exhaustion });
  }
  return result;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await fn(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

export async function buildZoningEventRemediationDryRun(
  audit: ZoningEventSourceAuditReport,
  inventory: ZoningEventRemediationInventory,
  hashes: { auditSha256: Sha256Ref; inventorySha256: Sha256Ref },
  readDocument: (slug: string, key: string) => Promise<ZoningEventDocumentRead>,
  readEvidence: DurableEvidenceReader,
  options: { concurrency?: number } = {},
): Promise<ZoningEventRemediationDryRunReport> {
  assertAudit(audit, hashes.auditSha256, inventory);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("dry-run zoning-event: concurrency doit être 1..16");
  }
  const inventoryBySlug = new Map(inventory.cities.map((city) => [city.slug, city]));
  const cities = await mapConcurrent(
    [...audit.cities].sort((left, right) => left.slug.localeCompare(right.slug)),
    concurrency,
    async (auditCity): Promise<ZoningEventRemediationDryRunCity> => {
      let currentSha: Sha256Ref | null = null;
      try {
        if (
          auditCity.audit_state !== "audited" ||
          auditCity.complete !== true ||
          auditCity.collection_sha256 === null
        ) {
          throw new Error("audit ville unknown/incomplet");
        }
        const city = inventoryBySlug.get(auditCity.slug)!;
        if (city.collection_sha256 !== auditCity.collection_sha256) {
          throw new Error("inventaire/audit collection SHA divergent");
        }
        const read = await readDocument(auditCity.slug, auditCity.collection_key);
        currentSha = read.sha256;
        if (read.sha256 !== auditCity.collection_sha256) {
          throw new Error("collection servie modifiée depuis l'audit");
        }
        const evidence = await evidenceForCity(city, readEvidence);
        const plan = planZoningEventRemediation(
          read.document as ZoningEventsDocument,
          evidence,
          {
            collectionKey: auditCity.collection_key,
            collectionSha256: read.sha256,
            inventorySha256: hashes.inventorySha256,
          },
        );
        return {
          slug: auditCity.slug,
          collection_key: auditCity.collection_key,
          audit_collection_sha256: auditCity.collection_sha256,
          current_collection_sha256: currentSha,
          dry_run_state: "planned",
          error: null,
          plan,
        };
      } catch (error) {
        return {
          slug: auditCity.slug,
          collection_key: auditCity.collection_key,
          audit_collection_sha256: auditCity.collection_sha256,
          current_collection_sha256: currentSha,
          dry_run_state: "unknown",
          error: errorText(error),
          plan: null,
        };
      }
    },
  );

  const totals = {
    cities_total: cities.length,
    cities_planned: 0,
    cities_unknown: 0,
    living_phantoms: 0,
    to_link: 0,
    to_retract: 0,
    blocked: 0,
  };
  for (const city of cities) {
    if (city.dry_run_state === "unknown") {
      totals.cities_unknown++;
      continue;
    }
    totals.cities_planned++;
    totals.living_phantoms += city.plan!.counts.living_phantoms;
    totals.to_link += city.plan!.counts.to_link;
    totals.to_retract += city.plan!.counts.to_retract;
    totals.blocked += city.plan!.counts.blocked;
  }
  return {
    contract: ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT,
    dry_run: true,
    executable: totals.cities_unknown === 0 && totals.blocked === 0,
    audit_sha256: hashes.auditSha256,
    inventory_sha256: hashes.inventorySha256,
    cohort: {
      sha256: inventory.cohort_sha256,
      expected_count: audit.cohort.expected_count,
      slugs: [...audit.cohort.slugs].sort(),
    },
    authenticated: inventory.authenticated,
    totals,
    cities,
  };
}

export function zoningEventRemediationDryRunSha256(
  report: ZoningEventRemediationDryRunReport,
): Sha256Ref {
  return zoningEventRemediationArtifactSha256(report);
}
