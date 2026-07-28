/**
 * Pure, fail-closed planning for restoring legacy v1 proof URLs from a capture
 * manifest.  The runner owns S3 reads/writes; this module neither fetches nor
 * re-hashes a source object, because a manifest is the temporal attestation.
 */
import type { ProofArtifactUriSubstitution } from "./zonage-proof.js";
import { arcgisLayerEndpointFromCaptureUrl } from "./served-zonage-immo-proof-url-capture-worklist.js";

type JsonObject = Record<string, unknown>;

export interface ProofUrlManifestAttestation extends ProofArtifactUriSubstitution {
  storage_key: string;
  retrieved_at: string;
  manifest_key: string;
  line_index: number;
}

/**
 * A capture endpoint can need query parameters (notably ArcGIS `f=geojson`).
 * HTTPS and a hostname are the proof-URL requirements; a query string is part
 * of the captured source, not a reason to discard its manifest receipt.
 */
export function isHttpsCaptureUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * A legacy served envelope can name an ArcGIS layer while the immutable
 * capture receipt names the layer's geometry query.  Match those two forms
 * only when their canonical layer endpoints are identical; unrelated layers
 * must remain distinct even when they share an ArcGIS host or service.
 */
export function manifestUrlMatchesServedEnvelope(captureUrl: string, servedEnvelopeUrl: unknown): boolean {
  if (typeof servedEnvelopeUrl !== "string") return false;
  if (captureUrl === servedEnvelopeUrl) return true;
  const captureEndpoint = arcgisLayerEndpointFromCaptureUrl(captureUrl);
  const servedEndpoint = arcgisLayerEndpointFromCaptureUrl(servedEnvelopeUrl);
  return captureEndpoint !== null && captureEndpoint === servedEndpoint;
}

interface ManifestReceiptIdentity {
  storage_key: string;
  url: string;
  sha256: string;
  retrieved_at: string;
  manifest_key: string;
  line_index: number;
}

/**
 * Replayed capture jobs can emit several immutable manifest lines for the
 * same CAS body.  They are interchangeable only when the source URL, CAS key
 * and manifest digest are identical; any competing body remains ambiguous.
 */
export function selectEquivalentManifestReceipt<T extends ManifestReceiptIdentity>(receipts: readonly T[]): T | null {
  if (receipts.length === 0) return null;
  const identities = new Set(receipts.map((receipt) => JSON.stringify([
    receipt.storage_key,
    receipt.url,
    receipt.sha256,
  ])));
  if (identities.size !== 1) return null;
  return [...receipts].sort((left, right) => (
    left.retrieved_at.localeCompare(right.retrieved_at) ||
    left.manifest_key.localeCompare(right.manifest_key) ||
    left.line_index - right.line_index
  ))[0]!;
}

export interface MissingSha256RestampPlan {
  next: JsonObject;
  attestations: ProofUrlManifestAttestation[];
}

export class MissingSha256RestampRefusal extends Error {}

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

/**
 * Pré-garde du planificateur, jumelle de `isAttestableReplacementUrl` dans
 * `zonage-proof.ts`. Elle interdisait elle aussi toute query string, et cette
 * duplication a coûté un aller-retour complet : le garde d'écriture a été
 * corrigé (28c09813) et le plan est resté à 0 PRÊTE sur 86, parce que le
 * planificateur refusait en amont ce que l'écriture acceptait désormais.
 *
 * Même raison de fond qu'à l'écriture : un endpoint ArcGIS nu sert une PAGE
 * HTML de description de service ; la géométrie n'est atteignable que par
 * `<endpoint>/query?where=1%3D1&f=geojson`. Interdire la query n'admettait que
 * l'URL qui NE sert PAS les octets attestés.
 *
 * Restent refusés, parce qu'ils portent sur la propriété et non sur la forme :
 * `http:` (canal non authentifié), les identifiants dans l'URL (un secret
 * publié dans une preuve fuite) et le fragment (jamais transmis au serveur,
 * donc il ne peut pas faire partie de ce qui a produit les octets).
 */
function isAttestableReplacementUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname.length > 0
      && parsed.hash.length === 0
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectedServedArtifactUri(key: string): string {
  return `s3://sentropic-geo/${key}`;
}

function checkedAttestations(
  key: string,
  entries: readonly ProofUrlManifestAttestation[],
): Map<string, ProofUrlManifestAttestation> {
  const expectedArtifact = expectedServedArtifactUri(key);
  const byArtifact = new Map<string, ProofUrlManifestAttestation>();
  for (const entry of entries) {
    if (
      entry.artifactUri !== expectedArtifact ||
      !isAttestableReplacementUrl(entry.replacementUrl) ||
      !SHA256_RE.test(entry.sha256) ||
      typeof entry.storage_key !== "string" || !entry.storage_key.startsWith("raw/") ||
      typeof entry.retrieved_at !== "string" ||
      Number.isNaN(Date.parse(entry.retrieved_at)) ||
      !/^capture\/_runs\/[^/]+\/manifest\.jsonl$/.test(entry.manifest_key) ||
      !Number.isInteger(entry.line_index) || entry.line_index < 0
    ) {
      throw new MissingSha256RestampRefusal("invalid-manifest-attestation");
    }
    if (byArtifact.has(entry.artifactUri)) throw new MissingSha256RestampRefusal("manifest-attestation-ambiguous");
    byArtifact.set(entry.artifactUri, entry);
  }
  return byArtifact;
}

/**
 * Build the sole mutation allowed by the missing-SHA restoration: each v1
 * feature proof naming this served object receives the manifest's exact URL and
 * SHA together. The caller still passes `next` to `putServedZoneAdditive`, which
 * re-reads the served bytes and proves geometry, order, and all sibling props.
 */
export function planMissingSha256ProofRestamp(
  key: string,
  current: JsonObject,
  entries: readonly ProofUrlManifestAttestation[],
): MissingSha256RestampPlan {
  if (current.type !== "FeatureCollection" || !Array.isArray(current.features)) {
    throw new MissingSha256RestampRefusal("served-object-is-not-a-feature-collection");
  }
  const topGeometry = asObject(asObject(asObject(current.proof)?.sources)?.geometry);
  if (typeof topGeometry?.artifact_uri === "string" && topGeometry.artifact_uri.startsWith("s3://")) {
    throw new MissingSha256RestampRefusal("collection-level-proof-artifact-uri-is-immutable");
  }
  const byArtifact = checkedAttestations(key, entries);
  const next = clone(current);
  const nextFeatures = next.features;
  if (!Array.isArray(nextFeatures)) throw new MissingSha256RestampRefusal("internal-clone-lost-feature-array");
  const encountered = new Set<string>();

  for (let index = 0; index < current.features.length; index++) {
    const currentProof = asObject(asObject(asObject(current.features[index])?.properties)?.proof);
    const nextProof = asObject(asObject(asObject(nextFeatures[index])?.properties)?.proof);
    if (!currentProof && !nextProof) continue;
    if (!currentProof || !nextProof) throw new MissingSha256RestampRefusal(`feature-${index}-proof-shape-changed`);
    const geometry = asObject(asObject(currentProof.sources)?.geometry);
    const nextGeometry = asObject(asObject(nextProof.sources)?.geometry);
    const artifactUri = geometry?.artifact_uri;
    if (typeof artifactUri !== "string" || !artifactUri.startsWith("s3://")) continue;
    if (currentProof.schema_version !== "1.0" || !geometry || !nextGeometry) {
      throw new MissingSha256RestampRefusal(`feature-${index}-s3-artifact-is-not-a-v1-geometry-proof`);
    }
    if (Object.hasOwn(geometry, "sha256")) throw new MissingSha256RestampRefusal("envelope-sha256-present-or-malformed");
    const attestation = byArtifact.get(artifactUri);
    if (!attestation) throw new MissingSha256RestampRefusal(`feature-${index}-s3-artifact-has-no-manifest-attestation`);
    // Troisieme site ou la meme comparaison etait faite par egalite de chaine.
    // L'enveloppe servie declare l'endpoint ArcGIS NU comme `upstream_uri`, la
    // ligne de manifeste porte la forme `/query?...f=geojson` -- la seule qui
    // rende la geometrie. L'egalite stricte refusait donc l'attestation juste.
    //
    // Ce que ce controle doit garantir reste ENTIER : que l'attestation porte
    // bien sur la MEME source que celle declaree par l'enveloppe. C'est ce que
    // `manifestUrlMatchesServedEnvelope` verifie, en ramenant l'URL de capture
    // a son endpoint de couche ; deux endpoints differents ne s'apparient
    // jamais (teste). On remplace une comparaison de CHAINES par une
    // comparaison d'IDENTITE DE SOURCE, on ne supprime pas le controle.
    if (!manifestUrlMatchesServedEnvelope(attestation.replacementUrl, geometry.upstream_uri)) {
      throw new MissingSha256RestampRefusal(`feature-${index}-manifest-url-does-not-match-served-envelope`);
    }
    nextGeometry.artifact_uri = attestation.replacementUrl;
    nextGeometry.sha256 = attestation.sha256;
    encountered.add(artifactUri);
  }

  if (encountered.size === 0) throw new MissingSha256RestampRefusal("no-s3-artifact-uri-found-in-current-feature-proofs");
  for (const artifactUri of byArtifact.keys()) {
    if (!encountered.has(artifactUri)) throw new MissingSha256RestampRefusal("manifest-attestation-artifact-not-found-in-current-feature-proofs");
  }
  return { next, attestations: [...byArtifact.values()] };
}
