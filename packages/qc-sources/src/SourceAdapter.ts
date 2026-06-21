import type { SourceKind } from "./domain.js";
export type IsoDateString = string;
export type ObtentionMode =
  | "download"
  | "api"
  | "scraping"
  | "ocr-llm"
  | "transcription"
  | "manual";
export interface GeoBoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}
export interface SourceScope {
  readonly zones?: readonly string[];
  readonly bylaws?: readonly string[];
  readonly urls?: readonly string[];
  readonly bbox?: GeoBoundingBox;
}
export interface ListOptions {
  readonly city?: string;
  readonly since?: IsoDateString;
  readonly until?: IsoDateString;
  readonly limit?: number;
  readonly scope?: SourceScope;
  readonly signal?: AbortSignal;
}
export interface RawDocumentRef {
  readonly sourceKind: SourceKind;
  readonly city?: string;
  readonly url: string;
  readonly discoveredAt: IsoDateString;
  readonly title?: string;
  readonly publishedAt?: IsoDateString;
  readonly contentType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RawDocumentProvenance {
  readonly adapterVersion: string;
  readonly userAgent?: string;
  readonly fetchedViaObscura: boolean;
  readonly obtentionMode?: ObtentionMode;
}

export interface RawDocument {
  readonly ref: RawDocumentRef;
  readonly sourceKind: SourceKind;
  readonly city?: string;
  readonly url: string;
  readonly fetchedAt: IsoDateString;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly text?: string;
  readonly httpStatus?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly sha256?: string;
  readonly s3Key?: string;
  readonly provenance: RawDocumentProvenance;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SourceAdapter {
  readonly kind: SourceKind;
  readonly city?: string;
  readonly version: string;

  list(opts: ListOptions): AsyncIterable<RawDocumentRef>;
  fetch(ref: RawDocumentRef): Promise<RawDocument>;
  hash(raw: RawDocument): string;
}
