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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Stable hash of the exact target bytes later uploaded to S3. */
export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

export function splitPvCaptureTargets(targets: readonly PvCaptureTarget[], size: number): PvCaptureTarget[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("taille de lot PV invalide");
  const lots: PvCaptureTarget[][] = [];
  for (let index = 0; index < targets.length; index += size) lots.push([...targets.slice(index, index + size)]);
  return lots;
}
