/**
 * Final nominative report for the exact 56 acquired-without-density slugs.
 * Refuses to render while any slug is still pending_capture.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  documentedNoDocumentReason,
  foundDensityDocuments,
  originalDocumentHost,
  type FinalCandidate,
} from "./lib/density-document-final-report.js";
import { putBytes, s3Client } from "./lib/s3.js";

interface DiscoveryRow {
  slug: string;
  name: string;
  status: string;
  reason: string;
  blockers: string[];
  candidates: FinalCandidate[];
}

interface DiscoveryReport {
  baselineKey: string;
  baselineSha256: string;
  scopeCount: number;
  completedCount: number;
  rows: DiscoveryRow[];
}

const MANUAL_EXCLUSIONS = new Map<string, string>([
  [
    "https://www.villemontlaurier.qc.ca/storage/app/media/Zones%20CP.pdf",
    "faux positif de mise en page: les nombres alignés après « Logement / Hectare maximum » sont la date 24-02-2012 et le règlement 134-13; aucune valeur de densité n’est imprimée",
  ],
  [
    "https://vdmt.ca/storage/app/media/informations-municipales/administration-et-finances/projets-reglements/refonte-urbanisme/Grilles-de-zonage_VPPR_V3.pdf",
    "document situé sous /projets-reglements/: projet exclu, aucune force légale",
  ],
]);

/** Owner hosts reviewed against the MAMH municipal identity, not filename alone. */
const VERIFIED_OWNER_HOSTS: Record<string, readonly string[]> = {
  champlain: ["municipalite.champlain.qc.ca"],
  chesterville: ["chesterville.net"],
  "clermont--charlevoix-est": ["ville.clermont.qc.ca"],
  drummondville: ["drummondville.ca"],
  huberdeau: ["huberdeau.ca"],
  "lac-des-ecorces": ["lacdesecorces.ca"],
  "mont-laurier": ["villemontlaurier.qc.ca"],
  "mont-tremblant": ["vdmt.ca"],
  "saint-dominique": ["st-dominique.ca"],
  "saint-jerome": ["vsj.ca"],
  "stoneham-et-tewkesbury": ["villestoneham.com"],
  varennes: ["ville.varennes.qc.ca"],
};

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function atomic(path: string, contents: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function markdown(report: ReturnType<typeof build>): string {
  const lines = [
    "# Recherche d’un autre document portant une densité — rapport final",
    "",
    `Sondées: ${report.probedCount}/56; documents portant une densité: ${report.documentCount}; collections pliées: ${report.foldedCollectionCount}.`,
    "",
    "| Slug | Résultat |",
    "|---|---|",
  ];
  for (const row of report.rows) {
    const result = row.documents.length > 0
      ? row.documents.map((document) => `${document.url} — capture ${document.captureDate}`).join("<br>")
      : row.reason;
    lines.push(`| ${row.slug} | ${result.replace(/\|/g, "\\|")} |`);
  }
  lines.push(
    "",
    "> Aucun effet densifiant n’est conclu par ce rapport. Sans valeurs avant/après verbatim et datées, l’effet reste inconnu.",
    "",
  );
  return lines.join("\n");
}

function build(discovery: DiscoveryReport, foldedReports: unknown[]) {
  if (
    discovery.scopeCount !== 56
    || discovery.completedCount !== 56
    || discovery.rows.length !== 56
    || discovery.rows.some((row) => row.status === "pending_capture")
  ) {
    throw new Error("refus: les 56 slugs ne sont pas tous terminés");
  }
  const rows = discovery.rows.map((row) => {
    const documents = foundDensityDocuments(row.candidates, MANUAL_EXCLUSIONS);
    const verifiedHosts = VERIFIED_OWNER_HOSTS[row.slug] ?? [];
    for (const document of documents) {
      const host = originalDocumentHost(document.url);
      if (!verifiedHosts.includes(host)) {
        throw new Error(`${row.slug}: propriétaire non vérifié pour ${document.url}`);
      }
    }
    return {
      slug: row.slug,
      name: row.name,
      outcome: documents.length > 0
        ? "document_portant_densite_trouve"
        : row.status === "capture_or_native_parse_blocked"
          ? "recherche_inconclusive_documentee"
          : "aucun_document_portant_densite_trouve",
      documents,
      reason: documents.length > 0
        ? `${documents.length} document(s) avec valeur de densité imprimée`
        : row.status === "candidate_review_required"
          ? "passage lexical de densité localisé, mais aucune valeur numérique publiable après revue native"
          : documentedNoDocumentReason(row.status, row.reason, row.blockers),
      excludedCandidates: row.candidates
        .filter((candidate) => MANUAL_EXCLUSIONS.has(candidate.url))
        .map((candidate) => ({
          url: candidate.url,
          reason: MANUAL_EXCLUSIONS.get(candidate.url),
        })),
    };
  });
  const folded = foldedReports.filter((value): value is {
    slug: string;
    deposited: boolean;
    source: { url: string };
    crossValidation: { matchedNorms: number };
  } => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return item["deposited"] === true
      && typeof item["slug"] === "string"
      && !!item["source"]
      && !!item["crossValidation"];
  });
  if (folded.some((item) => item.crossValidation.matchedNorms < 1)) {
    throw new Error("rapport de pliage sans norme recoupée");
  }
  const urls = rows.flatMap((row) => row.documents.map((document) => document.url));
  return {
    contract: "density-document-final-report/v1" as const,
    generatedAt: new Date().toISOString(),
    baselineKey: discovery.baselineKey,
    baselineSha256: discovery.baselineSha256,
    scopeCount: 56,
    probedCount: discovery.completedCount,
    documentCount: urls.length,
    documentUrls: urls,
    foldedCollectionCount: new Set(folded.map((item) => item.slug)).size,
    foldedCollections: folded.map((item) => ({
      slug: item.slug,
      sourceUrl: item.source.url,
      matchedNorms: item.crossValidation.matchedNorms,
    })),
    effect: "inconnu" as const,
    manualExclusions: [...MANUAL_EXCLUSIONS].map(([url, reason]) => ({ url, reason })),
    rows,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const discoveryPath = option(argv, "discovery")
    ?? "../work/coverage/density-document-discovery-report-20260728.json";
  const output = option(argv, "output")
    ?? "../work/coverage/density-document-final-report-20260728.json";
  const foldedPaths = argv.flatMap((value, index) =>
    value === "--folded-report" && argv[index + 1] ? [argv[index + 1]!] : []);
  if (foldedPaths.length === 0) throw new Error("au moins un --folded-report est requis");
  const discovery = JSON.parse(readFileSync(discoveryPath, "utf8")) as DiscoveryReport;
  const folded = foldedPaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as unknown);
  const report = build(discovery, folded);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = markdown(report);
  atomic(output, json);
  atomic(output.replace(/\.json$/i, ".md"), md);
  if (argv.includes("--deposit")) {
    const s3 = s3Client();
    await putBytes(s3, "reports/normes-density-document/final-20260728.json", json, "application/json");
    await putBytes(s3, "reports/normes-density-document/final-20260728.md", md, "text/markdown");
  }
  process.stdout.write(`${JSON.stringify({
    probed: report.probedCount,
    documents: report.documentCount,
    folded: report.foldedCollectionCount,
    output,
  })}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
