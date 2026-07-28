/**
 * Verify and additively deposit density norms from legally reviewed documents
 * discovered by the closed 56-city campaign.
 *
 * Reads only the 35 exact captured CAS documents named by the committed report.
 * Native parsers and merge rules live in tested libraries. The default is a
 * report-only dry run; --deposit additionally requires --legal-reviewed,
 * creates a one-time backup, writes the parquet, verifies its round trip, and
 * stores the ingest report on object storage.
 */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  parseSaintDominiqueDensityDocument,
  parseStonehamDensityDocument,
} from "../../packages/qc-sources/src/sources/density-document-norm-parser.js";
import {
  parseChamplainDensityDocument,
  parseChestervilleDensityDocument,
  parseDrummondvilleDensityDocument,
  parseHuberdeauDensityDocument,
  parseLacDesEcorcesDensityDocument,
  parseMontLaurierZonesHDensityDocument,
  type DensityDocumentParseResult,
} from "../../packages/geo/src/zonage/densityDocument.js";
import {
  mergeDensityNormRows,
  type DensityNormPatch,
} from "./lib/density-document-deposit.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  copyObject,
  exists,
  getBytes,
  putBytes,
  s3Client,
} from "./lib/s3.js";
import {
  canonZone,
  normsKey,
  resolveGridKey,
  sigZoneCodesFromGeojsonRaw,
  writeNormsParquet,
} from "./lib/zonage-norms.js";

interface Candidate {
  url?: unknown;
  retrievedAt?: unknown;
  sha256?: unknown;
  storageKey?: unknown;
  disposition?: unknown;
  normValueHits?: unknown[];
}

interface DiscoveryRow {
  slug?: unknown;
  candidates?: Candidate[];
}

interface DiscoveryReport {
  scopeCount?: unknown;
  rows?: DiscoveryRow[];
}

interface Profile {
  id: string;
  slug: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceHost: string;
  owner: string;
  ownerEvidence: string;
  legalDate: string | null;
  legalDateEvidence: string;
  reglement: string;
  numericSigBridge?: boolean;
  parse: (text: string) => DensityDocumentParseResult;
}

interface DocumentReview {
  id: string;
  disposition:
    | "publishable"
    | "excluded-undated"
    | "excluded-project"
    | "refused-unanchored"
    | "refused-no-publishable-density"
    | "refused-no-sig-overlap";
  source: {
    url: string;
    sha256: string;
    storageKey: string;
    retrievedAt: string;
    transportHost: string;
    owner: string;
    ownerEvidence: string;
    reglement: string;
    legalDate: string | null;
    legalDateEvidence: string;
  };
  parser: {
    family: string;
    documentAnchored: boolean;
    projectExcluded: boolean;
    extracted: number;
    refusals: DensityDocumentParseResult["refusals"];
  };
  crossValidation: {
    matchedNorms: number;
    missingInSig: string[];
  };
  norms: Array<{
    zoneCode: string;
    value: number;
    unit: string;
    raw: string;
    proof: string;
    page: number;
  }>;
}

const METHOD = "native-text/density-document-verbatim";
const PROFILES: readonly Profile[] = [
  {
    id: "saint-dominique-2017-324",
    slug: "saint-dominique",
    sourceUrl: "https://www.st-dominique.ca/fichiersUpload/fichiers/20260601132149-2017-324-annexe-b-grilles-des-usages.pdf",
    sourceSha256: "sha256:d3114a0c03c013b9dd39382bbdc97b20cfad72fc62e952d5398670b634ac5f71",
    sourceHost: "www.st-dominique.ca",
    owner: "Municipalité de Saint-Dominique",
    ownerEvidence: "Ancre native « Municipalité de Saint-Dominique »",
    legalDate: "2026-06-01",
    legalDateEvidence: "URL municipale verbatim: /20260601132149-2017-324-annexe-b-grilles-des-usages.pdf",
    reglement: "ZONAGE 2017-324 - ANNEXE B",
    parse: parseSaintDominiqueDensityDocument,
  },
  {
    id: "stoneham-09-591-2026-07",
    slug: "stoneham-et-tewkesbury",
    sourceUrl: "https://www.villestoneham.com/storage/app/media/ma-municipalite/affaires-municipales/reglements-municipaux/urbanisme/09-591_grille-des-specifications-codif-adm-maj-juillet-2026.pdf",
    sourceSha256: "sha256:81e2d8ea8b028451aaeef128242e16b883287bba2f5ee757bfb779681de4ab84",
    sourceHost: "www.villestoneham.com",
    owner: "Municipalité des cantons unis de Stoneham-et-Tewkesbury",
    ownerEvidence: "Document 09-591 sous le répertoire urbanisme municipal officiel",
    legalDate: "2026-07",
    legalDateEvidence: "URL municipale verbatim: 09-591_grille-des-specifications-codif-adm-maj-juillet-2026.pdf",
    reglement: "Règlement de zonage numéro 09-591 — Annexe 2, version intégrée",
    parse: parseStonehamDensityDocument,
  },
  {
    id: "mont-laurier-zones-h",
    slug: "mont-laurier",
    sourceUrl: "https://www.villemontlaurier.qc.ca/storage/app/media/Zones%20H.pdf",
    sourceSha256: "sha256:fcf59bb4466fe4c0fa78693ba6cbb7332a37a6fc654470df87a4750708ab8883",
    sourceHost: "www.villemontlaurier.qc.ca",
    owner: "Ville de Mont-Laurier",
    ownerEvidence: "Ancre native « VILLE DE MONT-LAURIER »",
    legalDate: "2025-06-18",
    legalDateEvidence: "Document municipal verbatim: « 18-06-2025 134-89 »",
    reglement: "Règlement de zonage numéro 134 — Zones H",
    parse: parseMontLaurierZonesHDensityDocument,
  },
  // Lot 1: the newest complete live codification is first, so identical
  // corroborating readings retain its source provenance.
  {
    id: "champlain-file-18281",
    slug: "champlain",
    sourceUrl: "https://www.municipalite.champlain.qc.ca/file-18281",
    sourceSha256: "sha256:cfee2f9d15a72db21b5fd2ffca7528e2747588368227b740223f7225b15cab16",
    sourceHost: "www.municipalite.champlain.qc.ca",
    owner: "Municipalité de Champlain",
    ownerEvidence: "Ancre native « MUNICIPALITÉ DE CHAMPLAIN — RÈGLEMENT DE ZONAGE »",
    legalDate: "2020-05-04",
    legalDateEvidence: "Table de codification verbatim: « Modification 04-05-20 — Règlement 2020-03 »",
    reglement: "Règlement de zonage 2009-03, codifié au règlement 2020-03",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-file-18292",
    slug: "champlain",
    sourceUrl: "https://www.municipalite.champlain.qc.ca/file-18292",
    sourceSha256: "sha256:8b32de70e9a2032635b021885285a1e620b3c9a7db56154d41a15eba7b59a50e",
    sourceHost: "www.municipalite.champlain.qc.ca",
    owner: "Municipalité de Champlain",
    ownerEvidence: "Ancre native « MUNICIPALITÉ DE CHAMPLAIN — RÈGLEMENT DE ZONAGE »",
    legalDate: "2018-08-06",
    legalDateEvidence: "Table de codification verbatim: « Modification 06-08-18 — Règlement 2018-03 »",
    reglement: "Règlement de zonage 2009-03, codifié au règlement 2018-03",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-wayback-original-2009",
    slug: "champlain",
    sourceUrl: "https://web.archive.org/web/20240112104603id_/http://www.municipalite.champlain.qc.ca/Document/CH_R%C3%A8glement%20Zonage.pdf",
    sourceSha256: "sha256:8c5960493a3266bc6fcc56981d0e352f025f62fe172ddc25f89b7e995a7b531f",
    sourceHost: "web.archive.org",
    owner: "Municipalité de Champlain",
    ownerEvidence: "URL municipale archivée et ancre native « MUNICIPALITÉ DE CHAMPLAIN »",
    legalDate: "2009-04-06",
    legalDateEvidence: "Page titre verbatim: « Adopté le 6 avril 2009 »",
    reglement: "Règlement de zonage 2009-03, original",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-wayback-modification-2014",
    slug: "champlain",
    sourceUrl: "https://web.archive.org/web/20240112104031id_/http://www.municipalite.champlain.qc.ca/Document/modification%20r%C3%A8glement%20de%20zonage%20du%2019%20juin%202014.pdf",
    sourceSha256: "sha256:3a7cbcd93bf8fa2ce1efde008c112a164e97a0b567afcf2ff2068da97c67b41a",
    sourceHost: "web.archive.org",
    owner: "Municipalité de Champlain",
    ownerEvidence: "URL municipale archivée et pied de grille natif « Municipalité de Champlain »",
    legalDate: "2014-06-19",
    legalDateEvidence: "Nom de document municipal verbatim: « modification règlement de zonage du 19 juin 2014 »",
    reglement: "Règlement 2014-04 modifiant le règlement de zonage 2009-03",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-wayback-reglement-2017-02",
    slug: "champlain",
    sourceUrl: "https://web.archive.org/web/20240112103854id_/http://www.municipalite.champlain.qc.ca/Document/R%C3%88GLEMENT%202017-02%20MODIFIANT%20LE%20R%C3%88GLEMENT%20DE%20ZONAGE%202009-03.pdf",
    sourceSha256: "sha256:dcae3f46255560df3b301f385d8937cfd0b0bcb2eb5fc931c242e27f3dff1186",
    sourceHost: "web.archive.org",
    owner: "Municipalité de Champlain",
    ownerEvidence: "URL municipale archivée et ancre native « MUNICIPALITÉ DE CHAMPLAIN »",
    legalDate: "2017-05-01",
    legalDateEvidence: "Table de codification verbatim: « Modification 01-05-17 — Règlement 2017-02 »",
    reglement: "Règlement 2017-02 modifiant le règlement de zonage 2009-03",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-file-18291",
    slug: "champlain",
    sourceUrl: "https://www.municipalite.champlain.qc.ca/file-18291",
    sourceSha256: "sha256:a70ede51e8af2d00d98900f606a8182b36de9435797b1941dabfc32ed0e6e82f",
    sourceHost: "www.municipalite.champlain.qc.ca",
    owner: "Municipalité de Champlain",
    ownerEvidence: "Ancre native « MUNICIPALITÉ DE CHAMPLAIN — RÈGLEMENT DE ZONAGE »",
    legalDate: "2018-07-09",
    legalDateEvidence: "Table de codification verbatim: « Modification 09-07-18 — Règlement 2018-05 »",
    reglement: "Règlement de zonage 2009-03, codifié au règlement 2018-05",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "champlain-file-18327-undated",
    slug: "champlain",
    sourceUrl: "https://www.municipalite.champlain.qc.ca/file-18327",
    sourceSha256: "sha256:727ad4abf146b895f86e03a1188298d08d242b5c84fe7deb0608bce585d9d83b",
    sourceHost: "www.municipalite.champlain.qc.ca",
    owner: "Municipalité de Champlain",
    ownerEvidence: "Pied de grille natif « Municipalité de Champlain — Règlement de zonage — Annexe C »",
    legalDate: null,
    legalDateEvidence: "Aucune date légale verbatim dans ce document isolé",
    reglement: "Règlement de zonage — Annexe C, feuille zone 120",
    numericSigBridge: true,
    parse: parseChamplainDensityDocument,
  },
  {
    id: "lac-des-ecorces-grilles-r3",
    slug: "lac-des-ecorces",
    sourceUrl: "https://lacdesecorces.ca/wp-content/uploads/2024/05/grilles_regroupe_r3.pdf",
    sourceSha256: "sha256:9fd9efd1c9f54a3cc316c71114516a2fe23beb55283e84f28bb3ba591083f9d3",
    sourceHost: "lacdesecorces.ca",
    owner: "Municipalité de Lac-des-Écorces",
    ownerEvidence: "Ancre native répétée « MUNICIPALITÉ DE LAC-DES-ÉCORCES »",
    legalDate: null,
    legalDateEvidence: "Grille sans date globale; « 2016, R-195-2016, a.4.1 » est une note d’amendement locale, pas une date de document",
    reglement: "Grilles des spécifications, règlement de zonage 40-2004 modifié",
    parse: parseLacDesEcorcesDensityDocument,
  },
  {
    id: "chesterville-2024-grilles-agricoles",
    slug: "chesterville",
    sourceUrl: "https://www.chesterville.net/fichiersUpload/fichiers/20240815102439-2024-grilles-agricoles.pdf",
    sourceSha256: "sha256:c258a618e8cdd68d124455ef6d9b5e4e4a44881d4663de0fc5a44802c8a8d0bc",
    sourceHost: "www.chesterville.net",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "Ancre native « Municipalité de Chesterville »",
    legalDate: "2024-08-15",
    legalDateEvidence: "URL municipale horodatée verbatim: /20240815102439-2024-grilles-agricoles.pdf",
    reglement: "Règlement de zonage 145 N.S. — grilles agricoles 2024",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "chesterville-2024-grilles-residentielles-autres",
    slug: "chesterville",
    sourceUrl: "https://www.chesterville.net/fichiersUpload/fichiers/20241010160535-2024-grilles-residentielles-autres.pdf",
    sourceSha256: "sha256:dc48d65a23395961a51624d719675d2617bcd5578a4a5feee117d2e967c15d79",
    sourceHost: "www.chesterville.net",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "Ancre native « Municipalité de Chesterville »",
    legalDate: "2024-10-10",
    legalDateEvidence: "URL municipale horodatée verbatim: /20241010160535-2024-grilles-residentielles-autres.pdf",
    reglement: "Règlement de zonage 145 N.S. — grilles résidentielles et autres 2024",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "chesterville-reglement-187-amendement-partiel",
    slug: "chesterville",
    sourceUrl: "https://www.chesterville.net/fichiersUpload/fichiers/20211124151414-187-n-s-modif-reglement-zonage-essence-13141.pdf",
    sourceSha256: "sha256:f9eb1deac6d876a59e2e6c73f45ba417935dc23a5b9fa2ce5f0f5c1041687d04",
    sourceHost: "www.chesterville.net",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "Ancre native « MRC D'ARTHABASKA — MUNICIPALITÉ DE CHESTERVILLE »",
    legalDate: "2015-08-10",
    legalDateEvidence: "En-tête verbatim: « séance ordinaire ... ce 10 août 2015 »",
    reglement: "Règlement 187 amendant le règlement de zonage 145",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "chesterville-agricole-codification-2017",
    slug: "chesterville",
    sourceUrl: "https://www.chesterville.net/fichiersUpload/fichiers/20220217141337-annexe-b-grilles-agricole-codification-2017.pdf",
    sourceSha256: "sha256:4477846cb143eddecb204b3fbbb64dc3d39f933e22def83f0a6a2de9dee407bc",
    sourceHost: "www.chesterville.net",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "Ancre native « Municipalité de Chesterville »",
    legalDate: "2017",
    legalDateEvidence: "Nom municipal verbatim: « annexe-b-grilles-agricole-codification-2017.pdf »",
    reglement: "Règlement de zonage 145 N.S. — annexe B agricole, codification 2017",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "chesterville-residentiel-autres-2017",
    slug: "chesterville",
    sourceUrl: "https://www.chesterville.net/fichiersUpload/fichiers/20220217141450-annexe-b-grilles-residentiel-autres-2017.pdf",
    sourceSha256: "sha256:72e0c678f078d24da40d8269427891f228620d1a696a2801989fdbb5104ae73d",
    sourceHost: "www.chesterville.net",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "Ancre native « Municipalité de Chesterville »",
    legalDate: "2017",
    legalDateEvidence: "Nom municipal verbatim: « annexe-b-grilles-residentiel-autres-2017.pdf »",
    reglement: "Règlement de zonage 145 N.S. — annexe B résidentiel et autres 2017",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "chesterville-wayback-grilles-194-undated",
    slug: "chesterville",
    sourceUrl: "https://web.archive.org/web/20211201141006id_/https://www.chesterville.net/manager/Utilitaires/kcfinder/upload/files/194%20N.S.%20grilles%20de%20zonage.pdf",
    sourceSha256: "sha256:7bf81cffeedf9b6598baa2278764a137de570d3ce098d117852d60649a99527d",
    sourceHost: "web.archive.org",
    owner: "Municipalité de Chesterville",
    ownerEvidence: "URL municipale archivée et ancre native « Municipalité de Chesterville »",
    legalDate: null,
    legalDateEvidence: "Aucune date globale verbatim sur ces quatre feuilles de zone",
    reglement: "Grilles de zonage 194 N.S. archivées",
    parse: parseChestervilleDensityDocument,
  },
  {
    id: "drummondville-4300-chapitre-13",
    slug: "drummondville",
    sourceUrl: "https://www.drummondville.ca/wp-content/uploads/2026/07/4300-ZONAGE-Chap-13_Dispositions-particulieres.pdf",
    sourceSha256: "sha256:96a530117f3a69249bbddb7fc41d3bea24a4873111ac385b6a1be255586e9324",
    sourceHost: "www.drummondville.ca",
    owner: "Ville de Drummondville",
    ownerEvidence: "Ancre native « Ville de Drummondville — Règlement de zonage No 4300 »",
    legalDate: "2026-05-21",
    legalDateEvidence: "En-tête verbatim: « modifications ... jusqu'au 21 mai 2026 inclusivement »",
    reglement: "Règlement de zonage 4300 — chapitre 13, version administrative",
    parse: parseDrummondvilleDensityDocument,
  },
  {
    id: "huberdeau-199-02-aout-2025",
    slug: "huberdeau",
    sourceUrl: "https://huberdeau.ca/wp-content/uploads/2025/08/Reglement-199-02-zonage-a-jour-aout-2025.pdf",
    sourceSha256: "sha256:80f2d35f6ef57ce2d879f5c894cff75c85981668c7e58da80912245485574582",
    sourceHost: "huberdeau.ca",
    owner: "Municipalité d’Huberdeau",
    ownerEvidence: "Ancre native « MRC DES LAURENTIDES — MUNICIPALITÉ D’HUBERDEAU »",
    legalDate: "2025-08",
    legalDateEvidence: "URL municipale verbatim: /2025/08/Reglement-199-02-zonage-a-jour-aout-2025.pdf",
    reglement: "Règlement de zonage 199-02 à jour août 2025",
    parse: parseHuberdeauDensityDocument,
  },
];

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checkpoint(path: string, report: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, path);
}

function singleNumber(code: string): string | null {
  const matches = code.match(/\d+/g) ?? [];
  if (matches.length !== 1) return null;
  return String(Number(matches[0]));
}

function sigNumberIndex(sigCodes: Iterable<string>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const code of sigCodes) {
    const number = singleNumber(code);
    if (number === null) continue;
    const previous = out.get(number);
    out.set(number, previous === undefined || previous === code ? code : null);
  }
  return out;
}

function selectConsistentPatches(
  patches: readonly DensityNormPatch[],
): { selected: DensityNormPatch[]; conflicts: string[] } {
  const byZone = new Map<string, DensityNormPatch>();
  const conflicts = new Set<string>();
  for (const patch of patches) {
    const key = canonZone(patch.zoneCode);
    const previous = byZone.get(key);
    if (
      previous
      && (previous.value !== patch.value || previous.unit !== patch.unit)
    ) {
      conflicts.add(patch.zoneCode);
      continue;
    }
    if (!previous) byZone.set(key, patch);
  }
  for (const conflict of conflicts) byZone.delete(canonZone(conflict));
  return { selected: [...byZone.values()], conflicts: [...conflicts].sort() };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = option(argv, "slug");
  const knownSlugs = [...new Set(PROFILES.map((profile) => profile.slug))].sort();
  const profiles = PROFILES.filter((profile) => profile.slug === slug);
  const reportPath = option(argv, "report")
    ?? "../work/coverage/density-document-discovery-report-20260728.json";
  const output = option(argv, "output")
    ?? `../work/coverage/density-document-norm-ingest-${slug ?? "missing"}.json`;
  const deposit = argv.includes("--deposit");
  const legalReviewed = argv.includes("--legal-reviewed");
  if (!slug || profiles.length === 0) {
    throw new Error(`--slug requis parmi: ${knownSlugs.join(", ")}`);
  }
  if (deposit && !legalReviewed) throw new Error("--deposit exige --legal-reviewed");

  const discovery = JSON.parse(readFileSync(reportPath, "utf8")) as DiscoveryReport;
  if (discovery.scopeCount !== 56 || !Array.isArray(discovery.rows)) {
    throw new Error("rapport de découverte hors périmètre ou incomplet");
  }
  const row = discovery.rows.find((item) => item.slug === slug);
  if (!row || !Array.isArray(row.candidates)) {
    throw new Error(`${slug}: ligne de découverte absente`);
  }

  const s3 = s3Client();
  const gridResolved = await resolveGridKey(s3, slug);
  if (!gridResolved) throw new Error(`${slug}: grille SIG absente`);
  const sigRaw = sigZoneCodesFromGeojsonRaw(
    (await getBytes(s3, gridResolved)).toString("utf8"),
  );
  const sigByCanon = new Map<string, string>();
  for (const code of sigRaw) {
    const key = canonZone(code);
    const previous = sigByCanon.get(key);
    if (previous !== undefined && previous !== code) {
      throw new Error(`${slug}: collision canonique SIG ${previous} <> ${code}`);
    }
    sigByCanon.set(key, code);
  }
  const sigByNumber = sigNumberIndex(sigRaw);
  const documents: DocumentReview[] = [];
  const allPatches: DensityNormPatch[] = [];

  for (const profile of profiles) {
    const candidate = row.candidates.find((item) => item.url === profile.sourceUrl);
    if (
      !candidate
      || candidate.sha256 !== profile.sourceSha256
      || typeof candidate.storageKey !== "string"
      || typeof candidate.retrievedAt !== "string"
      || candidate.disposition !== "candidate_review_required"
      || !Array.isArray(candidate.normValueHits)
      || candidate.normValueHits.length === 0
    ) {
      throw new Error(`${profile.id}: candidat exact, capturé et porteur de valeurs absent`);
    }
    if (new URL(profile.sourceUrl).hostname !== profile.sourceHost) {
      throw new Error(`${profile.id}: transport de source inattendu`);
    }

    const bytes = await getBytes(s3, candidate.storageKey);
    if (digest(bytes) !== profile.sourceSha256) {
      throw new Error(`${profile.id}: CAS SHA mismatch`);
    }
    const native = extractNativeDocumentText(bytes);
    if (native.text === null) {
      throw new Error(`${profile.id}: parseur natif bloqué: ${String(native.blocker)}`);
    }
    const parsed = profile.parse(native.text);
    const missingInSig: string[] = [];
    const documentPatches: DensityNormPatch[] = [];
    if (parsed.documentAnchored && !parsed.projectExcluded && profile.legalDate !== null) {
      const snapshot = candidate.retrievedAt.slice(0, 10);
      for (const norm of parsed.norms) {
        let sigCode = sigByCanon.get(canonZone(norm.zoneCode));
        if (!sigCode && profile.numericSigBridge && /^\d+$/.test(norm.zoneCode)) {
          sigCode = sigByNumber.get(String(Number(norm.zoneCode))) ?? undefined;
        }
        if (!sigCode) {
          missingInSig.push(norm.zoneCode);
          continue;
        }
        documentPatches.push({
          ...norm,
          zoneCode: sigCode,
          sourceUrl: profile.sourceUrl,
          method: METHOD,
          snapshot,
          legalDate: profile.legalDate,
          legalDateEvidence: profile.legalDateEvidence,
        });
      }
    }
    allPatches.push(...documentPatches);

    let disposition: DocumentReview["disposition"];
    if (parsed.projectExcluded) disposition = "excluded-project";
    else if (!parsed.documentAnchored) disposition = "refused-unanchored";
    else if (profile.legalDate === null) disposition = "excluded-undated";
    else if (parsed.norms.length === 0) disposition = "refused-no-publishable-density";
    else if (documentPatches.length === 0) disposition = "refused-no-sig-overlap";
    else disposition = "publishable";
    documents.push({
      id: profile.id,
      disposition,
      source: {
        url: profile.sourceUrl,
        sha256: profile.sourceSha256,
        storageKey: candidate.storageKey,
        retrievedAt: candidate.retrievedAt,
        transportHost: profile.sourceHost,
        owner: profile.owner,
        ownerEvidence: profile.ownerEvidence,
        reglement: profile.reglement,
        legalDate: profile.legalDate,
        legalDateEvidence: profile.legalDateEvidence,
      },
      parser: {
        family: parsed.family,
        documentAnchored: parsed.documentAnchored,
        projectExcluded: parsed.projectExcluded,
        extracted: parsed.norms.length,
        refusals: parsed.refusals,
      },
      crossValidation: {
        matchedNorms: documentPatches.length,
        missingInSig,
      },
      norms: documentPatches.map((patch) => ({
        zoneCode: patch.zoneCode,
        value: patch.value,
        unit: patch.unit,
        raw: patch.raw,
        proof: patch.proof,
        page: patch.page,
      })),
    });
    checkpoint(output, {
      contract: "density-document-norm-ingest/v2-progress",
      generatedAt: new Date().toISOString(),
      slug,
      completedDocuments: documents.length,
      totalDocuments: profiles.length,
      documents,
    });
  }

  const consistent = selectConsistentPatches(allPatches);
  if (consistent.selected.length === 0) {
    throw new Error(`${slug}: aucune norme datée, cohérente et raccordée au SIG`);
  }
  const key = normsKey(slug);
  const existingRows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  const merged = mergeDensityNormRows(existingRows, consistent.selected);
  const ingestReport = {
    contract: "density-document-norm-ingest/v2",
    generatedAt: new Date().toISOString(),
    slug,
    deposited: false,
    documents,
    crossValidation: {
      sigKey: gridResolved,
      sigCodes: sigRaw.size,
      matchedNorms: consistent.selected.length,
      conflictingZones: consistent.conflicts,
    },
    merge: {
      existingRows: existingRows.length,
      outputRows: merged.rows.length,
      inserted: merged.inserted,
      enriched: merged.enriched,
      unchanged: merged.unchanged,
    },
    norms: consistent.selected.map((patch) => ({
      zoneCode: patch.zoneCode,
      value: patch.value,
      unit: patch.unit,
      raw: patch.raw,
      proof: patch.proof,
      page: patch.page,
      sourceUrl: patch.sourceUrl,
      legalDate: patch.legalDate,
      legalDateEvidence: patch.legalDateEvidence,
    })),
    output: {
      key,
      backupKey: `${key}.pre-density-document-20260728`,
    },
  };

  if (deposit) {
    const backupKey = ingestReport.output.backupKey;
    if (!(await exists(s3, backupKey))) await copyObject(s3, key, backupKey);
    const parquet = await writeNormsParquet(merged.rows);
    await putBytes(s3, key, parquet, "application/octet-stream");
    const check = await readParquetRowsFromBuffer(await getBytes(s3, key));
    for (const patch of consistent.selected) {
      const verified = check.find((item) =>
        canonZone(String(item["zone_code"] ?? "")) === canonZone(patch.zoneCode)
      );
      if (
        !verified
        || verified["densite_value"] !== patch.value
        || verified["densite_unit"] !== patch.unit
        || verified["densite_raw"] !== patch.raw
        || verified["densite_source_url"] !== patch.sourceUrl
        || verified["densite_proof"] !== patch.proof
        || verified["densite_legal_date"] !== patch.legalDate
        || verified["densite_legal_date_evidence"] !== patch.legalDateEvidence
      ) {
        throw new Error(`${slug}: vérification parquet échouée pour ${patch.zoneCode}`);
      }
    }
    ingestReport.deposited = true;
    await putBytes(
      s3,
      `reports/normes-density-document/${slug}-20260728.json`,
      `${JSON.stringify(ingestReport, null, 2)}\n`,
      "application/json",
    );
  }
  checkpoint(output, ingestReport);
  process.stdout.write(`${JSON.stringify({
    slug,
    deposited: ingestReport.deposited,
    documents: documents.length,
    publishableDocuments: documents.filter((document) => document.disposition === "publishable").length,
    parsed: documents.reduce((sum, document) => sum + document.parser.extracted, 0),
    matched: consistent.selected.length,
    conflicts: consistent.conflicts.length,
    inserted: merged.inserted,
    enriched: merged.enriched,
    unchanged: merged.unchanged,
    output,
  })}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
