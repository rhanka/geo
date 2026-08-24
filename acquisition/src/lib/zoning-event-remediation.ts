/**
 * Pure LINK-before-RETRACT planning and the explicitly owner-gated served
 * boundary for qc-zoning-events remediation.
 *
 * Planning and mutation are network-free. The only function that can reach the
 * served emitter is `executeZoningEventRemediation`, which requires a direct
 * geo-cond owner-go artefact whose inventory and dry-run hashes match exactly.
 */
import { createHash } from "node:crypto";

import { detectGenericPvZonageChange } from "../../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

import {
  serveZoningEvents,
  validateZoningEvent,
  zoningEventsKeys,
  type ServeZoningEventsResult,
  type ZoningEvent,
  type ZoningEventsDocument,
  type ZoningEventsStore,
} from "../zoning-events-emit.js";
import { exactHttpUrl } from "./reglement-capture-kpi.js";
import { observeZoningEventSources } from "./zoning-event-source-audit.js";
import type { ZoningEventRemediationDryRunReport } from "./zoning-event-remediation-runner.js";

export const ZONING_EVENT_REMEDIATION_PLAN_CONTRACT =
  "zoning-event-remediation-plan/v1" as const;
export const ZONING_EVENT_EXHAUSTION_CONTRACT =
  "zoning-event-extraction-exhaustion/v1" as const;
export const ZONING_EVENT_OWNER_GO_CONTRACT =
  "zoning-event-remediation-owner-go/v1" as const;
export const ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT =
  "zoning-event-remediation-dry-run/v1" as const;

export type Sha256Ref = `sha256:${string}`;

export interface ZoningEventLinkSource {
  url: string;
  /** Verbatim text proving the target event. Preserved byte-for-byte. */
  source_span: string;
  /** YYYY-MM-DD. */
  as_of_date: string;
  producer: string;
}

export interface ZoningEventPvLinkEvidence extends ZoningEventLinkSource {
  /** Captured/extracted PV text. The remediation code never fetches it. */
  pv_text: string;
  /** Exact new regulation number expected from the generic PV detector. */
  detector_reglement_numero: string;
}

export interface ExhaustionCheckedSource {
  source_ref: string;
  outcome: "no-source";
}

export interface DurableEvidenceObjectRef {
  /** Object-storage key; never a workstation-only path. */
  key: string;
  sha256: Sha256Ref;
}

export interface ZoningEventExhaustionProof {
  contract: typeof ZONING_EVENT_EXHAUSTION_CONTRACT;
  status: "exhausted";
  /** Durable extraction/capture run references, normally S3 keys or receipts. */
  run_refs: DurableEvidenceObjectRef[];
  checked_sources: ExhaustionCheckedSource[];
  /** ISO-8601 timestamp or date carried by the authenticated inventory. */
  as_of: string;
}

export interface ZoningEventRemediationEvidence {
  event_id: string;
  /** When present and valid, LINK always wins even if exhaustion is also supplied. */
  link_source?: ZoningEventLinkSource;
  exhaustion?: ZoningEventExhaustionProof;
}

interface RemediationPlanItemBase {
  event_id: string;
  muni: string;
  bylaw_numero: string | null;
  type: ZoningEvent["type"];
  date_iso: string;
  from_version: number;
  to_version: number;
}

export interface ZoningEventLinkPlanItem extends RemediationPlanItemBase {
  action: "link";
  source: ZoningEventLinkSource;
}

export interface ZoningEventRetractPlanItem extends RemediationPlanItemBase {
  action: "retract";
  exhaustion: ZoningEventExhaustionProof;
}

export interface ZoningEventBlockedPlanItem extends RemediationPlanItemBase {
  action: "blocked";
  reason: "source-or-exhaustion-proof-missing";
}

export interface ZoningEventRemediationCityPlan {
  contract: typeof ZONING_EVENT_REMEDIATION_PLAN_CONTRACT;
  dry_run: true;
  muni: string;
  collection_key: string;
  collection_sha256: Sha256Ref;
  inventory_sha256: Sha256Ref;
  source_document_as_of: string;
  to_link: ZoningEventLinkPlanItem[];
  to_retract: ZoningEventRetractPlanItem[];
  blocked: ZoningEventBlockedPlanItem[];
  counts: {
    living_phantoms: number;
    to_link: number;
    to_retract: number;
    blocked: number;
  };
}

export interface ZoningEventOwnerGo {
  contract: typeof ZONING_EVENT_OWNER_GO_CONTRACT;
  via: "geo-cond";
  owner_go_direct: true;
  inventory_sha256: Sha256Ref;
  dry_run_sha256: Sha256Ref;
  h2a_envelope_id: string;
  h2a_session_id: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSha(value: string, label: string): asserts value is Sha256Ref {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${label}: SHA-256 invalide`);
}

function assertIsoDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label}: date YYYY-MM-DD invalide`);
  }
}

function assertIso(value: string, label: string): void {
  if (!nonEmpty(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label}: date ISO-8601 invalide`);
  }
}

export function assertZoningEventLinkSource(source: ZoningEventLinkSource): void {
  if (!exactHttpUrl(source.url)) throw new Error("zoning-event LINK: URL HTTP(S) invalide");
  if (!nonEmpty(source.source_span)) throw new Error("zoning-event LINK: source_span verbatim requis");
  if (!nonEmpty(source.producer)) throw new Error("zoning-event LINK: producer requis");
  assertIsoDate(source.as_of_date, "zoning-event LINK as_of_date");
}

/**
 * Turn authenticated PV evidence into LINK input. The generic detector proves
 * the explicit regulation mapping; the exact source span must also occur
 * byte-for-byte in the already captured text. No number or span is inferred.
 */
export function linkSourceFromGenericPv(
  evidence: ZoningEventPvLinkEvidence,
): ZoningEventLinkSource {
  assertZoningEventLinkSource(evidence);
  if (!nonEmpty(evidence.pv_text)) {
    throw new Error("zoning-event LINK PV: texte capturé requis");
  }
  if (!nonEmpty(evidence.detector_reglement_numero)) {
    throw new Error("zoning-event LINK PV: numéro règlement explicite requis");
  }
  if (!evidence.pv_text.includes(evidence.source_span)) {
    throw new Error("zoning-event LINK PV: source_span non verbatim dans le texte capturé");
  }
  if (!evidence.source_span.includes(evidence.detector_reglement_numero)) {
    throw new Error("zoning-event LINK PV: source_span ne prouve pas le numéro explicite");
  }
  const detection = detectGenericPvZonageChange(evidence.pv_text);
  if (
    !detection.changementZonage ||
    !detection.reglementNumbers.includes(evidence.detector_reglement_numero)
  ) {
    throw new Error(
      `zoning-event LINK PV: détecteur générique ne confirme pas ${evidence.detector_reglement_numero}`,
    );
  }
  return {
    url: evidence.url,
    source_span: evidence.source_span,
    as_of_date: evidence.as_of_date,
    producer: evidence.producer,
  };
}

export function assertZoningEventExhaustionProof(proof: ZoningEventExhaustionProof): void {
  if (proof.contract !== ZONING_EVENT_EXHAUSTION_CONTRACT || proof.status !== "exhausted") {
    throw new Error("zoning-event RETRACT: preuve d'épuisement contractuelle requise");
  }
  if (
    !Array.isArray(proof.run_refs) ||
    proof.run_refs.length === 0 ||
    proof.run_refs.some((ref) => {
      if (!nonEmpty(ref?.key)) return true;
      try {
        assertSha(ref.sha256, "zoning-event RETRACT run_ref");
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("zoning-event RETRACT: run_refs durables requis");
  }
  if (
    !Array.isArray(proof.checked_sources) ||
    proof.checked_sources.length === 0 ||
    proof.checked_sources.some((source) => !nonEmpty(source.source_ref) || source.outcome !== "no-source")
  ) {
    throw new Error("zoning-event RETRACT: sources vérifiées avec outcome=no-source requises");
  }
  assertIso(proof.as_of, "zoning-event RETRACT preuve as_of");
}

/** LINK one living event while preserving stable-at-detection identity. */
export function linkZoningEventSource(
  event: ZoningEvent,
  source: ZoningEventLinkSource,
): ZoningEvent {
  if (event.state === "retracted") {
    throw new Error(`zoning-event LINK ${event.event_id}: tombstone retracted non réactivable`);
  }
  assertZoningEventLinkSource(source);
  const linked: ZoningEvent = {
    ...event,
    version: event.version + 1,
    url_pdf: source.url,
    extrait_brut: source.source_span,
    provenance: {
      source_url: source.url,
      source_span: source.source_span,
      as_of_date: source.as_of_date,
      producer: source.producer,
    },
  };
  validateZoningEvent(linked);
  return linked;
}

/** RETRACT one living event only after a closed extraction-exhaustion proof. */
export function retractZoningEvent(
  event: ZoningEvent,
  proof: ZoningEventExhaustionProof,
): ZoningEvent {
  if (event.state === "retracted") {
    throw new Error(`zoning-event RETRACT ${event.event_id}: déjà retracted`);
  }
  assertZoningEventExhaustionProof(proof);
  const retracted: ZoningEvent = {
    ...event,
    version: event.version + 1,
    state: "retracted",
  };
  validateZoningEvent(retracted);
  return retracted;
}

function basePlanItem(event: ZoningEvent): RemediationPlanItemBase {
  return {
    event_id: event.event_id,
    muni: event.muni,
    bylaw_numero: event.bylaw_numero,
    type: event.type,
    date_iso: event.date_iso,
    from_version: event.version,
    to_version: event.version + 1,
  };
}

/**
 * Build one deterministic city dry-run. Only living phantoms enter the plan;
 * valid LINK evidence takes precedence over any supplied exhaustion proof.
 */
export function planZoningEventRemediation(
  document: ZoningEventsDocument,
  evidence: readonly ZoningEventRemediationEvidence[],
  input: {
    collectionKey: string;
    collectionSha256: Sha256Ref;
    inventorySha256: Sha256Ref;
  },
): ZoningEventRemediationCityPlan {
  assertSha(input.collectionSha256, "zoning-event remediation collection");
  assertSha(input.inventorySha256, "zoning-event remediation inventory");
  const observation = observeZoningEventSources(document);
  if (!observation.complete) {
    throw new Error(`zoning-event remediation ${document.muni}: complete=false interdit toute remédiation`);
  }

  const byId = new Map<string, ZoningEvent>();
  for (const event of document.events) byId.set(event.event_id, event);
  const livingPhantoms = new Set(
    observation.events.filter((event) => event.is_living_phantom).map((event) => event.event_id),
  );
  const evidenceById = new Map<string, ZoningEventRemediationEvidence>();
  for (const candidate of evidence) {
    if (evidenceById.has(candidate.event_id)) {
      throw new Error(`zoning-event remediation ${document.muni}: inventaire dupliqué ${candidate.event_id}`);
    }
    if (!livingPhantoms.has(candidate.event_id)) {
      throw new Error(`zoning-event remediation ${document.muni}: inventaire stale/hors fantôme ${candidate.event_id}`);
    }
    evidenceById.set(candidate.event_id, candidate);
  }

  const toLink: ZoningEventLinkPlanItem[] = [];
  const toRetract: ZoningEventRetractPlanItem[] = [];
  const blocked: ZoningEventBlockedPlanItem[] = [];
  for (const eventId of [...livingPhantoms].sort()) {
    const event = byId.get(eventId)!;
    const candidate = evidenceById.get(eventId);
    if (candidate?.link_source !== undefined) {
      assertZoningEventLinkSource(candidate.link_source);
      toLink.push({ ...basePlanItem(event), action: "link", source: candidate.link_source });
      continue;
    }
    if (candidate?.exhaustion !== undefined) {
      assertZoningEventExhaustionProof(candidate.exhaustion);
      toRetract.push({ ...basePlanItem(event), action: "retract", exhaustion: candidate.exhaustion });
      continue;
    }
    blocked.push({
      ...basePlanItem(event),
      action: "blocked",
      reason: "source-or-exhaustion-proof-missing",
    });
  }

  return {
    contract: ZONING_EVENT_REMEDIATION_PLAN_CONTRACT,
    dry_run: true,
    muni: document.muni,
    collection_key: input.collectionKey,
    collection_sha256: input.collectionSha256,
    inventory_sha256: input.inventorySha256,
    source_document_as_of: document.as_of,
    to_link: toLink,
    to_retract: toRetract,
    blocked,
    counts: {
      living_phantoms: livingPhantoms.size,
      to_link: toLink.length,
      to_retract: toRetract.length,
      blocked: blocked.length,
    },
  };
}

export function zoningEventRemediationPlanSha256(
  plan: ZoningEventRemediationCityPlan,
): Sha256Ref {
  return zoningEventRemediationArtifactSha256(plan);
}

export function zoningEventRemediationArtifactSha256(value: unknown): Sha256Ref {
  return `sha256:${createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex")}`;
}

/** Materialize the full municipal set. A partially evidenced plan is not executable. */
export function materializeZoningEventRemediation(
  document: ZoningEventsDocument,
  plan: ZoningEventRemediationCityPlan,
): ZoningEvent[] {
  if (plan.muni !== document.muni) throw new Error("zoning-event remediation: muni plan/document divergent");
  if (plan.collection_key !== zoningEventsKeys(document.muni)[1]) {
    throw new Error("zoning-event remediation: seule la collection servie sous-dossier est remédiable");
  }
  if (plan.source_document_as_of !== document.as_of) {
    throw new Error("zoning-event remediation: plan stale (document as_of divergent)");
  }
  if (plan.blocked.length > 0) {
    throw new Error(`zoning-event remediation ${plan.muni}: ${plan.blocked.length} event(s) bloqué(s)`);
  }
  const observation = observeZoningEventSources(document);
  if (!observation.complete) {
    throw new Error(`zoning-event remediation ${plan.muni}: complete=false interdit toute remédiation`);
  }
  const livingPhantoms = new Set(
    observation.events.filter((event) => event.is_living_phantom).map((event) => event.event_id),
  );
  if (
    plan.counts.living_phantoms !== livingPhantoms.size ||
    plan.counts.to_link !== plan.to_link.length ||
    plan.counts.to_retract !== plan.to_retract.length ||
    plan.counts.blocked !== plan.blocked.length
  ) {
    throw new Error("zoning-event remediation: comptes du plan divergents");
  }
  const actionItems = [...plan.to_link, ...plan.to_retract];
  const actionIds = new Set<string>();
  for (const item of actionItems) {
    if (actionIds.has(item.event_id)) {
      throw new Error(`zoning-event remediation: action dupliquée ${item.event_id}`);
    }
    actionIds.add(item.event_id);
    if (!livingPhantoms.has(item.event_id)) {
      throw new Error(`zoning-event remediation: action stale/hors fantôme ${item.event_id}`);
    }
  }
  const missing = [...livingPhantoms].filter((eventId) => !actionIds.has(eventId));
  if (missing.length > 0) {
    throw new Error(`zoning-event remediation: ${missing.length} fantôme(s) absent(s) du plan fermé`);
  }
  const linkById = new Map(plan.to_link.map((item) => [item.event_id, item]));
  const retractById = new Map(plan.to_retract.map((item) => [item.event_id, item]));
  const result = document.events.map((event) => {
    const link = linkById.get(event.event_id);
    if (link) {
      if (link.from_version !== event.version || link.to_version !== event.version + 1) {
        throw new Error(`zoning-event remediation ${event.event_id}: plan stale (version divergente)`);
      }
      return linkZoningEventSource(event, link.source);
    }
    const retract = retractById.get(event.event_id);
    if (retract) {
      if (retract.from_version !== event.version || retract.to_version !== event.version + 1) {
        throw new Error(`zoning-event remediation ${event.event_id}: plan stale (version divergente)`);
      }
      return retractZoningEvent(event, retract.exhaustion);
    }
    return event;
  });
  for (const event of result) validateZoningEvent(event);
  return result;
}

function assertOwnerGo(
  ownerGo: ZoningEventOwnerGo,
  dryRun: ZoningEventRemediationDryRunReport,
): void {
  if (
    ownerGo.contract !== ZONING_EVENT_OWNER_GO_CONTRACT ||
    ownerGo.via !== "geo-cond" ||
    ownerGo.owner_go_direct !== true
  ) {
    throw new Error("zoning-event remediation: go owner DIRECT via geo-cond requis");
  }
  assertSha(ownerGo.inventory_sha256, "zoning-event owner-go inventory");
  assertSha(ownerGo.dry_run_sha256, "zoning-event owner-go dry-run");
  if (ownerGo.inventory_sha256 !== dryRun.inventory_sha256) {
    throw new Error("zoning-event remediation: owner-go ne vise pas cet inventaire");
  }
  if (ownerGo.dry_run_sha256 !== zoningEventRemediationArtifactSha256(dryRun)) {
    throw new Error("zoning-event remediation: owner-go ne vise pas ce dry-run exact");
  }
  if (!nonEmpty(ownerGo.h2a_envelope_id) || !nonEmpty(ownerGo.h2a_session_id)) {
    throw new Error("zoning-event remediation: références session/enveloppe h2a requises");
  }
}

/**
 * The only served write boundary. No CLI in this lot calls it. The conductor
 * must first verify the direct owner-go envelope/session, then pass the exact
 * matching artefact here.
 */
export async function executeZoningEventRemediation(
  document: ZoningEventsDocument,
  dryRun: ZoningEventRemediationDryRunReport,
  ownerGo: ZoningEventOwnerGo,
  options: {
    asOf: string;
    /** SHA of the nested object re-read immediately before this boundary. */
    collectionSha256: Sha256Ref;
    store?: ZoningEventsStore;
  },
): Promise<ServeZoningEventsResult> {
  if (
    dryRun.contract !== ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT ||
    dryRun.dry_run !== true ||
    dryRun.executable !== true ||
    dryRun.totals.cities_unknown !== 0 ||
    dryRun.totals.blocked !== 0
  ) {
    throw new Error("zoning-event remediation: rapport dry-run fermé et exécutable requis");
  }
  const cityMatches = dryRun.cities.filter((city) => city.slug === document.muni);
  if (
    cityMatches.length !== 1 ||
    cityMatches[0]!.dry_run_state !== "planned" ||
    cityMatches[0]!.plan === null
  ) {
    throw new Error(`zoning-event remediation ${document.muni}: plan absent/ambigu dans le dry-run revu`);
  }
  const plan = cityMatches[0]!.plan;
  if (plan.inventory_sha256 !== dryRun.inventory_sha256) {
    throw new Error("zoning-event remediation: plan municipal hors inventaire dry-run");
  }
  assertOwnerGo(ownerGo, dryRun);
  assertSha(options.collectionSha256, "zoning-event remediation collection relue");
  if (options.collectionSha256 !== plan.collection_sha256) {
    throw new Error("zoning-event remediation: collection servie modifiée depuis le dry-run");
  }
  assertIso(options.asOf, "zoning-event remediation served asOf");
  const events = materializeZoningEventRemediation(document, plan);
  return serveZoningEvents(document.muni, events, {
    asOf: options.asOf,
    complete: true,
    ...(options.store ? { store: options.store } : {}),
  });
}
