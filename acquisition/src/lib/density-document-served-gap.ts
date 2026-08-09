export interface GapNorm {
  zoneCode: string;
  value: number;
  unit: string;
}

export interface GapDocument {
  id: string;
  disposition: string;
  source: {
    url: string;
    legalDate: string | null;
  };
  crossValidation: {
    matchedNorms: number;
    missingInSig: string[];
  };
  corroboration?: {
    referenceDocumentId: string;
    exactMatchRequired: boolean;
    comparedNorms: number;
    exactMatches: number;
  };
  norms: GapNorm[];
}

export interface GapIngestReport {
  contract: string;
  slug: string;
  deposited: boolean;
  reviewScope?: {
    corroborationProfileIds?: string[];
  };
  documents: GapDocument[];
  norms: Array<GapNorm & { sourceUrl: string }>;
  merge?: {
    inserted?: number;
    enriched?: number;
  };
}

export interface DocumentGapRow {
  slug: string;
  id: string;
  sourceUrl: string;
  legalDate: string | null;
  reviewedNorms: number;
  directlySelectedNorms: number;
  identicalNormsInSelectedReference: number;
  referenceDocumentId: string;
}

export interface DocumentGapResult {
  before: {
    documentCount: number;
    publishableDocuments: number;
    directlySelectedDocuments: number;
    gapDocuments: number;
    gapCollections: number;
  };
  after: {
    documentCount: number;
    publishableDocuments: number;
    corroborationOnlyDocuments: number;
    remainingGapDocuments: number;
  };
  gap: DocumentGapRow[];
  reportsAfter: GapIngestReport[];
}

const canon = (value: unknown): string => String(value ?? "").trim().toUpperCase();

function selectedNormCount(report: GapIngestReport, sourceUrl: string): number {
  return report.norms.filter((norm) => norm.sourceUrl === sourceUrl).length;
}

function identicalNormCount(document: GapDocument, report: GapIngestReport): number {
  const selected = new Map(
    report.norms.map((norm) => [
      canon(norm.zoneCode),
      `${norm.value}\u0000${norm.unit}`,
    ]),
  );
  return document.norms.filter((norm) =>
    selected.get(canon(norm.zoneCode)) === `${norm.value}\u0000${norm.unit}`
  ).length;
}

export function buildDocumentGap(
  beforeReports: readonly GapIngestReport[],
  correctedReports: readonly GapIngestReport[],
): DocumentGapResult {
  const beforeBySlug = new Map(beforeReports.map((report) => [report.slug, report]));
  const correctedBySlug = new Map(correctedReports.map((report) => [report.slug, report]));
  const reportsAfter = beforeReports.map((report) => correctedBySlug.get(report.slug) ?? report);
  for (const report of correctedReports) {
    if (!beforeBySlug.has(report.slug)) {
      throw new Error(`rapport corrigé hors corpus: ${report.slug}`);
    }
  }

  const publishableBefore = beforeReports.flatMap((report) =>
    report.documents
      .filter((document) => document.disposition === "publishable")
      .map((document) => ({ report, document }))
  );
  const directBefore = publishableBefore.filter(({ report, document }) =>
    selectedNormCount(report, document.source.url) > 0
  );
  const gap = publishableBefore
    .filter(({ report, document }) => selectedNormCount(report, document.source.url) === 0)
    .map(({ report, document }): DocumentGapRow => {
      const corrected = correctedBySlug.get(report.slug);
      const correctedDocument = corrected?.documents.find((item) => item.id === document.id);
      if (
        !correctedDocument
        || correctedDocument.disposition !== "corroboration-only"
        || !correctedDocument.corroboration?.exactMatchRequired
        || correctedDocument.corroboration.exactMatches
          !== correctedDocument.corroboration.comparedNorms
      ) {
        throw new Error(`${report.slug}/${document.id}: correction exacte non prouvée`);
      }
      const directlySelectedNorms = selectedNormCount(report, document.source.url);
      const identicalNormsInSelectedReference = identicalNormCount(document, report);
      if (identicalNormsInSelectedReference !== document.norms.length) {
        throw new Error(`${report.slug}/${document.id}: lecture historique non identique`);
      }
      return {
        slug: report.slug,
        id: document.id,
        sourceUrl: document.source.url,
        legalDate: document.source.legalDate,
        reviewedNorms: document.norms.length,
        directlySelectedNorms,
        identicalNormsInSelectedReference,
        referenceDocumentId: correctedDocument.corroboration.referenceDocumentId,
      };
    });

  const publishableAfter = reportsAfter.flatMap((report) =>
    report.documents
      .filter((document) => document.disposition === "publishable")
      .map((document) => ({ report, document }))
  );
  const remainingGap = publishableAfter.filter(({ report, document }) =>
    selectedNormCount(report, document.source.url) === 0
  );
  return {
    before: {
      documentCount: beforeReports.reduce((sum, report) => sum + report.documents.length, 0),
      publishableDocuments: publishableBefore.length,
      directlySelectedDocuments: directBefore.length,
      gapDocuments: gap.length,
      gapCollections: new Set(gap.map((row) => row.slug)).size,
    },
    after: {
      documentCount: reportsAfter.reduce((sum, report) => sum + report.documents.length, 0),
      publishableDocuments: publishableAfter.length,
      corroborationOnlyDocuments: reportsAfter.flatMap((report) => report.documents)
        .filter((document) => document.disposition === "corroboration-only").length,
      remainingGapDocuments: remainingGap.length,
    },
    gap,
    reportsAfter,
  };
}

export interface DensityFeatureCollection {
  features?: Array<{
    properties?: Record<string, unknown> | null;
  }>;
}

export interface ServedDensityMeasurement {
  polygons: number;
  finiteDensityPolygons: number;
  sourceMatchedDensityPolygons: number;
  sourceUrls: string[];
  unmatchedDensityZoneCodes: string[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function measureServedDensity(
  normsCollection: DensityFeatureCollection,
  zonageCollection: DensityFeatureCollection,
): ServedDensityMeasurement {
  const norms = new Map<string, Record<string, unknown>>();
  for (const feature of normsCollection.features ?? []) {
    const properties = feature.properties ?? {};
    const code = canon(properties["zone_code"]);
    if (!code) continue;
    const previous = norms.get(code);
    if (
      previous
      && (
        previous["densite_value"] !== properties["densite_value"]
        || previous["densite_unit"] !== properties["densite_unit"]
        || previous["densite_source_url"] !== properties["densite_source_url"]
      )
    ) {
      throw new Error(`normes servies divergentes pour ${code}`);
    }
    norms.set(code, properties);
  }

  let finiteDensityPolygons = 0;
  let sourceMatchedDensityPolygons = 0;
  const sourceUrls = new Set<string>();
  const unmatchedDensityZoneCodes = new Set<string>();
  const features = zonageCollection.features ?? [];
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const value = properties["densite_value"];
    if (!finite(value)) continue;
    finiteDensityPolygons++;
    const code = canon(properties["zone_code"]);
    const selected = norms.get(code);
    const sourceUrl = selected?.["densite_source_url"];
    if (
      selected
      && selected["densite_value"] === value
      && selected["densite_unit"] === properties["densite_unit"]
      && typeof sourceUrl === "string"
      && /^https?:\/\//i.test(sourceUrl)
    ) {
      sourceMatchedDensityPolygons++;
      sourceUrls.add(sourceUrl);
    } else {
      unmatchedDensityZoneCodes.add(code || "(code absent)");
    }
  }
  return {
    polygons: features.length,
    finiteDensityPolygons,
    sourceMatchedDensityPolygons,
    sourceUrls: [...sourceUrls].sort(),
    unmatchedDensityZoneCodes: [...unmatchedDensityZoneCodes].sort(),
  };
}
