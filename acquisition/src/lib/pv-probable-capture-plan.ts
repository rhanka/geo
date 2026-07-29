import { createHash } from "node:crypto";

import { classifyPvObservableDocument } from "./pv-observable-classification.js";

export interface PvIndexEntry {
  readonly url?: unknown;
  readonly title?: unknown;
}

export interface PvIndexSnapshot {
  readonly slug: string;
  readonly index_url: string | null;
  readonly entries: readonly PvIndexEntry[];
}

export interface PvCaptureTarget {
  readonly slug: string;
  readonly source: "pv-index";
  readonly urls: readonly [string];
}

export interface PvTerritorialCaptureSelection {
  readonly targets: readonly PvCaptureTarget[];
  /** Municipalités de référence, sans exception MRC ou nom affiché. */
  readonly municipalitySlugs: ReadonlySet<string>;
  /** Municipalités qui ont déjà au moins un PV indexé dans la partition fermée. */
  readonly coveredMunicipalitySlugs: ReadonlySet<string>;
  readonly count: number;
}

/**
 * Version observable d'un index PV S3. L'ETag et la date font partie du
 * snapshot: deux contenus différents sous la même clé ne sont pas un même
 * corpus.
 */
export type PvIndexListing = readonly (readonly [key: string, etag: string | null, lastModified: string | null])[];

export interface StablePvIndexListing {
  readonly sha256: `sha256:${string}`;
  readonly listing: PvIndexListing;
  /** Le rapport de classification était un ancien instantané, sans incohérence. */
  readonly classificationWasStale: boolean;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Stable hash of the exact target bytes later uploaded to S3. */
export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Hash exact du listing observable qui identifie un corpus d'index PV. */
export function pvIndexListingSha256(listing: PvIndexListing): `sha256:${string}` {
  return sha256(JSON.stringify({ pv_index_listing: listing }));
}

function listingChange(first: PvIndexListing, final: PvIndexListing): string {
  const firstByKey = new Map(first.map((entry) => [entry[0], entry]));
  const finalByKey = new Map(final.map((entry) => [entry[0], entry]));
  const changedVersions = [...firstByKey.keys()]
    .filter((key) => finalByKey.has(key) && JSON.stringify(firstByKey.get(key)) !== JSON.stringify(finalByKey.get(key)))
    .sort();
  if (changedVersions.length > 0) return `versions divergentes pour ${changedVersions.slice(0, 3).join(", ")}`;
  const added = [...finalByKey.keys()].filter((key) => !firstByKey.has(key)).sort();
  const removed = [...firstByKey.keys()].filter((key) => !finalByKey.has(key)).sort();
  return `clés ajoutées ${added.slice(0, 3).join(", ") || "aucune"}; clés supprimées ${removed.slice(0, 3).join(", ") || "aucune"}`;
}

/**
 * Un rapport historique peut être dépassé: le plan repart alors du listing
 * frais. En revanche, l'index ne peut pas changer entre le premier listing
 * et la lecture des octets, sinon les scans mélangent deux versions d'une
 * même clé et ne sont plus publiables.
 */
export function stablePvIndexListing(
  classificationSnapshot: string,
  firstListing: PvIndexListing,
  finalListing: PvIndexListing,
): StablePvIndexListing {
  const firstSha256 = pvIndexListingSha256(firstListing);
  const finalSha256 = pvIndexListingSha256(finalListing);
  if (firstSha256 !== finalSha256) {
    throw new Error(`snapshot d'index PV incohérent pendant la planification: ${listingChange(firstListing, finalListing)}`);
  }
  return {
    sha256: firstSha256,
    listing: firstListing,
    classificationWasStale: firstSha256 !== classificationSnapshot,
  };
}

/**
 * Recomputes only the observable selection from a frozen PV-index snapshot.
 * Duplicate URLs are owned by their lexicographically first municipal index so
 * a capture happens once; the literal URL remains attachable to every index.
 */
export function planPvProbableTargets(scans: readonly PvIndexSnapshot[]): PvCaptureTarget[] {
  const docs = new Map<string, { slugs: Set<string>; titles: Set<string>; selfReference: boolean }>();
  for (const scan of scans) {
    for (const raw of scan.entries) {
      const url = stringValue(raw.url);
      if (url === null) continue;
      let document = docs.get(url);
      if (!document) {
        document = { slugs: new Set<string>(), titles: new Set<string>(), selfReference: false };
        docs.set(url, document);
      }
      document.slugs.add(scan.slug);
      const title = stringValue(raw.title);
      if (title !== null) document.titles.add(title);
      document.selfReference ||= scan.index_url !== null && url === scan.index_url;
    }
  }
  const planned: PvCaptureTarget[] = [];
  for (const [url, document] of docs) {
    if (classifyPvObservableDocument({ url, titles: document.titles, selfReference: document.selfReference }).class !== "pv_probable") {
      continue;
    }
    const slug = [...document.slugs].sort()[0];
    if (slug === undefined) throw new Error(`URL PV sans municipalité: ${url}`);
    planned.push({ slug, source: "pv-index", urls: [url] });
  }
  return planned.sort((left, right) => left.slug.localeCompare(right.slug) || left.urls[0].localeCompare(right.urls[0]));
}

/**
 * Maximises territorial opening before document volume: one candidate is taken
 * for every municipality without an indexed PV before a second candidate from
 * any municipality is considered. Within an equally valuable tier, the
 * already deterministic PV plan order is preserved.
 */
export function selectPvProbableTargetsForUncoveredMunicipalities(
  selection: PvTerritorialCaptureSelection,
): PvCaptureTarget[] {
  if (!Number.isInteger(selection.count) || selection.count < 1) {
    throw new Error("nombre de cibles territoriales PV invalide");
  }
  const municipalities = new Set(selection.municipalitySlugs);
  if (municipalities.size === 0) throw new Error("référentiel municipal PV vide");
  const covered = new Set(selection.coveredMunicipalitySlugs);
  for (const slug of covered) {
    if (!municipalities.has(slug)) throw new Error(`municipalité couverte hors référentiel: ${slug}`);
  }
  const bySlug = new Map<string, PvCaptureTarget[]>();
  for (const target of selection.targets) {
    if (!municipalities.has(target.slug)) throw new Error(`cible PV hors référentiel municipal: ${target.slug}`);
    const targets = bySlug.get(target.slug) ?? [];
    targets.push(target);
    bySlug.set(target.slug, targets);
  }
  const uncovered = [...municipalities].filter((slug) => !covered.has(slug)).sort();
  const result: PvCaptureTarget[] = [];
  const append = (target: PvCaptureTarget): boolean => {
    if (result.length === selection.count) return false;
    result.push(target);
    return result.length < selection.count;
  };

  // The first pass is the territorial objective itself: each selected target
  // opens a currently uncovered municipality whenever such a candidate exists.
  for (const slug of uncovered) {
    const first = bySlug.get(slug)?.[0];
    if (first !== undefined && !append(first)) return result;
  }
  // Preserve the same priority when the requested campaign is larger than the
  // number of available municipalities: exhaust additional candidates from
  // uncovered municipalities before returning to already covered territory.
  for (const slug of uncovered) {
    for (const target of bySlug.get(slug)?.slice(1) ?? []) {
      if (!append(target)) return result;
    }
  }
  for (const slug of [...covered].sort()) {
    for (const target of bySlug.get(slug) ?? []) {
      if (!append(target)) return result;
    }
  }
  throw new Error(`cibles PV territoriales insuffisantes: ${result.length}/${selection.count}`);
}

export function splitPvCaptureTargets(targets: readonly PvCaptureTarget[], size: number): PvCaptureTarget[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("taille de lot PV invalide");
  const lots: PvCaptureTarget[][] = [];
  for (let index = 0; index < targets.length; index += size) lots.push([...targets.slice(index, index + size)]);
  return lots;
}

/**
 * Une reprise par offset d'URL doit conserver le numéro global du lot. Sans
 * cet invariant, une seconde invocation renumérote 1..N et peut publier une
 * worklist précédente sous un nouveau nom apparent.
 */
export function firstPvCaptureLotForRange(start: number, lotSize: number): number {
  if (!Number.isInteger(start) || start < 0) throw new Error("offset de reprise PV invalide");
  if (!Number.isInteger(lotSize) || lotSize < 1) throw new Error("taille de lot PV invalide");
  if (start % lotSize !== 0) throw new Error(`offset PV ${start} non aligné sur les lots de ${lotSize}`);
  return start / lotSize + 1;
}
