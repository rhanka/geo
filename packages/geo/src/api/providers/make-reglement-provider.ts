/**
 * Reglement-doc serving provider factory.
 *
 * Les routes de téléchargement de règlement lisent le CAS (`raw/<source>/cas/…`)
 * et le registre de serving (`registry/reglement-doc-serving.json`) — tous deux
 * au **bucket root**, HORS du préfixe `normalized/` auquel le {@link FeatureProvider}
 * OGC est scopé. Ce factory adosse donc son propre {@link Store} au bucket.
 *
 * Racine du store, par ordre :
 *   - `GEO_REGLEMENT_URI` (explicite) — une racine `s3://bucket` ou `fs:<dir>` ;
 *   - sinon dérivée de `dataLocation` : un data-URI `s3://bucket/prefix` donne un
 *     store bucket-root `s3://bucket` ; une data-location fs (répertoire) donne
 *     `undefined` (serving règlement OFF en dev local sauf `GEO_REGLEMENT_URI`).
 *
 * Le registre est chargé UNE fois au boot (Phase-1) : un back-fill post-capture de
 * `registry/reglement-doc-serving.json` est pris au prochain deploy. Absent/illisible
 * → vide (aucun règlement servi — jamais une entrée fabriquée).
 */
import { createStore, parseStoreUri } from "../../storage/index.js";
import type { Store } from "../../storage/index.js";
import {
  StoreReglementDocProvider,
  type ReglementDocProvider,
  type ReglementDocRegistry,
} from "../reglement-provider.js";

/** Clé S3 du registre de serving (bucket-root). */
export const REGLEMENT_REGISTRY_KEY = "registry/reglement-doc-serving.json";

/**
 * URI du store règlement (bucket-root) : override explicite, sinon dérivée du
 * `dataLocation` — un data-URI s3 donne `s3://<bucket>`, une data-location fs
 * donne `undefined` (pas de serving règlement sans configuration explicite).
 */
export function reglementStoreUri(
  dataLocation: string,
  reglementUri: string | undefined,
): string | undefined {
  if (reglementUri !== undefined && reglementUri.length > 0) return reglementUri;
  const parsed = parseStoreUri(dataLocation);
  return parsed.kind === "s3" ? `s3://${parsed.bucket}` : undefined;
}

/** Charge le registre de serving depuis le store ; vide si absent/illisible. */
export async function loadReglementRegistry(store: Store): Promise<ReglementDocRegistry> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await store.get(REGLEMENT_REGISTRY_KEY);
  } catch {
    return {};
  }
  if (bytes === undefined) return {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as ReglementDocRegistry)
      : {};
  } catch {
    return {};
  }
}

/**
 * Construit le {@link ReglementDocProvider}, ou `undefined` quand le serving
 * règlement n'est pas configuré (data-location fs sans `GEO_REGLEMENT_URI`).
 */
export async function makeReglementProvider(
  dataLocation: string,
  reglementUri: string | undefined = process.env["GEO_REGLEMENT_URI"],
): Promise<ReglementDocProvider | undefined> {
  const storeUri = reglementStoreUri(dataLocation, reglementUri);
  if (storeUri === undefined) return undefined;
  const store = createStore(storeUri);
  const registry = await loadReglementRegistry(store);
  return new StoreReglementDocProvider(store, registry);
}
