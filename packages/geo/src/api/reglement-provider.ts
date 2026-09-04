/**
 * Provider abstraction for the downloadable-règlement serving routes
 * (`GET /reglement/:slug` + `GET /reglement/:slug.meta.json`).
 *
 * geo-archi ruling (Phase-1, zonage): a served règlement is a real DOWNLOAD —
 * the geo-api streams the captured PDF from `raw/<source>/cas/<sha256>.pdf` with
 * `Content-Disposition: attachment`, never a public-S3 URL nor a signed URL. The
 * companion `.meta.json` carries the proof-v2 (source_url + retrieved_at +
 * sha256, from the capture manifest §6), the identity (numéro, ville,
 * date_adoption) and the licence.
 *
 * INTÉGRITÉ PAR CONSTRUCTION : la clé CAS `raw/<source>/cas/<hex>.pdf` EST le
 * sha256 des octets (garde de capture §2.5 SPEC_CAPTURE_ON_CLUSTER : un PUT dont
 * le sha du corps ≠ le sha du nom de clé est refusé). Servir depuis cette clé =
 * servir les octets exacts du manifeste — pas de re-hash nécessaire au serve.
 *
 * LICENCE-gate (ADR-0013 OSM/ODbL comme précédent) : un règlement municipal est
 * généralement public → défaut `public` → on sert les octets. Un règlement
 * `restricted` → **link-only** : le tool sert la méta (dont `source_url`), JAMAIS
 * les octets. Anti-invention : la licence vient du registre, jamais devinée.
 *
 * Ce module ne fait AUCUN appel réseau vers une source tierce : il lit un
 * registre + streame un objet CAS déjà capté (lecture seule). Le seam est
 * découplé de la donnée comme {@link FeatureProvider}.
 */

import type { ByteStream, Store } from "../storage/index.js";

/** Disposition de licence d'un règlement servi. */
export type ReglementLicence = "public" | "restricted";

/** Preuve-v2 (issue du manifeste de capture §6). */
export interface ReglementProof {
  /** URL réellement appelée au fetch (source vivante). */
  source_url: string;
  /** Horodatage réel du fetch (ISO-8601), jamais fabriqué. */
  retrieved_at: string;
  /** sha256 des octets captés, format `sha256:<64 hex>`. */
  sha256: string;
}

/** Métadonnée servie par `GET /reglement/:slug.meta.json`. */
export interface ReglementDocMeta {
  slug: string;
  /** Numéro verbatim du règlement (`string` ou `null` si non attesté). */
  numero: string | null;
  ville: string | null;
  /** Date d'adoption verbatim (`YYYY-MM-DD` ou libellé source), `null` si inconnue. */
  date_adoption: string | null;
  licence: ReglementLicence;
  /** `true` = octets servis (public) ; `false` = link-only (restricted, ADR-0013). */
  downloadable: boolean;
  proof: ReglementProof;
}

/** Entrée de registre `reglement-doc-serving` (back-fillée POST-capture). */
export interface ReglementDocRegistryEntry {
  /** `<source>` de la clé CAS (`raw/<source>/cas/<hex>.<ext>`), ex. `reglement-doc`. */
  source: string;
  /** sha256 des octets, `sha256:<hex>` (= le nom de la clé CAS). */
  sha256: string;
  /** Extension de l'objet CAS (défaut `pdf`). */
  ext?: string;
  source_url: string;
  retrieved_at: string;
  numero: string | null;
  ville: string | null;
  date_adoption: string | null;
  /** Défaut `public` (municipal) ; `restricted` ⇒ link-only. */
  licence: ReglementLicence;
}

/** Registre slug→entrée, back-fillé après capture (index de serving). */
export type ReglementDocRegistry = Record<string, ReglementDocRegistryEntry>;

/**
 * Accès read-only pour les routes `/reglement/<slug>`. Un lookup qui manque
 * résout à `undefined` (la couche HTTP en fait un 404).
 */
export interface ReglementDocProvider {
  /** Métadonnée + preuve + licence pour un slug, ou `undefined` si inconnu. */
  getMeta(slug: string): Promise<ReglementDocMeta | undefined>;
  /**
   * Les octets PDF pour un slug, ou `undefined` si inconnu OU non-téléchargeable
   * (licence `restricted` ⇒ link-only, aucun octet). Préfère le streaming.
   */
  streamPdf(slug: string): Promise<ByteStream | undefined>;
}

/** `sha256:<hex>` → `<hex>` (le nom de la clé CAS est le hex nu). */
function sha256Hex(sha: string): string {
  return sha.startsWith("sha256:") ? sha.slice("sha256:".length) : sha;
}

/** Clé CAS d'un règlement capté : `raw/<source>/cas/<hex>.<ext>`. */
export function reglementCasKey(entry: ReglementDocRegistryEntry): string {
  return `raw/${entry.source}/cas/${sha256Hex(entry.sha256)}.${entry.ext ?? "pdf"}`;
}

/** `entry` → méta servie (downloadable = licence publique). */
function metaOf(slug: string, e: ReglementDocRegistryEntry): ReglementDocMeta {
  return {
    slug,
    numero: e.numero,
    ville: e.ville,
    date_adoption: e.date_adoption,
    licence: e.licence,
    downloadable: e.licence === "public",
    proof: { source_url: e.source_url, retrieved_at: e.retrieved_at, sha256: e.sha256 },
  };
}

/**
 * {@link ReglementDocProvider} adossé à un {@link Store} + un registre injecté.
 * `getMeta` lit le registre ; `streamPdf` streame l'objet CAS **uniquement** si la
 * licence est `public` (sinon link-only ⇒ `undefined`). Aucun appel réseau tiers.
 */
export class StoreReglementDocProvider implements ReglementDocProvider {
  readonly #store: Store;
  readonly #registry: ReglementDocRegistry;

  constructor(store: Store, registry: ReglementDocRegistry) {
    this.#store = store;
    this.#registry = registry;
  }

  async getMeta(slug: string): Promise<ReglementDocMeta | undefined> {
    const e = this.#registry[slug];
    return e ? metaOf(slug, e) : undefined;
  }

  async streamPdf(slug: string): Promise<ByteStream | undefined> {
    const e = this.#registry[slug];
    // Inconnu, ou restricted (link-only) : aucun octet servi.
    if (!e || e.licence !== "public") return undefined;
    const key = reglementCasKey(e);
    if (this.#store.getStream) return this.#store.getStream(key);
    const bytes = await this.#store.get(key);
    return bytes === undefined ? undefined : oneChunk(bytes);
  }
}

async function* oneChunk(bytes: Uint8Array): ByteStream {
  yield bytes;
}
