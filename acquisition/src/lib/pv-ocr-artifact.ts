/**
 * Durable, provenance-bearing OCR artefacts for captured PV CAS PDFs.
 *
 * The OCR text is data, not a workstation cache: it is kept in object storage
 * and is the only text an OCR graphification pass may consume.  This module is
 * deliberately small so both the OCR and graphification runners validate the
 * exact same closed artefact shape.
 */

export const PV_OCR_TEXT_CONTRACT = "pv-ocr-text/v1";
export const PV_OCR_TEXT_PREFIX = "normalized/pv-index/ocr/";

export interface PvOcrTextArtifact {
  readonly contract: typeof PV_OCR_TEXT_CONTRACT;
  readonly generated_at: string;
  readonly source: {
    readonly storage_key: string;
    readonly slug: string;
    readonly municipality_name: string | null;
    readonly url: string | null;
  };
  readonly ocr: {
    readonly provider: "mistral-ocr";
    readonly methode: string;
    readonly model: string | null;
    readonly input_transport: "s3-local-bounded" | "s3-presigned-url";
    readonly expected_pages: number | null;
    readonly verified_pages: number;
    readonly billed_pages: number;
    readonly cost_per_page_usd: "0.001";
    readonly cost_usd: string;
  };
  /** Mistral's page markdown, joined with form-feed page separators. */
  readonly text: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: objet requis`);
  }
  return value as JsonRecord;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null) return null;
  return string(value, where);
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${where}: entier positif requis`);
  return value as number;
}

/** The immutable SHA-256 portion of a canonical PV CAS key. */
export function pvCasDigest(storageKey: string): string {
  const match = /^raw\/pv-index\/cas\/([a-f0-9]{64})\.pdf$/u.exec(storageKey);
  if (!match) throw new Error(`clé CAS PV invalide: ${storageKey}`);
  return match[1]!;
}

export function pvOcrArtifactKey(storageKey: string): string {
  return `${PV_OCR_TEXT_PREFIX}${pvCasDigest(storageKey)}.json`;
}

/** Exact decimal representation at the published $0.001/page price. */
export function pvOcrUsd(pages: number): string {
  if (!Number.isSafeInteger(pages) || pages < 0) throw new Error(`pages OCR invalides: ${pages}`);
  return `${Math.floor(pages / 1000)}.${String(pages % 1000).padStart(3, "0")}`;
}

/** Fail closed before OCR text can be used as a semantic source. */
export function parsePvOcrTextArtifact(value: unknown, where: string): PvOcrTextArtifact {
  const root = record(value, where);
  if (root.contract !== PV_OCR_TEXT_CONTRACT) throw new Error(`${where}.contract inattendu`);
  const source = record(root.source, `${where}.source`);
  const ocr = record(root.ocr, `${where}.ocr`);
  const storageKey = string(source.storage_key, `${where}.source.storage_key`);
  pvCasDigest(storageKey);
  const expectedPages = ocr.expected_pages === null ? null : positiveInteger(ocr.expected_pages, `${where}.ocr.expected_pages`);
  const verifiedPages = positiveInteger(ocr.verified_pages, `${where}.ocr.verified_pages`);
  const billedPages = positiveInteger(ocr.billed_pages, `${where}.ocr.billed_pages`);
  const costUsd = string(ocr.cost_usd, `${where}.ocr.cost_usd`);
  if (ocr.cost_per_page_usd !== "0.001") throw new Error(`${where}.ocr.cost_per_page_usd doit valoir 0.001`);
  if (costUsd !== pvOcrUsd(billedPages)) throw new Error(`${where}.ocr.cost_usd incompatible avec billed_pages`);
  if (ocr.provider !== "mistral-ocr") throw new Error(`${where}.ocr.provider inattendu`);
  if (ocr.input_transport !== "s3-local-bounded" && ocr.input_transport !== "s3-presigned-url") {
    throw new Error(`${where}.ocr.input_transport inattendu`);
  }
  return {
    contract: PV_OCR_TEXT_CONTRACT,
    generated_at: string(root.generated_at, `${where}.generated_at`),
    source: {
      storage_key: storageKey,
      slug: string(source.slug, `${where}.source.slug`),
      municipality_name: nullableString(source.municipality_name, `${where}.source.municipality_name`),
      url: nullableString(source.url, `${where}.source.url`),
    },
    ocr: {
      provider: "mistral-ocr",
      methode: string(ocr.methode, `${where}.ocr.methode`),
      model: nullableString(ocr.model, `${where}.ocr.model`),
      input_transport: ocr.input_transport,
      expected_pages: expectedPages,
      verified_pages: verifiedPages,
      billed_pages: billedPages,
      cost_per_page_usd: "0.001",
      cost_usd: costUsd,
    },
    text: string(root.text, `${where}.text`),
  };
}
