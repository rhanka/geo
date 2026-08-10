/**
 * Non-negotiable acquisition proof for a served qc-zonage GeoJSON.
 * A URL is the fetched geometry artefact/endpoint, never an S3 key, local path,
 * home page, pipeline label, or regulation URL.
 */
import { createHash } from "node:crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  captureProofFields,
  type CaptureManifestLine,
} from "../../../packages/qc-sources/src/capture/index.js";
import { BUCKET, isServedZoneKey, getBytes, objectHead, copyObject } from "./s3.js";

export type GeometrySourceType = "wfs" | "arcgis" | "agol" | "geonet" | "jmap" | "geojson-officiel" | "pdf-zonage";
export type GeometryMethod = "natif" | "georeference";
export type GeometryReliability = "directe" | "georeferencee";
export interface GeometrySourceProof {
  url: string;
  type: GeometrySourceType;
  method: GeometryMethod;
  reliability: GeometryReliability;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}
export interface ServedZoneGeoJson { type: "FeatureCollection"; features: Array<{ properties?: Record<string, unknown> | null }>; proof?: { schema_version: "2.0"; geometry_source: GeometrySourceProof } }

/**
 * SOURCE UNIQUE DE VÉRITÉ du vocabulaire des niveaux de preuve portés sur la donnée
 * servie (`zone_source_level`). Déclaré ICI parce que c'est ici qu'il est OPPOSÉ au
 * dépôt ; `fold-zone-source-to-zonage.ts` le ré-exporte (il importe déjà ce module,
 * donc aucun cycle). Les 5 niveaux dérivés du ledger + "documented", produit quand la
 * source est une source officielle re-téléchargeable et LIVE réellement fetchée.
 */
export type ZoneSourceLevel =
  | "historical-verified" | "documented" | "legacy-traceable" | "candidate" | "orphan" | "unknown";
export const ZONE_SOURCE_LEVELS: ReadonlySet<ZoneSourceLevel> = new Set<ZoneSourceLevel>([
  "historical-verified", "documented", "legacy-traceable", "candidate", "orphan", "unknown",
]);
/** Estampille de source portée par CHAQUE feature servie. `url: null` = null HONNÊTE
 *  (aucune source re-téléchargeable) — jamais une URL fabriquée. */
export interface ZoneSourceStamp { url: string | null; level: ZoneSourceLevel }
export const ZONE_SOURCE_URL_FIELD = "zone_source_url";
export const ZONE_SOURCE_LEVEL_FIELD = "zone_source_level";

const SOURCE_TYPES = new Set<GeometrySourceType>(["wfs", "arcgis", "agol", "geonet", "jmap", "geojson-officiel", "pdf-zonage"]);
const METHODS = new Set<GeometryMethod>(["natif", "georeference"]);
const RELIABILITIES = new Set<GeometryReliability>(["directe", "georeferencee"]);
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** True when the host is object storage (ours), which can never stand as an
 *  upstream source. Matched on DOT-SEPARATED LABELS, never on a substring: a
 *  plain `/s3[.:]/` also matches `services3.arcgis.com`, the busiest ArcGIS
 *  Online host there is, and silently refused every proof built from it. */
export function isObjectStorageHost(hostname: string): boolean {
  return hostname.toLowerCase().split(".").some((label) => label === "s3" || label.startsWith("s3-"));
}

export function isRealGeometryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    // Fragments are permitted (e.g. layer identity), but the actual network URL
    // must remain HTTP(S), and internal storage/local pseudo-sources are rejected.
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !/^(localhost|127\.|::1)/i.test(u.hostname) && !isObjectStorageHost(u.hostname);
  } catch { return false; }
}

export function sha256(bytes: string | Buffer | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function proofFromFetched(input: Omit<GeometrySourceProof, "retrieved_at" | "sha256"> & { bytes: string | Buffer | Uint8Array; retrievedAt?: string }): GeometrySourceProof {
  if (!isRealGeometryUrl(input.url)) throw new Error(`geometry proof requires a real HTTP(S) acquisition URL, got ${JSON.stringify(input.url)}`);
  const retrieved_at = input.retrievedAt ?? new Date().toISOString();
  if (!isIsoTimestamp(retrieved_at)) throw new Error("geometry proof retrieved_at must be an ISO timestamp");
  const proof = { url: input.url, type: input.type, method: input.method, reliability: input.reliability, retrieved_at, sha256: sha256(input.bytes) };
  assertGeometryProof(proof);
  return proof;
}

/**
 * ENTRÉE DE CAPTURE → PREUVE v2 (SPEC_CAPTURE_ON_CLUSTER.md §3.1, règle C-1).
 *
 * La correspondance est TOTALE et MÉCANIQUE : `url`, `retrieved_at` et `sha256`
 * viennent tels quels de la ligne de `capture/_runs/<run-id>/manifest.jsonl` —
 * l'instant et les octets sont ceux MESURÉS par le chokepoint, pas ceux que le
 * producteur affirme. Seuls `type` / `method` / `reliability`, qui relèvent du
 * vocabulaire zonage, restent à la charge de l'appelant.
 *
 * `captureProofFields` REFUSE une ligne sans octets (404/403/timeout) ou dont
 * l'URL a été rédigée : une preuve v2 ne peut pas naître d'un échec, ni d'une URL
 * non re-téléchargeable. C'est exactement la règle C-2 (une preuve sans capture
 * est déclarative, donc sans valeur).
 *
 * Aucun garde existant n'est modifié : la preuve produite passe par
 * `assertGeometryProof` comme n'importe quelle autre.
 */
export function proofFromCaptureEntry(
  line: CaptureManifestLine,
  kind: Pick<GeometrySourceProof, "type" | "method" | "reliability">,
): GeometrySourceProof {
  const fields = captureProofFields(line);
  const proof: GeometrySourceProof = {
    url: fields.url,
    type: kind.type,
    method: kind.method,
    reliability: kind.reliability,
    retrieved_at: fields.retrieved_at,
    sha256: fields.sha256,
  };
  assertGeometryProof(proof);
  return proof;
}

export function assertGeometryProof(value: unknown): asserts value is GeometrySourceProof {
  const p = value as Partial<GeometrySourceProof> | null;
  const coherentMethod = p?.method === "natif"
    ? p.reliability === "directe" && p.type !== "pdf-zonage"
    : p?.method === "georeference"
      ? p.reliability === "georeferencee" && p.type === "pdf-zonage"
      : false;
  if (
    !p ||
    !isRealGeometryUrl(p.url) ||
    !SOURCE_TYPES.has(p.type as GeometrySourceType) ||
    !METHODS.has(p.method as GeometryMethod) ||
    !RELIABILITIES.has(p.reliability as GeometryReliability) ||
    !coherentMethod ||
    !isIsoTimestamp(p.retrieved_at) ||
    !/^sha256:[a-f0-9]{64}$/.test(String(p.sha256))
  ) {
    throw new Error("served qc-zonage deposit refused: missing or invalid geometry acquisition proof");
  }
}

export function sameGeometryProof(a: unknown, b: unknown): boolean {
  try { assertGeometryProof(a); assertGeometryProof(b); }
  catch { return false; }
  return a.url === b.url && a.type === b.type && a.method === b.method && a.reliability === b.reliability && a.retrieved_at === b.retrieved_at && a.sha256 === b.sha256;
}

export { isServedZoneKey } from "./s3.js";

export interface ServedZonePropertyFeature {
  properties?: Record<string, unknown> | null;
}

/**
 * Carry the current served properties onto freshly acquired geometries for the
 * same canonical zone code.  The new source's properties win where it actually
 * supplies a value; old-only properties remain long enough for the additive
 * folds to refresh them after a successful geometry deposit.  No value is
 * invented and no geometry is touched.
 */
export function carryForwardServedZoneProperties<T extends ServedZonePropertyFeature>(
  incoming: T[],
  current: Iterable<ServedZonePropertyFeature>,
  canonicalZoneCode: (value: unknown) => string,
): { matched: number; unmatched: number } {
  const byCode = new Map<string, Record<string, unknown>>();
  for (const feature of current) {
    const props = feature.properties ?? {};
    const code = canonicalZoneCode(props["zone_code"]);
    if (!code) continue;
    // A zone may legitimately have several polygons. Merge their keys so that a
    // property present on any existing part survives the schema-loss gate.
    byCode.set(code, { ...(byCode.get(code) ?? {}), ...props });
  }

  let matched = 0;
  for (const feature of incoming) {
    const next = feature.properties ?? {};
    const code = canonicalZoneCode(next["zone_code"]);
    const prior = code ? byCode.get(code) : undefined;
    if (!prior) continue;
    feature.properties = { ...prior, ...next };
    matched++;
  }
  return { matched, unmatched: incoming.length - matched };
}

/**
 * Attach the exact same reviewed acquisition proof to collection and each feature,
 * AND stamp the served source identity (`zone_source_url` / `zone_source_level`) that
 * {@link assertServedZoneGeojson} now demands on every feature.
 *
 * ANTI-INVENTION: the default stamp is NOT fabricated — it is the very URL the
 * producer proved it fetched (`geometrySource.url`, hashed in the proof), at level
 * `documented` (official artefact, re-downloadable, human-reviewed acquisition path).
 * A producer that knows better passes an explicit `zoneSource`; a producer with no
 * re-obtainable source must pass `{ url: null, level: … }` — an honest null, never a
 * made-up URL. Values already present on a feature WIN over the default, so an
 * upstream stamp is never silently overwritten.
 */
export function attachGeometryProof<T extends ServedZoneGeoJson>(fc: T, geometrySource: GeometrySourceProof, zoneSource?: ZoneSourceStamp): T {
  assertGeometryProof(geometrySource);
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) throw new Error("served qc-zonage deposit refused: not a FeatureCollection");
  const stamp: ZoneSourceStamp = zoneSource ?? { url: geometrySource.url, level: "documented" };
  if (stamp.url !== null && !isRealGeometryUrl(stamp.url)) {
    throw new Error(`served qc-zonage deposit refused: zone_source_url must be a real http(s) URL or an explicit null, got ${JSON.stringify(stamp.url)}`);
  }
  if (!ZONE_SOURCE_LEVELS.has(stamp.level)) {
    throw new Error(`served qc-zonage deposit refused: zone_source_level ${JSON.stringify(stamp.level)} is outside the served vocabulary (${[...ZONE_SOURCE_LEVELS].join(" | ")})`);
  }
  for (const feature of fc.features) {
    feature.properties = {
      [ZONE_SOURCE_URL_FIELD]: stamp.url,
      [ZONE_SOURCE_LEVEL_FIELD]: stamp.level,
      ...(feature.properties ?? {}),
      proof: { schema_version: "2.0", geometry_source: { ...geometrySource } },
    };
  }
  fc.proof = { schema_version: "2.0", geometry_source: { ...geometrySource } };
  return fc;
}

/** Validate the complete object, not merely two independently well-formed proofs. */
export function assertServedZoneGeojson(key: string, fc: ServedZoneGeoJson): void {
  if (!isServedZoneKey(key)) throw new Error(`not a served zonage key: ${key}`);
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length === 0) {
    throw new Error("served qc-zonage deposit refused: empty or invalid FeatureCollection");
  }
  if (fc.proof?.schema_version !== "2.0") throw new Error("served qc-zonage deposit refused: invalid collection proof schema");
  assertGeometryProof(fc.proof?.geometry_source);
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i]!;
    const proof = f.properties?.proof as { schema_version?: unknown; geometry_source?: unknown } | undefined;
    if (proof?.schema_version !== "2.0" || !sameGeometryProof(fc.proof.geometry_source, proof.geometry_source)) {
      throw new Error("served qc-zonage deposit refused: feature proof differs from collection proof");
    }
    // Toute donnée servie porte SA SOURCE. Le v2 proof prouve l'ACQUISITION de la
    // géométrie ; ces deux champs sont ce que le consommateur lit. L'ABSENCE du
    // champ est refusée ; un `null` EXPLICITE est permis (null honnête).
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (!(ZONE_SOURCE_URL_FIELD in props)) {
      throw new Error(
        `served qc-zonage deposit refused: feature ${i} carries no "${ZONE_SOURCE_URL_FIELD}" — every served feature must state its geometry source (a real http(s) URL, or an EXPLICIT null when there is genuinely none; never fabricate one). Stamp it via attachGeometryProof(fc, proof[, { url, level }]).`,
      );
    }
    const url = props[ZONE_SOURCE_URL_FIELD];
    if (url !== null && !isRealGeometryUrl(url)) {
      throw new Error(
        `served qc-zonage deposit refused: feature ${i} "${ZONE_SOURCE_URL_FIELD}" must be a real http(s) URL or an explicit null, got ${JSON.stringify(url)}`,
      );
    }
    if (!(ZONE_SOURCE_LEVEL_FIELD in props)) {
      throw new Error(
        `served qc-zonage deposit refused: feature ${i} carries no "${ZONE_SOURCE_LEVEL_FIELD}" — required vocabulary: ${[...ZONE_SOURCE_LEVELS].join(" | ")}. Stamp it via attachGeometryProof(fc, proof[, { url, level }]).`,
      );
    }
    const level = props[ZONE_SOURCE_LEVEL_FIELD];
    if (typeof level !== "string" || !ZONE_SOURCE_LEVELS.has(level as ZoneSourceLevel)) {
      throw new Error(
        `served qc-zonage deposit refused: feature ${i} "${ZONE_SOURCE_LEVEL_FIELD}" ${JSON.stringify(level)} is outside the served vocabulary (${[...ZONE_SOURCE_LEVELS].join(" | ")})`,
      );
    }
  }
}

/** Only route for new served-zone writes. It validates proof immediately before S3. */
export async function putServedZoneGeojson(s3: S3Client, key: string, fc: ServedZoneGeoJson): Promise<void> {
  assertServedZoneGeojson(key, fc);
  await assertNoServedPropertyKeysLost(s3, key, fc);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(fc), ContentType: "application/geo+json" }));
}

/**
 * Replacement-only served write guarded by the ETag read during its preflight.
 *
 * `putServedZoneGeojson` remains the route for a first deposit, where no prior
 * object exists.  A replacement must instead call this function with the
 * current ETag and use {@link copyObjectIfMatch} for its immutable backup.  The
 * second HEAD is an early diagnostic; the `IfMatch` on the write is the actual
 * compare-and-swap and closes the race between validation and publication.
 */
export async function putServedZoneGeojsonIfMatch(
  s3: S3Client,
  key: string,
  fc: ServedZoneGeoJson,
  priorEtag: string,
): Promise<void> {
  if (!priorEtag) throw new Error(`served qc-zonage replacement refused: missing preflight ETag (${key})`);
  assertServedZoneGeojson(key, fc);
  const current = await objectHead(s3, key);
  if (!current.exists || !current.etag) {
    throw new Error(`served qc-zonage replacement refused: preflight object absent or lacks ETag (${key})`);
  }
  if (current.etag !== priorEtag) {
    throw new Error(`served qc-zonage replacement refused: ETag changed before validation (${key})`);
  }
  await assertNoServedPropertyKeysLost(s3, key, fc);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(fc),
    ContentType: "application/geo+json",
    IfMatch: priorEtag,
  }));
}

/**
 * A geometry replacement must never silently turn a served collection into a
 * poorer schema.  The incoming source is allowed to refresh values and geometry,
 * but every property key that was already served must still be represented after
 * the replacement.  This deliberately checks the collection-wide key set rather
 * than guessing which fields are "raw" versus business enrichment: a new fold
 * cannot fall through an incomplete hand-maintained allow-list.
 *
 * New collections are unaffected.  Existing but malformed collections fail
 * closed because there is no trustworthy baseline against which to protect the
 * served contract.
 */
async function assertNoServedPropertyKeysLost(
  s3: S3Client,
  key: string,
  incoming: ServedZoneGeoJson,
): Promise<void> {
  if (!(await objectHead(s3, key)).exists) return;

  let current: unknown;
  try {
    current = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  } catch (error) {
    throw new Error(
      `served qc-zonage deposit refused: cannot read the existing collection ${key} to protect its property contract (${error instanceof Error ? error.message : String(error)}). Repair/read the served object before replacing its geometry.`,
    );
  }
  const keysOf = (value: unknown, label: string): Set<string> => {
    const features = (value as { features?: unknown })?.features;
    if (!Array.isArray(features)) {
      throw new Error(`served qc-zonage deposit refused: existing ${label} ${key} is not a FeatureCollection; cannot compare property keys safely`);
    }
    const keys = new Set<string>();
    for (const feature of features) {
      const props = (feature as { properties?: unknown } | null)?.properties;
      if (props !== null && props !== undefined && (typeof props !== "object" || Array.isArray(props))) {
        throw new Error(`served qc-zonage deposit refused: existing ${label} ${key} has a non-object feature.properties; cannot compare property keys safely`);
      }
      for (const property of Object.keys((props ?? {}) as Record<string, unknown>)) keys.add(property);
    }
    return keys;
  };
  const before = keysOf(current, "collection");
  const after = keysOf(incoming, "replacement");
  const lost = [...before].filter((property) => !after.has(property)).sort();
  if (lost.length > 0) {
    throw new Error(
      `served qc-zonage deposit refused: replacement of existing ${key} would remove served property key(s): ${lost.join(", ")}. Preserve the existing properties for matching zone_code values, then re-run the additive enrichment folds (reglement, norms, usage dominant, geometry status, zone source, effet densifiant) before retrying; a geometry deposit may never silently impoverish a served collection.`,
    );
  }
}

/**
 * Provenance metadata keys an ADDITIVE fold may add/update/delete on an already
 * served qc-zonage collection WITHOUT re-proving geometry. This is the CEILING:
 * a caller narrows it via `opts.allowedProps` but can never widen it. Any key
 * OUTSIDE this set that differs from the served object aborts the write, so the
 * geometry and the `proof` block stay immutable through this path. These are the
 * exact keys the metadata folds stamp: reglement (fold-reglement-to-zonage),
 * usage_dominant (fold-usage-dominant), geometry status (fold-geometry-status-to-zonage)
 * and source url/level (fold-zone-source-to-zonage).
 */
export const PROVENANCE_PROP_WHITELIST: ReadonlySet<string> = new Set<string>([
  "reglement_numero",
  "reglement_millesime",
  "reglement_page_source",
  "reglement_url",
  "usage_dominant",
  "usage_dominant_source",
  "zone_geometry_status",
  "zone_geometry_flagged",
  "zone_source_url",
  "zone_source_level",
  "hauteur_min_value",
  "hauteur_min_unit",
  "hauteur_max_value",
  "hauteur_max_unit",
  "densite_value",
  "densite_unit",
  "densite_legal_date",
  "densite_legal_date_evidence",
  "marge_avant_min_value",
  "marge_avant_min_unit",
  "marge_laterale_min_value",
  "marge_laterale_min_unit",
  "marge_arriere_min_value",
  "marge_arriere_min_unit",
  "facade_min_value",
  "facade_min_unit",
  "superficie_min_value",
  "superficie_min_unit",
  "densite_avant",
  "densite_avant_millesime",
  "densite_avant_reglement",
  "densite_apres",
  "densite_apres_millesime",
  "densite_apres_reglement",
  "effet_densifiant",
  "effet_densifiant_delta",
  // Un effet DÉDUIT (des classes d'habitation autorisées) n'a pas la même valeur
  // probante qu'un effet LU dans une colonne de grille, et un consommateur qui
  // annote un procès-verbal doit pouvoir citer la page. Servir le verdict sans
  // sa méthode ni sa source rendait les deux indiscernables.
  "effet_densifiant_methode",
  "densite_avant_source",
  "densite_apres_source",
]);

export interface AdditiveOptions {
  /** Narrow the ceiling to exactly the keys this fold stamps (defence in depth).
   *  Must be a subset of {@link PROVENANCE_PROP_WHITELIST} or the write fails closed. */
  allowedProps?: Iterable<string>;
  /**
   * Narrow, one-shot exception for legacy immo proof envelopes. Each entry
   * identifies the current S3 URI, its replacement public URL, and the SHA-256
   * attesting their captured bytes. Only the v1 feature-proof leaf described by
   * an entry may change; collection proofs and every other field stay immutable.
   */
  allowProofArtifactUriSubstitution?: Iterable<ProofArtifactUriSubstitution>;
  /**
   * Narrow, one-shot restoration for an older v1 envelope that has no
   * `sources.geometry.sha256` member at all. An attested public URL and the
   * SHA-256 from the very same capture-manifest line are stamped together.
   *
   * This differs from `allowProofArtifactUriSubstitution`: that option proves
   * an existing SHA is unchanged; this one is the only additive route that
   * may introduce a missing SHA. It never replaces or corrects one.
   */
  allowProofArtifactUriAndSha256Stamp?: Iterable<ProofArtifactUriSubstitution>;
  /**
   * Narrow, one-shot promotion of a v1 envelope that already carries a public
   * HTTPS `artifact_uri` and a valid `sha256`, but NO `retrieved_at` — so it is
   * openable and hashable by a third party, yet attached to no capture.
   *
   * A fresh capture of that same URL returned bytes whose SHA-256 EQUALS the one
   * already served; the only thing added is the instant that capture measured.
   * Nothing is corrected: if the refetched SHA differed, the source has changed
   * since the proof was written and the caller must refuse rather than silently
   * overwrite it — losing that fact would be worse than the missing date.
   *
   * This is the third and last additive route on a proof, and each one adds
   * strictly what was ABSENT: `allowProofArtifactUriSubstitution` proves an
   * existing SHA unchanged, `allowProofArtifactUriAndSha256Stamp` introduces a
   * missing SHA, and this one introduces a missing `retrieved_at`. None of them
   * may ever replace a value that is already there.
   */
  allowProofCaptureAttestation?: Iterable<ProofCaptureAttestation>;
  /** Take a non-destructive server-side backup of the current served object to
   *  `<key>.additive-prebackup.geojson` before overwriting. Default true. */
  backup?: boolean;
}

export interface ProofArtifactUriSubstitution {
  artifactUri: string;
  replacementUrl: string;
  sha256: `sha256:${string}`;
}

/** Une capture qui a CONFIRME une preuve v1 : meme URL, meme SHA, plus l'instant mesure. */
export interface ProofCaptureAttestation {
  /** L'URL https deja portee par la preuve — inchangee, jamais substituee ici. */
  artifactUri: string;
  /** Le SHA-256 deja porte par la preuve, et re-obtenu par la capture. */
  sha256: `sha256:${string}`;
  /** L'instant mesure par le chokepoint de capture, jamais un horodatage de fichier. */
  retrievedAt: string;
}

/** Canonical JSON: object keys sorted, array order preserved (arrays ARE ordered —
 *  coordinate rings must never be treated as sets). Undefined normalises to null. */
function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = walk(src[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Key-order-tolerant deep equality via canonical JSON. Both operands here are parsed
 *  from the SAME served bytes (geometry), collection members, or scalar provenance
 *  values; the compare is exact and never treats a real change as equal — only a
 *  different SERIALISATION ORDER of the same content is accepted as unchanged. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

interface AdditiveFeature { geometry?: unknown; properties?: Record<string, unknown> | null }
interface AdditiveFC { type?: unknown; features?: AdditiveFeature[] }

const PROOF_SHA256_RE = /^sha256:[a-f0-9]{64}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * URL de remplacement acceptable dans une substitution d'`artifact_uri`.
 *
 * Cette fonction interdisait toute query string. La règle était une prudence
 * de forme — « une URL de document nue est stable » — et elle s'est révélée
 * FAUSSE sur la classe de sources la plus nombreuse.
 *
 * Un endpoint ArcGIS `FeatureServer/<n>` rend une PAGE HTML de description de
 * service. La géométrie n'est atteignable que par
 * `<endpoint>/query?where=1%3D1&outFields=*&f=geojson`. Interdire la query
 * revenait donc à n'admettre que l'URL qui NE sert PAS la donnée attestée :
 * exactement la preuve fabriquée qu'un re-stampage a été arrêté pour éviter
 * (0 écriture sur 10, 2026-07-28).
 *
 * Ce que le garde doit protéger n'est pas la forme de l'URL, c'est la
 * propriété : « cette URL, fetchée, a rendu des octets dont le SHA-256 est
 * celui qu'on atteste, et une ligne de manifeste l'enregistre ». La query
 * string est orthogonale à cette propriété — elle en est même la condition ici.
 *
 * Ce qui reste refusé, et pourquoi :
 *   - `http:` — une attestation ne se rejoue pas sur un canal non authentifié ;
 *   - les identifiants dans l'URL (`user:pass@`) — un secret dans une preuve
 *     publiée fuite, et l'URL n'est alors pas rejouable par un tiers ;
 *   - le fragment (`#…`) — jamais transmis au serveur, donc il ne peut pas
 *     faire partie de ce qui a produit les octets ; le laisser suggérerait
 *     qu'il compte.
 * Les autres gardes de la substitution restent inchangés : l'URI d'origine doit
 * être `s3://`, le SHA-256 doit venir de la même ligne de manifeste et être
 * écrit dans la même opération, et toute autre altération de l'enveloppe échoue.
 */
function isAttestableReplacementUrl(value: unknown): value is string {
  if (!isRealGeometryUrl(value)) return false;
  const parsed = new URL(value);
  return parsed.protocol === "https:" && parsed.hash.length === 0 && parsed.username === "" && parsed.password === "";
}

function checkedProofArtifactUriAttestations(
  candidates: Iterable<ProofArtifactUriSubstitution> | undefined,
  label: string,
): ProofArtifactUriSubstitution[] {
  const substitutions = candidates
    ? [...candidates]
    : [];
  const seen = new Set<string>();
  for (const substitution of substitutions) {
    if (
      !substitution ||
      typeof substitution.artifactUri !== "string" ||
      !substitution.artifactUri.startsWith("s3://") ||
      !isAttestableReplacementUrl(substitution.replacementUrl) ||
      !PROOF_SHA256_RE.test(substitution.sha256)
    ) {
      throw new Error(`putServedZoneAdditive: invalid ${label} attestation`);
    }
    const tuple = `${substitution.artifactUri}\u0000${substitution.replacementUrl}\u0000${substitution.sha256}`;
    if (seen.has(tuple)) throw new Error(`putServedZoneAdditive: duplicate ${label} attestation`);
    seen.add(tuple);
  }
  return substitutions;
}

function proofArtifactUriSubstitutions(options: AdditiveOptions): ProofArtifactUriSubstitution[] {
  return checkedProofArtifactUriAttestations(
    options.allowProofArtifactUriSubstitution,
    "proof artifact_uri substitution",
  );
}

function proofArtifactUriAndSha256Stamps(options: AdditiveOptions): ProofArtifactUriSubstitution[] {
  return checkedProofArtifactUriAttestations(
    options.allowProofArtifactUriAndSha256Stamp,
    "proof artifact_uri + sha256 stamp",
  );
}

/**
 * Valide les attestations de capture AVANT toute comparaison, comme les deux
 * routes voisines : une entree mal formee doit faire echouer l'ecriture, pas
 * etre ignoree silencieusement — sans quoi un appel qui croit stamper n'aurait
 * simplement aucun effet et personne ne s'en apercevrait.
 */
function proofCaptureAttestations(options: AdditiveOptions): ProofCaptureAttestation[] {
  const attestations = options.allowProofCaptureAttestation ? [...options.allowProofCaptureAttestation] : [];
  const seen = new Set<string>();
  for (const attestation of attestations) {
    if (
      !attestation ||
      !isAttestableReplacementUrl(attestation.artifactUri) ||
      !PROOF_SHA256_RE.test(attestation.sha256) ||
      !isIsoTimestamp(attestation.retrievedAt)
    ) {
      throw new Error("putServedZoneAdditive: invalid proof capture attestation");
    }
    const tuple = `${attestation.artifactUri} ${attestation.sha256} ${attestation.retrievedAt}`;
    if (seen.has(tuple)) throw new Error("putServedZoneAdditive: duplicate proof capture attestation");
    seen.add(tuple);
  }
  return attestations;
}

/**
 * Returns true only for the one legacy v1 proof mutation explicitly attested in
 * {@link AdditiveOptions.allowProofArtifactUriSubstitution}. Restoring the old
 * URI before comparison proves that no sibling or nested field changed.
 */
function isAttestedProofArtifactUriSubstitution(
  currentProof: unknown,
  nextProof: unknown,
  substitutions: readonly ProofArtifactUriSubstitution[],
): boolean {
  const current = asRecord(currentProof);
  const next = asRecord(nextProof);
  if (current?.schema_version !== "1.0" || next?.schema_version !== "1.0") return false;
  const currentSources = asRecord(current.sources);
  const nextSources = asRecord(next.sources);
  const currentGeometry = asRecord(currentSources?.geometry);
  const nextGeometry = asRecord(nextSources?.geometry);
  const artifactUri = currentGeometry?.artifact_uri;
  const replacementUrl = nextGeometry?.artifact_uri;
  const sha256 = currentGeometry?.sha256;
  if (
    typeof artifactUri !== "string" ||
    !artifactUri.startsWith("s3://") ||
    !isAttestableReplacementUrl(replacementUrl) ||
    typeof sha256 !== "string" ||
    !PROOF_SHA256_RE.test(sha256) ||
    nextGeometry?.sha256 !== sha256
  ) return false;
  const attested = substitutions.some((substitution) =>
    substitution.artifactUri === artifactUri &&
    substitution.replacementUrl === replacementUrl &&
    substitution.sha256 === sha256,
  );
  if (!attested) return false;
  return jsonEqual(current, {
    ...next,
    sources: {
      ...nextSources,
      geometry: { ...nextGeometry, artifact_uri: artifactUri },
    },
  });
}

/**
 * Restoration companion to {@link isAttestedProofArtifactUriSubstitution}.
 * It admits exactly two coupled leaf changes in a v1 feature proof: the legacy
 * `s3://` URI becomes the HTTPS URL actually captured by the manifest — query
 * string included when that is what served the bytes — and the
 * previously ABSENT SHA-256 member is added from that same manifest line.
 * Reconstructing the old proof before comparison makes every other alteration
 * fail closed.
 */
function isAttestedProofArtifactUriAndSha256Stamp(
  currentProof: unknown,
  nextProof: unknown,
  stamps: readonly ProofArtifactUriSubstitution[],
): boolean {
  const current = asRecord(currentProof);
  const next = asRecord(nextProof);
  if (current?.schema_version !== "1.0" || next?.schema_version !== "1.0") return false;
  const currentSources = asRecord(current.sources);
  const nextSources = asRecord(next.sources);
  const currentGeometry = asRecord(currentSources?.geometry);
  const nextGeometry = asRecord(nextSources?.geometry);
  const artifactUri = currentGeometry?.artifact_uri;
  const replacementUrl = nextGeometry?.artifact_uri;
  // `undefined` is insufficient: a served `null` or malformed value must not
  // be silently upgraded under a name that promises a missing-field repair.
  if (
    !currentGeometry ||
    Object.hasOwn(currentGeometry, "sha256") ||
    typeof artifactUri !== "string" ||
    !artifactUri.startsWith("s3://") ||
    !isAttestableReplacementUrl(replacementUrl) ||
    typeof nextGeometry?.sha256 !== "string" ||
    !PROOF_SHA256_RE.test(nextGeometry.sha256)
  ) return false;
  const attested = stamps.some((stamp) =>
    stamp.artifactUri === artifactUri &&
    stamp.replacementUrl === replacementUrl &&
    stamp.sha256 === nextGeometry.sha256,
  );
  if (!attested) return false;
  const restoredGeometry: Record<string, unknown> = { ...nextGeometry, artifact_uri: artifactUri };
  delete restoredGeometry.sha256;
  return jsonEqual(current, {
    ...next,
    sources: {
      ...nextSources,
      geometry: restoredGeometry,
    },
  });
}

/**
 * Promotion v1 -> v2 d'une preuve deja OUVRABLE et HACHABLE mais rattachee a
 * aucune capture. Le seul ajout admis est `retrieved_at`; `artifact_uri` et
 * `sha256` doivent etre IDENTIQUES de part et d'autre.
 *
 * L'egalite du SHA est la condition de fond : elle prouve que la capture qui
 * fournit l'instant a bien rendu LES MEMES OCTETS que ceux deja attestes. Si le
 * SHA differe, le document en ligne a change depuis la preuve — et ce cas doit
 * REMONTER, jamais etre absorbe en ecrasant le SHA servi.
 *
 * Reconstruire l'ancienne preuve avant comparaison fait echouer fermement toute
 * autre alteration, exactement comme les deux routes additives voisines.
 */
function isAttestedProofCaptureStamp(
  currentProof: unknown,
  nextProof: unknown,
  attestations: readonly ProofCaptureAttestation[],
): boolean {
  const current = asRecord(currentProof);
  const next = asRecord(nextProof);
  if (current?.schema_version !== "1.0" || next?.schema_version !== "1.0") return false;
  const currentSources = asRecord(current.sources);
  const nextSources = asRecord(next.sources);
  const currentGeometry = asRecord(currentSources?.geometry);
  const nextGeometry = asRecord(nextSources?.geometry);
  const artifactUri = currentGeometry?.artifact_uri;
  const sha = currentGeometry?.sha256;
  const retrievedAt = nextGeometry?.retrieved_at;
  if (
    !currentGeometry ||
    // `retrieved_at` deja present : il n'y a rien a ajouter, et le remplacer
    // reecrirait un instant mesure par une autre capture.
    Object.hasOwn(currentGeometry, "retrieved_at") ||
    !isAttestableReplacementUrl(artifactUri) ||
    typeof sha !== "string" ||
    !PROOF_SHA256_RE.test(sha) ||
    // L'URL et le SHA doivent traverser INCHANGES : cette route n'en corrige aucun.
    nextGeometry?.artifact_uri !== artifactUri ||
    nextGeometry?.sha256 !== sha ||
    !isIsoTimestamp(retrievedAt)
  ) return false;
  const attested = attestations.some((attestation) =>
    attestation.artifactUri === artifactUri &&
    attestation.sha256 === sha &&
    attestation.retrievedAt === retrievedAt,
  );
  if (!attested) return false;
  const restoredGeometry: Record<string, unknown> = { ...nextGeometry };
  delete restoredGeometry.retrieved_at;
  return jsonEqual(current, {
    ...next,
    sources: {
      ...nextSources,
      geometry: restoredGeometry,
    },
  });
}

/**
 * ADDITIVE provenance write onto an ALREADY SERVED qc-zonage collection.
 *
 * The ONLY sanctioned way for a metadata fold to touch a served-zone key. It does
 * NOT relax the geometry proof gate of {@link putServedZoneGeojson}: it PROVES the
 * geometry is byte-identical to what is already served and refuses anything else,
 * so no new geometry can enter by this door.
 *
 * Safety invariants enforced before a single byte is written:
 *   (a) the target key ALREADY EXISTS — this path never CREATES a served collection;
 *   (b) same feature COUNT and same ORDER as the served object;
 *   (c) each feature's GEOMETRY is byte-identical to the served geometry;
 *   (d) every property that DIFFERS from the served object is in the whitelist —
 *       a fold may add/update/delete provenance keys and NOTHING else, so the
 *       `proof` block and every substantive attribute stay untouched, except
 *       for an explicitly attested legacy v1 artifact_uri replacement.
 * The current served object is re-read from S3 as the baseline (the caller is never
 * trusted for it). Then a non-destructive backup is taken and the bytes are written.
 */
export async function putServedZoneAdditive(
  s3: S3Client,
  key: string,
  fc: AdditiveFC,
  opts: AdditiveOptions = {},
): Promise<{ features: number }> {
  if (!isServedZoneKey(key)) throw new Error(`putServedZoneAdditive: not a served zonage key: ${key}`);
  const allowed = opts.allowedProps ? new Set(opts.allowedProps) : new Set(PROVENANCE_PROP_WHITELIST);
  for (const k of allowed) {
    if (!PROVENANCE_PROP_WHITELIST.has(k)) {
      throw new Error(`putServedZoneAdditive: "${k}" is not a provenance metadata key; refuse to widen the whitelist`);
    }
  }
  const substitutions = proofArtifactUriSubstitutions(opts);
  const sha256Stamps = proofArtifactUriAndSha256Stamps(opts);
  const substitutionUris = new Set(substitutions.map((item) => item.artifactUri));
  const captureAttestations = proofCaptureAttestations(opts);
  if (sha256Stamps.some((item) => substitutionUris.has(item.artifactUri))) {
    throw new Error("putServedZoneAdditive: a proof artifact_uri may use either substitution or missing-sha256 restoration, never both");
  }
  // Les trois routes additives ajoutent chacune ce qui MANQUE; les cumuler sur
  // une meme URI signifierait qu'on ne sait pas dans quel etat est la preuve.
  const stampedUris = new Set(sha256Stamps.map((item) => item.replacementUrl));
  if (captureAttestations.some((item) => substitutionUris.has(item.artifactUri) || stampedUris.has(item.artifactUri))) {
    throw new Error("putServedZoneAdditive: a proof artifact_uri may not combine a capture attestation with a substitution or a missing-sha256 restoration");
  }
  if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("putServedZoneAdditive: payload is not a FeatureCollection");
  }
  // (a) the collection must already be served — additive writes never create one.
  if (!(await objectHead(s3, key)).exists) {
    throw new Error(`putServedZoneAdditive: refuse to create a served collection additively (${key})`);
  }
  // Re-read the authoritative served object as the geometry baseline; never trust
  // the caller's in-memory copy for what is currently served.
  const current = JSON.parse((await getBytes(s3, key)).toString("utf8")) as AdditiveFC;
  // (b0) EVERY top-level member except `features` must be byte-identical to the
  // served object — `proof` FIRST AND FOREMOST. Without this, the "safe" additive
  // door lets a caller rewrite fc.proof.geometry_source.url (a forged collection
  // proof) while keeping the genuine per-feature proof. Collection-level members are
  // immutable on this path: changing them means re-proving via putServedZoneGeojson.
  {
    const cur = current as unknown as Record<string, unknown>;
    const nxt = fc as unknown as Record<string, unknown>;
    for (const member of new Set([...Object.keys(cur), ...Object.keys(nxt)])) {
      if (member === "features" || jsonEqual(cur[member], nxt[member])) continue;
      throw new Error(
        `putServedZoneAdditive: top-level collection member "${member}" differs from the served object; refused (the additive path may only change whitelisted feature provenance properties — a different collection proof/metadata requires putServedZoneGeojson with a real acquisition proof)`,
      );
    }
  }
  const curFeats = Array.isArray(current.features) ? current.features : [];
  const nxtFeats = fc.features as AdditiveFeature[];
  // (b) same count and order.
  if (curFeats.length !== nxtFeats.length) {
    throw new Error(
      `putServedZoneAdditive: feature count changed (${curFeats.length} -> ${nxtFeats.length}); a geometry change requires putServedZoneGeojson with proof`,
    );
  }
  for (let i = 0; i < curFeats.length; i++) {
    const cur = curFeats[i]!;
    const nxt = nxtFeats[i]!;
    // (c) geometry byte-identical.
    if (!jsonEqual(cur.geometry, nxt.geometry)) {
      throw new Error(
        `putServedZoneAdditive: feature ${i} geometry differs from served; new geometry requires putServedZoneGeojson with proof`,
      );
    }
    // (d) only whitelisted properties may differ (add / update / delete), with
    // the single attested legacy v1 proof-URI substitution below.
    const curProps = (cur.properties ?? {}) as Record<string, unknown>;
    const nxtProps = (nxt.properties ?? {}) as Record<string, unknown>;
    for (const propKey of new Set([...Object.keys(curProps), ...Object.keys(nxtProps)])) {
      if (jsonEqual(curProps[propKey], nxtProps[propKey])) continue;
      if (
        propKey === "proof" && (
          isAttestedProofArtifactUriSubstitution(curProps[propKey], nxtProps[propKey], substitutions) ||
          isAttestedProofArtifactUriAndSha256Stamp(curProps[propKey], nxtProps[propKey], sha256Stamps) ||
          isAttestedProofCaptureStamp(curProps[propKey], nxtProps[propKey], captureAttestations)
        )
      ) continue;
      if (!allowed.has(propKey)) {
        throw new Error(
          `putServedZoneAdditive: non-provenance property "${propKey}" changed on feature ${i}; refused (geometry/proof and substantive attributes are immutable on this path)`,
        );
      }
    }
  }
  // Non-destructive backup of the current served object before overwriting. The backup suffix excludes this key from the producer selector (`[a-z0-9-]+`), but OGC API serves it as a collection.
  // Measured 2026-07-29: `qc-zonage-sutton.additive-prebackup` returned HTTP 200 (95 features; 85 with `effet_densifiant` other than `inconnu`).
  // The generic copy gate accepts it (single, overwriteable "before this write").
  if (opts.backup !== false) {
    await copyObject(s3, key, `${key.replace(/\.geojson$/, "")}.additive-prebackup.geojson`);
  }
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(fc), ContentType: "application/geo+json" }),
  );
  return { features: nxtFeats.length };
}
