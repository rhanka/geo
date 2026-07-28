/**
 * Reproducible closure report for the closed density-document corpus.
 *
 * Reads the historical deposited ingest reports, the dry-run correction reports,
 * the control-lot report, and the effective S3 layouts served by geo-api. It
 * writes JSON + Markdown atomically and never mutates S3.
 *
 * Run from acquisition/:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   node --import tsx src/density-document-served-gap-report.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildDocumentGap,
  measureServedDensity,
  type DensityFeatureCollection,
  type GapIngestReport,
} from "./lib/density-document-served-gap.js";
import {
  getBytes,
  objectHead,
  s3Client,
} from "./lib/s3.js";

const NORMS_PREFIX = "normalized/qc-zonage-norms/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const EXPECTED_SERVED_COLLECTIONS = 10;
const EXPECTED_SERVED_DENSITY_POLYGONS = 522;

interface ServedCollection {
  slug: string;
  normsObject: {
    key: string;
    etag: string | null;
    lastModified: string | null;
    sha256: string;
  };
  zonageObject: {
    key: string;
    etag: string | null;
    lastModified: string | null;
    sha256: string;
  };
  polygons: number;
  finiteDensityPolygons: number;
  sourceMatchedDensityPolygons: number;
  sourceUrls: string[];
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readReport(path: string): GapIngestReport {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<GapIngestReport>;
  if (
    !["density-document-norm-ingest/v2", "density-document-norm-ingest/v2-progress"]
      .includes(value.contract ?? "")
    || typeof value.slug !== "string"
    || !Array.isArray(value.documents)
  ) {
    throw new Error(`rapport d'ingest invalide: ${path}`);
  }
  return {
    ...value,
    contract: value.contract!,
    slug: value.slug,
    deposited: value.deposited === true,
    documents: value.documents,
    norms: Array.isArray(value.norms) ? value.norms : [],
  };
}

function reportInput(path: string, repoRoot: string): { path: string; sha256: string } {
  const bytes = readFileSync(path);
  return { path: relative(repoRoot, path), sha256: sha256(bytes) };
}

function effectiveZonageCandidates(slug: string): [string, string] {
  return [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
}

function lotResult(
  ids: readonly string[],
  reports: readonly GapIngestReport[],
): {
  documentIds: string[];
  passed: boolean;
  deposited: boolean;
  inserted: number;
  enriched: number;
} {
  const byId = new Map(
    reports.flatMap((report) => report.documents.map((document) => [document.id, document] as const)),
  );
  for (const id of ids) {
    const document = byId.get(id);
    if (
      !document
      || document.disposition !== "corroboration-only"
      || !document.corroboration?.exactMatchRequired
      || document.corroboration.exactMatches !== document.corroboration.comparedNorms
    ) {
      throw new Error(`lot non validé pour ${id}`);
    }
  }
  const inserted = reports.reduce((sum, report) => sum + (report.merge?.inserted ?? 0), 0);
  const enriched = reports.reduce((sum, report) => sum + (report.merge?.enriched ?? 0), 0);
  if (inserted !== 0 || enriched !== 0) {
    throw new Error(`un reclassement de corroboration a muté les normes: +${inserted}/~${enriched}`);
  }
  return {
    documentIds: [...ids],
    passed: true,
    deposited: reports.some((report) => report.deposited),
    inserted,
    enriched,
  };
}

async function measureCollections(
  reports: readonly GapIngestReport[],
): Promise<ServedCollection[]> {
  const s3 = s3Client();
  const slugs = [...new Set(
    reports
      .filter((report) =>
        report.documents.some((document) => document.disposition === "publishable")
      )
      .map((report) => report.slug),
  )].sort();
  const collections: ServedCollection[] = [];
  for (const slug of slugs) {
    const normsKey = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
    const [flatKey, nestedKey] = effectiveZonageCandidates(slug);
    const [normsHead, flatHead, nestedHead] = await Promise.all([
      objectHead(s3, normsKey),
      objectHead(s3, flatKey),
      objectHead(s3, nestedKey),
    ]);
    if (!normsHead.exists) throw new Error(`${slug}: grille de normes servie absente`);
    const zonageKey = nestedHead.exists ? nestedKey : flatHead.exists ? flatKey : null;
    const zonageHead = nestedHead.exists ? nestedHead : flatHead;
    if (!zonageKey || !zonageHead.exists) throw new Error(`${slug}: zonage servi absent`);
    const [normsBytes, zonageBytes] = await Promise.all([
      getBytes(s3, normsKey),
      getBytes(s3, zonageKey),
    ]);
    const [normsHeadAfter, zonageHeadAfter] = await Promise.all([
      objectHead(s3, normsKey),
      objectHead(s3, zonageKey),
    ]);
    if (
      !normsHeadAfter.exists
      || !zonageHeadAfter.exists
      || normsHeadAfter.etag !== normsHead.etag
      || zonageHeadAfter.etag !== zonageHead.etag
    ) {
      throw new Error(`${slug}: objet S3 réindexé pendant la lecture; remesurer`);
    }
    const measured = measureServedDensity(
      JSON.parse(normsBytes.toString("utf8")) as DensityFeatureCollection,
      JSON.parse(zonageBytes.toString("utf8")) as DensityFeatureCollection,
    );
    if (
      measured.finiteDensityPolygons !== measured.sourceMatchedDensityPolygons
      || measured.unmatchedDensityZoneCodes.length > 0
    ) {
      throw new Error(
        `${slug}: densités servies sans jointure sourcée exacte: `
        + measured.unmatchedDensityZoneCodes.join(","),
      );
    }
    collections.push({
      slug,
      normsObject: {
        key: normsKey,
        etag: normsHeadAfter.etag ?? null,
        lastModified: normsHeadAfter.lastModified?.toISOString() ?? null,
        sha256: sha256(normsBytes),
      },
      zonageObject: {
        key: zonageKey,
        etag: zonageHeadAfter.etag ?? null,
        lastModified: zonageHeadAfter.lastModified?.toISOString() ?? null,
        sha256: sha256(zonageBytes),
      },
      polygons: measured.polygons,
      finiteDensityPolygons: measured.finiteDensityPolygons,
      sourceMatchedDensityPolygons: measured.sourceMatchedDensityPolygons,
      sourceUrls: measured.sourceUrls,
    });
  }
  return collections;
}

function markdown(report: {
  generatedAt: string;
  scope: {
    documentCount: number;
    publishableDocuments: number;
    directlySelectedDocuments: number;
    gapDocuments: number;
    gapCollections: number;
  };
  gap: Array<{
    lot: string;
    slug: string;
    id: string;
    sourceUrl: string;
    legalDate: string | null;
    reviewedNorms: number;
    directlySelectedNorms: number;
    identicalNormsInSelectedReference: number;
  }>;
  closure: {
    documentCount: number;
    publishableDocuments: number;
    corroborationOnlyDocuments: number;
    remainingGapDocuments: number;
    servedCollections: number;
    servedDensityPolygons: number;
    newlyFoldedCollections: number | null;
    newlyDensePolygons: number | null;
    servedChanges: Array<{
      slug: string;
      before: number;
      after: number;
      delta: number;
      normsChanged: boolean;
      zonageChanged: boolean;
    }>;
    unfoldedEvidence: Array<{ slug: string; zoneCode: string; reason: string }>;
  };
  servedMeasurement: {
    collections: Array<{ slug: string; finiteDensityPolygons: number }>;
  };
}): string {
  const lines = [
    "# Écart documents de densité → objets servis",
    "",
    `Mesure S3 reproductible: ${report.generatedAt}. Univers fermé: les rapports d'ingest déjà enregistrés; aucune nouvelle recherche documentaire.`,
    "",
    `- Documents initialement marqués \`publishable\`: **${report.scope.publishableDocuments}**`,
    `- Documents revus dans l'univers fermé: **${report.scope.documentCount}**`,
    `- Documents directement sélectionnés comme source servie: **${report.scope.directlySelectedDocuments}**`,
    `- Écart initial: **${report.scope.gapDocuments} documents**, dans **${report.scope.gapCollections} collections**`,
    `- Écart après reclassement prouvé: **${report.closure.remainingGapDocuments} document**`,
    "",
    "## Liste exacte de l'écart initial",
    "",
    "| Lot | Collection | Document | Date légale | Normes relues | Directes | Identiques à la référence plus récente |",
    "|---|---|---|---:|---:|---:|---:|",
  ];
  for (const row of report.gap) {
    lines.push(
      `| ${row.lot} | ${row.slug} | \`${row.id}\` — ${row.sourceUrl.replace(/\|/g, "\\|")} `
      + `| ${row.legalDate ?? "—"} | ${row.reviewedNorms} | ${row.directlySelectedNorms} `
      + `| ${row.identicalNormsInSelectedReference} |`,
    );
  }
  lines.push(
    "",
    "Ces documents sont tous antérieurs et leurs lectures sont des sous-ensembles exacts des références municipales plus récentes. Ils sont donc `corroboration-only`; ils ne deviennent jamais l'état de référence servi.",
    "",
    "## Mesure des objets S3 effectivement servis",
    "",
    "| Collection | Polygones portant une densité finie, sourcée et jointe |",
    "|---|---:|",
  );
  for (const row of report.servedMeasurement.collections) {
    lines.push(`| ${row.slug} | ${row.finiteDensityPolygons} |`);
  }
  lines.push(
    `| **Total** | **${report.closure.servedDensityPolygons}** |`,
    "",
    `La comparaison des mesures S3 contrôle/finale trouve **${report.closure.newlyFoldedCollections ?? "inconnu"} collection** et **${report.closure.newlyDensePolygons ?? "inconnu"} polygone** supplémentaires.`,
    "Une paire `undefined`/`null` n'est jamais comptée comme densité ni comme changement.",
    "",
    "## Lectures non pliées",
    "",
  );
  for (const evidence of report.closure.unfoldedEvidence) {
    lines.push(`- \`${evidence.slug}\` / \`${evidence.zoneCode}\`: ${evidence.reason}.`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const coverageDir = resolve(option(argv, "coverage-dir") ?? "../work/coverage");
  const repoRoot = resolve(coverageDir, "../..");
  const output = resolve(
    option(argv, "output") ?? "../work/coverage/density-document-served-gap-20260728.json",
  );
  const names = readdirSync(coverageDir);
  const beforePaths = names
    .filter((name) => /^density-document-norm-ingest-.+\.json$/.test(name))
    .map((name) => resolve(coverageDir, name))
    .sort();
  const correctedPaths = names
    .filter((name) => /^density-document-final-classification-.+-20260728\.json$/.test(name))
    .map((name) => resolve(coverageDir, name))
    .sort();
  const controlPath = resolve(
    option(argv, "control-report")
      ?? "../work/coverage/density-document-control-lot-3-20260728.json",
  );
  const beforeReports = beforePaths.map(readReport);
  const controlReport = readReport(controlPath);
  const beforeDocumentCount = beforeReports.reduce(
    (sum, report) => sum + report.documents.length,
    0,
  );
  if (beforeDocumentCount !== 35) {
    throw new Error(`univers documentaire incomplet: ${beforeDocumentCount}, attendu 35`);
  }
  const controlIds = controlReport.reviewScope?.corroborationProfileIds ?? [];
  if (controlIds.length !== 3) throw new Error(`lot de contrôle attendu=3, obtenu=${controlIds.length}`);
  const control = lotResult(controlIds, [controlReport]);
  const writeControlSnapshotPath = option(argv, "write-control-snapshot");
  const controlSnapshotPath = resolve(
    writeControlSnapshotPath
      ?? option(argv, "control-snapshot")
      ?? "../work/coverage/density-document-control-lot-3-served-20260728.json",
  );
  if (writeControlSnapshotPath) {
    const collections = await measureCollections(beforeReports);
    const polygons = collections.reduce(
      (sum, collection) => sum + collection.sourceMatchedDensityPolygons,
      0,
    );
    if (
      collections.length !== EXPECTED_SERVED_COLLECTIONS
      || polygons !== EXPECTED_SERVED_DENSITY_POLYGONS
    ) {
      throw new Error(
        `mesure S3 du contrôle inattendue: ${collections.length}/${polygons}, `
        + `attendu ${EXPECTED_SERVED_COLLECTIONS}/${EXPECTED_SERVED_DENSITY_POLYGONS}`,
      );
    }
    const snapshot = {
      contract: "density-document-served-snapshot/v1",
      generatedAt: new Date().toISOString(),
      collections,
    };
    const temporarySnapshot = `${controlSnapshotPath}.tmp`;
    writeFileSync(temporarySnapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(temporarySnapshot, controlSnapshotPath);
    process.stdout.write(`${JSON.stringify({
      control: true,
      collections: collections.length,
      polygons,
      output: controlSnapshotPath,
    })}\n`);
    return;
  }

  const correctedReports = correctedPaths.map(readReport);
  const gap = buildDocumentGap(beforeReports, correctedReports);
  if (gap.before.documentCount !== 35 || gap.after.documentCount !== 35) {
    throw new Error(
      `univers documentaire incomplet: ${gap.before.documentCount}->${gap.after.documentCount}, attendu 35`,
    );
  }

  const remainingIds = gap.gap.map((row) => row.id).filter((id) => !controlIds.includes(id));
  const remaining = lotResult(remainingIds, correctedReports);
  const collections = await measureCollections(gap.reportsAfter);

  const servedSourceUrls = new Set(collections.flatMap((collection) => collection.sourceUrls));
  const directDocuments = gap.reportsAfter.flatMap((report) =>
    report.documents.filter((document) => document.disposition === "publishable")
  );
  const unreflected = directDocuments.filter((document) => !servedSourceUrls.has(document.source.url));
  if (unreflected.length > 0) {
    throw new Error(`références publiables non reflétées: ${unreflected.map((item) => item.id).join(",")}`);
  }
  const unfoldedEvidence = gap.reportsAfter.flatMap((report) =>
    report.documents
      .filter((document) => document.disposition === "publishable")
      .flatMap((document) => document.crossValidation.missingInSig.map((zoneCode) => ({
        slug: report.slug,
        zoneCode,
        reason: "code absent du SIG servi; aucun raccord inventé",
      })))
  ).filter((item, index, all) =>
    all.findIndex((candidate) =>
      candidate.slug === item.slug && candidate.zoneCode === item.zoneCode
    ) === index
  );

  const generatedAt = new Date().toISOString();
  const controlSnapshot = JSON.parse(readFileSync(controlSnapshotPath, "utf8")) as {
    contract?: unknown;
    generatedAt?: unknown;
    collections?: unknown;
  };
  if (
    controlSnapshot.contract !== "density-document-served-snapshot/v1"
    || typeof controlSnapshot.generatedAt !== "string"
    || !Array.isArray(controlSnapshot.collections)
  ) {
    throw new Error(`snapshot S3 du lot de contrôle invalide: ${controlSnapshotPath}`);
  }
  const controlSnapshotCollections = controlSnapshot.collections as Array<{
    slug?: unknown;
    sourceMatchedDensityPolygons?: unknown;
    normsObject?: { sha256?: unknown };
    zonageObject?: { sha256?: unknown };
  }>;
  for (const collection of controlSnapshotCollections) {
    if (
      typeof collection.slug !== "string"
      || typeof collection.sourceMatchedDensityPolygons !== "number"
      || !Number.isInteger(collection.sourceMatchedDensityPolygons)
      || collection.sourceMatchedDensityPolygons < 0
      || typeof collection.normsObject?.sha256 !== "string"
      || typeof collection.zonageObject?.sha256 !== "string"
    ) {
      throw new Error(`collection invalide dans le snapshot S3 du lot de contrôle`);
    }
  }
  const controlSnapshotPolygons = controlSnapshotCollections.reduce((sum, collection) =>
    sum + (collection.sourceMatchedDensityPolygons as number), 0);
  if (
    controlSnapshotCollections.length !== EXPECTED_SERVED_COLLECTIONS
    || controlSnapshotPolygons !== EXPECTED_SERVED_DENSITY_POLYGONS
  ) {
    throw new Error(
      `snapshot S3 du contrôle incomplet: `
      + `${controlSnapshotCollections.length}/${controlSnapshotPolygons}, `
      + `attendu ${EXPECTED_SERVED_COLLECTIONS}/${EXPECTED_SERVED_DENSITY_POLYGONS}`,
    );
  }
  const gapRows = gap.gap.map((row) => ({
    lot: controlIds.includes(row.id) ? "control-3" : "remaining-4",
    ...row,
  }));
  const servedDensityPolygons = collections.reduce(
    (sum, collection) => sum + collection.sourceMatchedDensityPolygons,
    0,
  );
  const controlBySlug = new Map(controlSnapshotCollections.map((collection) => [
    collection.slug as string,
    collection,
  ]));
  const finalBySlug = new Map(collections.map((collection) => [collection.slug, collection]));
  const measuredSlugs = [...new Set([...controlBySlug.keys(), ...finalBySlug.keys()])].sort();
  const servedChanges = measuredSlugs.flatMap((slug) => {
    const before = controlBySlug.get(slug);
    const after = finalBySlug.get(slug);
    const beforePolygons = before?.sourceMatchedDensityPolygons as number | undefined ?? 0;
    const afterPolygons = after?.sourceMatchedDensityPolygons ?? 0;
    const normsChanged = before?.normsObject?.sha256 !== after?.normsObject.sha256;
    const zonageChanged = before?.zonageObject?.sha256 !== after?.zonageObject.sha256;
    if (beforePolygons === afterPolygons && !normsChanged && !zonageChanged) return [];
    return [{
      slug,
      before: beforePolygons,
      after: afterPolygons,
      delta: afterPolygons - beforePolygons,
      normsChanged,
      zonageChanged,
    }];
  });
  const positiveServedChanges = servedChanges.filter((change) => change.delta > 0);
  const report = {
    contract: "density-document-served-gap/v2",
    generatedAt,
    inputs: {
      historicalReports: beforePaths.map((path) => reportInput(path, repoRoot)),
      correctedReports: correctedPaths.map((path) => reportInput(path, repoRoot)),
      controlReport: reportInput(controlPath, repoRoot),
      controlServedSnapshot: reportInput(controlSnapshotPath, repoRoot),
    },
    scope: gap.before,
    lots: {
      control: {
        ...control,
        servedMeasurement: {
          generatedAt: controlSnapshot.generatedAt,
          collections: controlSnapshotCollections.length,
          polygons: controlSnapshotPolygons,
        },
      },
      remaining,
    },
    gap: gapRows,
    servedMeasurement: {
      method: "effective S3 layout; finite density joined by exact zone/value/unit to a sourced served norm",
      collections,
    },
    closure: {
      ...gap.after,
      directlySelectedDocuments: directDocuments.length,
      servedCollections: collections.filter((collection) =>
        collection.sourceMatchedDensityPolygons > 0
      ).length,
      servedDensityPolygons,
      newlyFoldedCollections: positiveServedChanges.length,
      newlyDensePolygons: positiveServedChanges.reduce((sum, change) => sum + change.delta, 0),
      servedChanges,
      unfoldedEvidence,
    },
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, json);
  renameSync(temporary, output);
  const mdPath = output.replace(/\.json$/i, ".md");
  const mdTemporary = `${mdPath}.tmp`;
  writeFileSync(mdTemporary, markdown(report));
  renameSync(mdTemporary, mdPath);
  process.stdout.write(`${JSON.stringify({
    initialGap: report.scope.gapDocuments,
    remainingGap: report.closure.remainingGapDocuments,
    collections: report.closure.servedCollections,
    polygons: report.closure.servedDensityPolygons,
    output,
  })}\n`);
}

const invokedDirectly = !!process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
