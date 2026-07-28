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
  parseAmosDensityDocument,
  parseChamplainDensityDocument,
  parseChestervilleDensityDocument,
  parseClermontDensityDocument,
  parseDrummondvilleDensityDocument,
  parseHuberdeauDensityDocument,
  parseLacDesEcorcesDensityDocument,
  parseMontLaurierZonesHDensityDocument,
  parseMontTremblantDensityDocument,
  parseMontTremblantPlanDensityDocument,
  parseSaintJeromeDensityDocument,
  parseVarennesDensityDocument,
  parseVarennesPpuDensityDocument,
  type DensityDocumentParseResult,
} from "../../packages/geo/src/zonage/densityDocument.js";
import { assertClosedDensityDiscoveryReport } from "./lib/density-document-ingest.js";
import {
  mergeDensityNormRows,
  type DensityNormPatch,
} from "./lib/density-document-deposit.js";
import {
  densityDocumentDisposition,
  type DensityDocumentDisposition,
  type DensityDocumentReference,
  validateHistoricalCorroboration,
} from "./lib/density-document-reference-policy.js";
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
  completedCount?: unknown;
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
  corroboration?: {
    referenceProfileId: string;
    exactMatchRequired: boolean;
  };
  parse: (text: string) => DensityDocumentParseResult;
}

interface DocumentReview {
  id: string;
  disposition: DensityDocumentDisposition;
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
  corroboration?: {
    referenceDocumentId: string;
    exactMatchRequired: boolean;
    comparedNorms: number;
    exactMatches: number;
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
    id: "amos-va-964-annexe-2-p1",
    slug: "amos",
    sourceUrl: "https://amos.quebec/storage/app/media/decouvrir-amos/administration-et-finances/reglementation/urbanisme/annexe-2-grilles.pdf",
    sourceSha256: "sha256:9cc4aa5104cf81397e7aaa12be1e8d312835a852ab7a497f6ace5ac6bf536efa",
    sourceHost: "amos.quebec",
    owner: "Ville d’Amos",
    ownerEvidence: "Page municipale capturée: « Règlement de zonage VA-964 — Annexe – Grilles de spécification »; le règlement VA-964 nomme « Ville d’Amos » et l’annexe 2",
    legalDate: "2024-09-17",
    legalDateEvidence: "Page P-1 native verbatim: « VA-1290 — 17 sept. 2024 »",
    reglement: "Règlement de zonage VA-964 — annexe 2, grille P-1",
    parse: parseAmosDensityDocument,
  },
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
    corroboration: {
      referenceProfileId: "champlain-file-18281",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "champlain-file-18281",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "champlain-file-18281",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "champlain-file-18281",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "champlain-file-18281",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "chesterville-2024-grilles-agricoles",
      exactMatchRequired: true,
    },
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
    corroboration: {
      referenceProfileId: "chesterville-2024-grilles-residentielles-autres",
      exactMatchRequired: true,
    },
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
  {
    id: "clermont-grilles-2025-06-25",
    slug: "clermont--charlevoix-est",
    sourceUrl: "http://ville.clermont.qc.ca/public_upload/files/2025/2025-06-25%20Grilles%20de%20zonage%20%C3%A0%20jour.pdf",
    sourceSha256: "sha256:cbe4f759cd2693c89ab0bbbd7e7b7e58dae5bd8a3b15677c0261b6e4bdcc024a",
    sourceHost: "ville.clermont.qc.ca",
    owner: "Ville de Clermont (Charlevoix-Est)",
    ownerEvidence: "Ancre native « VILLE DE CLERMONT — RÈGLEMENT DE ZONAGE NUMÉRO VC-434-13 »",
    legalDate: "2025-06-25",
    legalDateEvidence: "URL municipale verbatim: /2025/2025-06-25 Grilles de zonage à jour.pdf",
    reglement: "Règlement de zonage VC-434-13 — grilles à jour",
    parse: parseClermontDensityDocument,
  },
  {
    id: "clermont-grilles-2021-06",
    slug: "clermont--charlevoix-est",
    sourceUrl: "http://ville.clermont.qc.ca/public_upload/files/urbanisme/grille-des-spcifications-juin-2021.pdf",
    sourceSha256: "sha256:b13a867b13efc1b68c87bb8f9356236db92980833412ef947179d6779ec4eb4e",
    sourceHost: "ville.clermont.qc.ca",
    owner: "Ville de Clermont (Charlevoix-Est)",
    ownerEvidence: "Ancre native « VILLE DE CLERMONT — RÈGLEMENT DE ZONAGE NUMÉRO VC-434-13 »",
    legalDate: "2021-06",
    legalDateEvidence: "Nom municipal verbatim: « grille-des-spcifications-juin-2021.pdf »",
    reglement: "Règlement de zonage VC-434-13 — grilles juin 2021",
    corroboration: {
      referenceProfileId: "clermont-grilles-2025-06-25",
      exactMatchRequired: false,
    },
    parse: parseClermontDensityDocument,
  },
  {
    id: "clermont-grilles-wayback-2016",
    slug: "clermont--charlevoix-est",
    sourceUrl: "https://web.archive.org/web/20160607233854id_/http://ville.clermont.qc.ca/uploaded/file/VC-434-13%20-%20Zonage%20-%20Grilles%20-%20COMPLET.pdf",
    sourceSha256: "sha256:16d39d52be401c48f9726da5efa9ab45952e8c523192a504198995ec65cc729f",
    sourceHost: "web.archive.org",
    owner: "Ville de Clermont (Charlevoix-Est)",
    ownerEvidence: "URL municipale archivée et ancre native « VILLE DE CLERMONT — VC-434-13 »",
    legalDate: "2016-06-07",
    legalDateEvidence: "Capture Wayback verbatim /web/20160607233854id_/ et grilles « En vigueur le 31 octobre 2013 »",
    reglement: "Règlement de zonage VC-434-13 — grilles archivées",
    corroboration: {
      referenceProfileId: "clermont-grilles-2025-06-25",
      exactMatchRequired: false,
    },
    parse: parseClermontDensityDocument,
  },
  {
    id: "clermont-grilles-complet-undated",
    slug: "clermont--charlevoix-est",
    sourceUrl: "http://www.ville.clermont.qc.ca/public_upload/files/urbanisme/vc-434-13-zonage-grilles-complet.pdf",
    sourceSha256: "sha256:6d76f798d32ff3e4c76242922e6e7ec86ee971811fd3807b4cb5697a2d3c56d4",
    sourceHost: "www.ville.clermont.qc.ca",
    owner: "Ville de Clermont (Charlevoix-Est)",
    ownerEvidence: "Ancre native « VILLE DE CLERMONT — RÈGLEMENT DE ZONAGE NUMÉRO VC-434-13 »",
    legalDate: null,
    legalDateEvidence: "Aucune date globale de cette compilation; les dates de modification sont propres aux feuilles",
    reglement: "Règlement de zonage VC-434-13 — grilles complètes non datées",
    parse: parseClermontDensityDocument,
  },
  {
    id: "varennes-grilles-400-2025",
    slug: "varennes",
    sourceUrl: "https://www.ville.varennes.qc.ca/uploads/Services/reg707_AnnexeB_grilles_400_-_12_septembre_2025.pdf",
    sourceSha256: "sha256:ae42c84e3fa2cc8d30b19dc77c22fa58eb0aa8aa6ead7198c34d18e46a8986dc",
    sourceHost: "www.ville.varennes.qc.ca",
    owner: "Ville de Varennes",
    ownerEvidence: "Document servi par l’hôte municipal officiel www.ville.varennes.qc.ca, Annexe B du règlement 707",
    legalDate: "2025-09-12",
    legalDateEvidence: "Nom municipal verbatim: « reg707_AnnexeB_grilles_400_-_12_septembre_2025.pdf »",
    reglement: "Règlement 707 — annexe B, grilles 400",
    parse: parseVarennesDensityDocument,
  },
  {
    id: "varennes-grilles-300-2022",
    slug: "varennes",
    sourceUrl: "https://www.ville.varennes.qc.ca/uploads/Services/Urbanisme/reg707_AnnexeB_grilles_300_-_18_aout_2022.pdf",
    sourceSha256: "sha256:3575fd3726335b7b2a6d3619f8a98b23fab0f8c99102a4640d3537b4c85d4769",
    sourceHost: "www.ville.varennes.qc.ca",
    owner: "Ville de Varennes",
    ownerEvidence: "Document servi par l’hôte municipal officiel www.ville.varennes.qc.ca, Annexe B du règlement 707",
    legalDate: "2022-09-14",
    legalDateEvidence: "Pied de grille natif verbatim: « 2022-09-14 »",
    reglement: "Règlement 707 — annexe B, grilles 300",
    parse: parseVarennesDensityDocument,
  },
  {
    id: "varennes-grilles-500-2022",
    slug: "varennes",
    sourceUrl: "https://www.ville.varennes.qc.ca/uploads/Services/Urbanisme/reg707_AnnexeB_grilles_500_-_18_aout_2022.pdf",
    sourceSha256: "sha256:ffa4bb9d680b19927eda91ae93ab35f58a47af239fd69a6809be87a2943ebf8a",
    sourceHost: "www.ville.varennes.qc.ca",
    owner: "Ville de Varennes",
    ownerEvidence: "Document servi par l’hôte municipal officiel www.ville.varennes.qc.ca, Annexe B du règlement 707",
    legalDate: "2022-09-14",
    legalDateEvidence: "Pied de grille natif verbatim: « 2022-09-14 »",
    reglement: "Règlement 707 — annexe B, grilles 500",
    parse: parseVarennesDensityDocument,
  },
  {
    id: "varennes-grilles-600-2022",
    slug: "varennes",
    sourceUrl: "https://www.ville.varennes.qc.ca/uploads/Services/Urbanisme/reg707_AnnexeB_grilles_600_-_18_aout_2022.pdf",
    sourceSha256: "sha256:b4db41e1bd0dfa47b12e065f24588e4428d6bb4d146f49bc54c895d9a1bb2376",
    sourceHost: "www.ville.varennes.qc.ca",
    owner: "Ville de Varennes",
    ownerEvidence: "Document servi par l’hôte municipal officiel www.ville.varennes.qc.ca, Annexe B du règlement 707",
    legalDate: "2022-09-14",
    legalDateEvidence: "Pied de grille natif verbatim: « 2022-09-14 »",
    reglement: "Règlement 707 — annexe B, grilles 600",
    parse: parseVarennesDensityDocument,
  },
  {
    id: "mont-tremblant-annexe-a-300",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-300.pdf",
    sourceSha256: "sha256:44ae419b0cf3f6148750db9babf6b66e868024486e9271fd019f4da9e4b54845",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Hôte municipal vdmt.ca et ancre native « Annexe A du règlement de zonage (2008)-102 »",
    legalDate: "2025-06-23",
    legalDateEvidence: "Plus récente date native de la table d’amendements: « 2025-06-23 »",
    reglement: "Règlement de zonage (2008)-102 — annexe A, zones 300",
    parse: parseMontTremblantDensityDocument,
  },
  {
    id: "mont-tremblant-annexe-a-400",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-400.pdf",
    sourceSha256: "sha256:7dd021643c87d2ba529d3a75954bfd0ca0ad41cfb208ebab1bacdbc375c58c4b",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Hôte municipal vdmt.ca et ancre native « Annexe A du règlement de zonage (2008)-102 »",
    legalDate: "2025-08-25",
    legalDateEvidence: "Plus récente date native de la table d’amendements: « 2025-08-25 »",
    reglement: "Règlement de zonage (2008)-102 — annexe A, zones 400",
    parse: parseMontTremblantDensityDocument,
  },
  {
    id: "mont-tremblant-annexe-a-500",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-500.pdf",
    sourceSha256: "sha256:55c64ef216d361590c9de684380773b51573949676811c6b695e2f9c852d534c",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Hôte municipal vdmt.ca et ancre native « Annexe A du règlement de zonage (2008)-102 »",
    legalDate: "2022-03-18",
    legalDateEvidence: "Plus récente date native de la table d’amendements: « 2022-03-18 »",
    reglement: "Règlement de zonage (2008)-102 — annexe A, zones 500",
    parse: parseMontTremblantDensityDocument,
  },
  {
    id: "mont-tremblant-annexe-a-600",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-600.pdf",
    sourceSha256: "sha256:633f875e20f4931565edcd189d7e72204da0bafc0adbd1c1d9a5a9842ab10476",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Hôte municipal vdmt.ca et ancre native « Annexe A du règlement de zonage (2008)-102 »",
    legalDate: "2025-08-25",
    legalDateEvidence: "Plus récente date native de la table d’amendements: « 2025-08-25 »",
    reglement: "Règlement de zonage (2008)-102 — annexe A, zones 600",
    parse: parseMontTremblantDensityDocument,
  },
  {
    id: "mont-tremblant-annexe-a-800",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-800.pdf",
    sourceSha256: "sha256:ce11992f959a866b2fe027079243fe994f07e514b9542337fa1c559b90825b54",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Hôte municipal vdmt.ca et ancre native « Annexe A du règlement de zonage (2008)-102 »",
    legalDate: "2022-10-21",
    legalDateEvidence: "Plus récente date native de la table d’amendements: « 2022-10-21 »",
    reglement: "Règlement de zonage (2008)-102 — annexe A, zones 800",
    parse: parseMontTremblantDensityDocument,
  },
  {
    id: "mont-tremblant-plan-urbanisme-chapitre-7",
    slug: "mont-tremblant",
    sourceUrl: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/plan-urbanisme/plan-urbanisme-chapitre7.pdf",
    sourceSha256: "sha256:31d8f90677becdaedf83c3a472715d9b2fb3be95ba463f37ee43851088cbf035",
    sourceHost: "vdmt.ca",
    owner: "Ville de Mont-Tremblant",
    ownerEvidence: "Ancre native « Ville de Mont-Tremblant — Règlement (2008)-100 — Plan d’urbanisme »",
    legalDate: "2019",
    legalDateEvidence: "Sous la densité TV, mention native « Modifié par : (2019)-100-27 »",
    reglement: "Règlement (2008)-100 — plan d’urbanisme, chapitre 7",
    parse: parseMontTremblantPlanDensityDocument,
  },
  {
    id: "saint-jerome-0351-000-annexe-2-2026-07-14",
    slug: "saint-jerome",
    sourceUrl: "https://www.vsj.ca/wp-content/uploads/2025/12/Annexe_2_Grille_0351-000_Zonage_2026_07_14.pdf",
    sourceSha256: "sha256:ae318ddc3b0bef7fdb0f28f46c50f97472b79d6f09f797d808aec878205e495a",
    sourceHost: "www.vsj.ca",
    owner: "Ville de Saint-Jérôme",
    ownerEvidence: "Ancre native « Règlement numéro 0351-000 sur le zonage de la Ville de Saint-Jérôme »",
    legalDate: "2026-07-14",
    legalDateEvidence: "Nom municipal verbatim: « Annexe_2_Grille_0351-000_Zonage_2026_07_14.pdf »",
    reglement: "Règlement de zonage 0351-000 — annexe 2",
    parse: parseSaintJeromeDensityDocument,
  },
  {
    id: "varennes-ppu-706-15-2021-06-11",
    slug: "varennes",
    sourceUrl: "https://www.ville.varennes.qc.ca/uploads/Services/Urbanisme/PPU_reg706-15_11_juin_2021.pdf",
    sourceSha256: "sha256:6cf10227116a8b06dd9e2c91b94c3c6c2966915e37dfc82a5a1584a2c831d865",
    sourceHost: "www.ville.varennes.qc.ca",
    owner: "Ville de Varennes",
    ownerEvidence: "Ancre native « Ville de Varennes — PROGRAMME PARTICULIER D’URBANISME »",
    legalDate: "2021-06-11",
    legalDateEvidence: "Page titre native verbatim: « 11 juin 2021 »",
    reglement: "Règlement 706-15 — programme particulier d’urbanisme",
    parse: parseVarennesPpuDensityDocument,
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
  const profileId = option(argv, "profile-id");
  const knownSlugs = [...new Set(PROFILES.map((profile) => profile.slug))].sort();
  const profiles = PROFILES.filter((profile) =>
    profile.slug === slug && (!profileId || profile.id === profileId)
  );
  const reportPath = option(argv, "report")
    ?? "../work/coverage/density-document-discovery-report-20260728.json";
  const output = option(argv, "output")
    ?? `../work/coverage/density-document-norm-ingest-${slug ?? "missing"}.json`;
  const deposit = argv.includes("--deposit");
  const legalReviewed = argv.includes("--legal-reviewed");
  const reviewCorroborationIdsRaw = option(argv, "review-corroboration-ids");
  const reviewCorroborationIds = reviewCorroborationIdsRaw === undefined
    ? null
    : new Set(reviewCorroborationIdsRaw.split(",").map((id) => id.trim()).filter(Boolean));
  if (!slug || profiles.length === 0) {
    throw new Error(
      profileId
        ? `profil inconnu pour ${slug ?? "slug absent"}: ${profileId}`
        : `--slug requis parmi: ${knownSlugs.join(", ")}`,
    );
  }
  if (deposit && !legalReviewed) throw new Error("--deposit exige --legal-reviewed");
  if (deposit && reviewCorroborationIds !== null) {
    throw new Error("--review-corroboration-ids est un mode de revue sans dépôt");
  }
  if (reviewCorroborationIds !== null) {
    const knownProfileIds = new Set(profiles.map((profile) => profile.id));
    for (const id of reviewCorroborationIds) {
      if (!knownProfileIds.has(id)) throw new Error(`profil de revue inconnu pour ${slug}: ${id}`);
    }
  }

  const discovery = JSON.parse(readFileSync(reportPath, "utf8")) as DiscoveryReport;
  assertClosedDensityDiscoveryReport(discovery);
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
  const reviewedProfiles = new Map<string, DensityDocumentReference>();

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
          sourceSha256: profile.sourceSha256,
          sourceStorageKey: candidate.storageKey,
          method: METHOD,
          snapshot,
          legalDate: profile.legalDate,
          legalDateEvidence: profile.legalDateEvidence,
        });
      }
    }
    const reviewedProfile: DensityDocumentReference = {
      id: profile.id,
      slug: profile.slug,
      owner: profile.owner,
      legalDate: profile.legalDate,
      norms: parsed.norms,
    };
    let corroboration: DocumentReview["corroboration"];
    const activeCorroboration = profile.corroboration
      && (reviewCorroborationIds === null || reviewCorroborationIds.has(profile.id))
      ? profile.corroboration
      : null;
    if (activeCorroboration) {
      const reference = reviewedProfiles.get(activeCorroboration.referenceProfileId);
      if (!reference) {
        throw new Error(
          `${profile.id}: référence de corroboration non revue avant ce profil: `
          + activeCorroboration.referenceProfileId,
        );
      }
      const validated = validateHistoricalCorroboration(
        reviewedProfile,
        reference,
        activeCorroboration.exactMatchRequired,
      );
      corroboration = {
        referenceDocumentId: validated.referenceDocumentId,
        exactMatchRequired: validated.exactMatchRequired,
        comparedNorms: validated.comparedNorms,
        exactMatches: validated.exactMatches,
      };
    } else {
      allPatches.push(...documentPatches);
    }
    if (reviewedProfiles.has(profile.id)) {
      throw new Error(`profil dupliqué: ${profile.id}`);
    }
    reviewedProfiles.set(profile.id, reviewedProfile);

    const disposition = densityDocumentDisposition({
      documentAnchored: parsed.documentAnchored,
      projectExcluded: parsed.projectExcluded,
      legalDate: profile.legalDate,
      parsedNorms: parsed.norms.length,
      matchedNorms: documentPatches.length,
      corroborationOnly: corroboration !== undefined,
    });
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
      ...(corroboration ? { corroboration } : {}),
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
      reviewScope: {
        corroborationProfileIds: reviewCorroborationIds === null
          ? profiles.filter((candidateProfile) => candidateProfile.corroboration)
            .map((candidateProfile) => candidateProfile.id)
          : [...reviewCorroborationIds],
      },
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
    reviewScope: {
      corroborationProfileIds: reviewCorroborationIds === null
        ? profiles.filter((profile) => profile.corroboration).map((profile) => profile.id)
        : [...reviewCorroborationIds],
    },
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
      sourceSha256: patch.sourceSha256,
      sourceStorageKey: patch.sourceStorageKey,
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
        || verified["densite_source_sha256"] !== patch.sourceSha256
        || verified["densite_source_storage_key"] !== patch.sourceStorageKey
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
