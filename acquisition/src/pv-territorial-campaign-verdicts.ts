/** Freeze every CAS verdict for the 2026-07-29 territorial PV campaign. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const MAX = 5 * 1024 * 1024;
const CAMPAIGN = "20260729t222149z";
const PARTS = [6820, 6840, 6860, 6880, 6900, 6920, 6940, 6960, 6980, 7000, 7020, 7040];

const HTML: Readonly<Record<string, { verdict: string; evidence: string }>> = {
  "fossambault-sur-le-lac": { verdict: "HTML_PV_LANDING_PAGE_NOT_INDEXED", evidence: "Page de séance; lien PVSE24fevrier2026.pdf." },
  "la-malbaie": { verdict: "HTML_PV_RESOURCE_RECAPTURE_REQUIRED", evidence: "Viewer Google Drive titré pv_20250818.pdf, corps non extractible." },
  "lac-drolet": { verdict: "HTML_PV_LANDING_PAGE_NOT_INDEXED", evidence: "Page de téléchargement titrée PV 2026-02-02." },
  "lange-gardien--la-cote-de-beaupre": { verdict: "HTML_PV_LANDING_PAGE_NOT_INDEXED", evidence: "Page document; lien 2026-06-01-PROCES-VERBAL.pdf." },
  magog: { verdict: "HTML_PORTAL_NOT_PV", evidence: "Archive de multiples procès-verbaux, aucun document univoque." },
  maricourt: { verdict: "HTML_PV_LANDING_PAGE_NOT_INDEXED", evidence: "Page titrée Procès-verbal du 6 janvier; lien PDF distinct." },
  "riviere-beaudette": { verdict: "HTML_NON_PV_CALENDRIER_SEANCES", evidence: "Calendrier des séances ordinaires 2026." },
  "saint-adelme": { verdict: "HTML_PORTAL_NOT_PV", evidence: "Page Description municipale retournée à la place du PDF demandé." },
  "saint-adolphe-dhoward": { verdict: "HTML_PV_LANDING_PAGE_NOT_INDEXED", evidence: "Événement; lien vers 2026-04-16 PV entériné et signé.pdf." },
  "saint-alexandre-des-lacs": { verdict: "HTML_PV_RESOURCE_RECAPTURE_REQUIRED", evidence: "Google Docs titré 2025-12-15 EXTRA PROCÈS VERBAL, JavaScript requis." },
  "saint-apollinaire": { verdict: "HTML_NON_PV_VIDEO_SEANCE", evidence: "Vidéo de séance, pas un procès-verbal." },
};

function read(path: string): any {
  if (statSync(path).size > MAX) throw new Error(`${path}: > 5 MiB`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const output = resolve(ROOT, process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "");
  if (!output.startsWith(`${ROOT}/`) || existsSync(output)) throw new Error("--out=work/coverage/... inédit requis");
  const classificationNames = readdirSync(COVERAGE)
    .filter((name) => new RegExp(`^pv-capture-octets-classification-${CAMPAIGN}-lot-\\d+\\.json$`, "u").test(name))
    .sort();
  if (classificationNames.length !== 6) throw new Error(`six classifications attendues, reçu ${classificationNames.length}`);
  const lines = classificationNames.flatMap((name) => read(resolve(COVERAGE, name)).lines)
    .filter((line: any) => typeof line.storage_key === "string");
  if (lines.length !== 279 || new Set(lines.map((line: any) => line.storage_key)).size !== 279) throw new Error("population capturée CAS non réconciliée");
  const outcomes = new Map<string, string>();
  const dedupeSkips: string[] = [];
  for (const part of PARTS) {
    const name = `pv-graphify-semantic-real-universe-20260729-batch-01-part-${part}.json`;
    const report = read(resolve(COVERAGE, name));
    for (const document of report.documents ?? []) outcomes.set(document.storage_key, document.outcome);
    dedupeSkips.push(...(report.dedupe?.skipped_duplicate_cas_keys ?? []));
  }
  const verdicts = lines.map((line: any) => {
    if (line.classification === "PV_LISIBLE_PROPRIETAIRE_CONFIRME") {
      const verdict = outcomes.get(line.storage_key);
      if (!verdict) throw new Error(`PV confirmé sans verdict Graphify: ${line.storage_key}`);
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, verdict };
    }
    if (line.classification === "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME") {
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, verdict: "OWNER_NOT_CONFIRMED" };
    }
    if (line.classification === "PDF_SANS_COUCHE_TEXTE") {
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, verdict: "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED" };
    }
    if (line.classification === "DOCUMENT_LISIBLE_NON_PV") {
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, verdict: "DOCUMENT_LISIBLE_NON_PV" };
    }
    if (line.classification === "PAGE_HTML") {
      const html = HTML[line.slug];
      if (!html) throw new Error(`HTML sans décision inspectée: ${line.slug}`);
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, ...html };
    }
    if (line.classification === "AUTRE") {
      return { slug: line.slug, storage_key: line.storage_key, classification: line.classification, verdict: "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED" };
    }
    throw new Error(`classe hors politique: ${line.classification}`);
  }).sort((left: any, right: any) => left.storage_key.localeCompare(right.storage_key));
  const counts: Record<string, number> = {};
  for (const verdict of verdicts) counts[verdict.verdict] = (counts[verdict.verdict] ?? 0) + 1;
  const report = { contract: "pv-territorial-campaign-verdicts/v1", campaign: CAMPAIGN, classification_reports: classificationNames.map((name) => `work/coverage/${name}`), graphify_reports: PARTS, dedupe: { historical_snapshot: "work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json", collisions_prevented: dedupeSkips.length, skipped_duplicate_cas_keys: dedupeSkips }, summary: counts, verdicts };
  mkdirSync(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temp, output);
  console.log(JSON.stringify({ report: output.slice(ROOT.length + 1), summary: counts, collisions_prevented: dedupeSkips.length }));
}

main();
