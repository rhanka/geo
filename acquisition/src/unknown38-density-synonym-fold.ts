/**
 * Unknown-only-38: deposit only density synonyms that were read verbatim from
 * the current source, with a verbatim legal date and an explicit SIG bridge.
 *
 * This is deliberately a finite, named worklist. It does not infer density
 * from coverage, lot size, land area, or usage columns, and it never writes a
 * served zonage object directly. The registry parquet is published and folded
 * by the existing publish/fold gates after this script succeeds.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  copyObject,
  exists,
  getBytes,
  putBytes,
  putBytesIfAbsentOrEqual,
  s3Client,
} from "./lib/s3.js";
import {
  mergeDensityNormRows,
  type DensityNormPatch,
} from "./lib/density-document-deposit.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey, writeNormsParquet } from "./lib/zonage-norms.js";

const SNAPSHOT = "2026-07-28";
const REPORT_KEY = "reports/unknown38-density-synonym-review-20260728.json";
const BACKUP_SUFFIX = ".pre-unknown38-density-synonym-20260728";
const METHOD = "native-text-verbatim-audit";

const SOURCE_URLS = {
  auclair: "https://municipaliteauclair.ca/media/attachments/2021/03/22/grilles-de-zonage.xls",
  barnstonOuest: "https://www.mrcdecoaticook.qc.ca/municipalites/Urbanisme/Barnston-Ouest/BAO_Zonage_225.pdf",
  coaticook: "https://www.coaticook.ca/fr/services/permis-et-reglements.php",
  deuxMontagnes: "https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/administration-et-finances/reglements-municipaux/1733-zonage-annexe-b-grilles_adm_2026-06-04.pdf",
  disraeli: "https://www.villededisraeli.ca/fichiersUpload/fichiers/20250407142337-annexe-iii-grilles-de-specifications-1-a-10.pdf",
  grandMetis: "https://municipalites-du-quebec.ca/grand-metis/docs/reglements/2/2011-0145_Règlement_de_zonage_9060__2019-04-11%5B1%5D.pdf",
  metisSurMer: "https://www.ville.metis-sur-mer.qc.ca/sites/default/files/fichier/08-38_reglement_de_zonage_-_version_refondue_2020.pdf",
  montTremblant: "https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-zone-100.pdf",
  saintFrederic: "https://www.st-frederic.com/wp-content/uploads/Grille-des-specifications_297-15_amende-5.pdf",
  saintRaphael: "https://www.saint-raphael.ca/fichiersUpload/fichiers/20251006101542-reglement-zonage-2022-228.pdf",
  westmount: "https://westmount.org/storage/app/media/travaux-et-urbanisme/amenagement-urbain/reglements-de-lamenagement-urbain/EN/reglement-1641-concordance-ppuzonagevfns-avec-annexes.pdf",
} as const;

type Source = {
  url: string;
  sha256: `sha256:${string}`;
  storageKey: string;
  owner: string;
  legalDate: string;
  legalDateEvidence: string;
};

const SOURCES: Record<string, Source> = {
  coaticook: {
    url: SOURCE_URLS.coaticook,
    sha256: "sha256:8a6d5aaf3285c098c3a15e600df149c2c5c46711bfffbaf8c27eb58c4adec551",
    storageKey: "raw/normes-density-sibling-document/cas/8a6d5aaf3285c098c3a15e600df149c2c5c46711bfffbaf8c27eb58c4adec551.pdf",
    owner: "Ville de Coaticook",
    legalDate: "2018-02-21",
    legalDateEvidence: "règl. 6-1-60 (2017), en vigueur 21 février 2018",
  },
  "grand-metis": {
    url: SOURCE_URLS.grandMetis,
    sha256: "sha256:42eac21217ee771316aaaabb8ee685aa5657cc778a26bbd76538c674920b8b61",
    storageKey: "raw/normes-density-sibling-document/cas/42eac21217ee771316aaaabb8ee685aa5657cc778a26bbd76538c674920b8b61.pdf",
    owner: "Municipalité de Grand-Métis",
    legalDate: "2019-04-11",
    legalDateEvidence: "RÈGLEMENT NUMÉRO 2011-0145 — VERSION REFONDUE — 11 AVRIL 2019",
  },
  "metis-sur-mer": {
    url: SOURCE_URLS.metisSurMer,
    sha256: "sha256:fe097fd0098dc839c94bcab1e24a58cd7e394a723161ac974b9279bfe848b647",
    storageKey: "raw/reglement-served/cas/fe097fd0098dc839c94bcab1e24a58cd7e394a723161ac974b9279bfe848b647.pdf",
    owner: "Ville de Métis-sur-Mer",
    legalDate: "2020-07-16",
    legalDateEvidence: "RÈGLEMENT DE ZONAGE NUMÉRO 08-38 — Version refondue — 16 juillet 2020",
  },
  westmount: {
    url: SOURCE_URLS.westmount,
    sha256: "sha256:33bc52f07654bd02e09652630acc149727570e660f89e08546416be3d49e1031",
    storageKey: "raw/reglement-served/cas/33bc52f07654bd02e09652630acc149727570e660f89e08546416be3d49e1031.pdf",
    owner: "Ville de Westmount / City of Westmount",
    legalDate: "2025-09-18",
    legalDateEvidence: "RÈGLEMENT 1641 — séance extraordinaire du Conseil municipal tenue le 18 septembre 2025",
  },
};

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function patch(
  source: Source,
  zoneCode: string,
  value: number,
  unit: DensityNormPatch["unit"],
  raw: string,
  proof: string,
  page: number,
): DensityNormPatch {
  return {
    zoneCode,
    value,
    unit,
    raw,
    proof,
    page,
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    sourceStorageKey: source.storageKey,
    method: METHOD,
    snapshot: SNAPSHOT,
    legalDate: source.legalDate,
    legalDateEvidence: source.legalDateEvidence,
  };
}

function coaticookPatches(): DensityNormPatch[] {
  const source = SOURCES.coaticook!;
  const zones: Array<[string, number]> = [
    ["CV-203-1 (P)", 10], ["CV-203-2 (P)", 10],
    ["PCV-207 (P)", 15], ["CV-208 (P)", 15],
    ["CV-209 (P)", 18], ["CV-210 (P)", 18],
    ["CV-211 (P)", 21], ["CV-212 (P)", 21], ["PCV-213 (P)", 21],
    ["CV-214", 24], ["C-501-1", 65],
  ];
  const proof =
    "a) Il doit y avoir un minimum de trois logements par bâtiment. Néanmoins, il est permis de remplacer un logement par un commerce, sans avoir à respecter la norme minimale de trois logements, dans les conditions suivantes :";
  return zones.map(([zone, page]) => patch(
    source,
    zone,
    3,
    "logements/batiment",
    "un minimum de trois logements par bâtiment",
    `${proof} Note de la grille : « ${source.legalDateEvidence} ».`,
    page,
  ));
}

function grandMetisPatches(): DensityNormPatch[] {
  const source = SOURCES["grand-metis"]!;
  const values: Record<number, number> = {
    1: 2, 2: 2, 3: 0, 4: 2, 6: 2, 7: 2, 8: 2, 10: 2, 11: 2, 12: 2,
    13: 2, 14: 2, 15: 1, 16: 2, 17: 2, 18: 2, 19: 2, 20: 2, 21: 2,
    22: 0, 23: 2, 24: 2, 25: 2, 26: 2,
  };
  return Object.entries(values).map(([zone, value]) => patch(
    source,
    zone,
    value,
    "logements/batiment",
    String(value),
    `ANNEXE 2, tableau « Nombre de logements maximum », colonne de la zone ${zone} : « ${value} ». La grille associe séparément le numéro de zone et l'affectation; aucun autre calcul n'est effectué.`,
    247,
  ));
}

function metisSurMerPatches(): DensityNormPatch[] {
  const source = SOURCES["metis-sur-mer"]!;
  const values: Record<number, number> = {
    1: 2, 2: 2, 3: 1, 4: 1, 5: 2, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2,
    11: 2, 12: 1, 13: 1, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2, 20: 2,
    21: 0, 22: 0, 23: 2, 24: 2, 25: 0, 26: 2, 27: 2, 28: 2, 29: 0,
    31: 2, 32: 2, 33: 2, 34: 2, 35: 0, 36: 2, 37: 2, 38: 2, 39: 2, 40: 2,
    41: 2, 42: 2, 43: 2, 44: 2, 45: 2, 46: 2, 47: 2, 48: 0, 49: 2,
    50: 4, 51: 1, 52: 6, 53: 4, 54: 2, 55: 2, 56: 6, 57: 0, 58: 0,
    59: 2, 60: 2, 61: 4, 62: 4, 63: 4, 64: 4, 65: 4,
  };
  return Object.entries(values).map(([zone, value]) => patch(
    source,
    zone,
    value,
    "logements/batiment",
    String(value),
    `ANNEXE 2 — tableau « Nombre de logements maximum », colonne de la zone ${zone} : « ${value} ». Les colonnes 19 et 30 sont laissées sans valeur parce que la source les imprime sans nombre.`,
    Number(zone) <= 45 ? 267 : 268,
  ));
}

function westmountPatches(): DensityNormPatch[] {
  const source = SOURCES.westmount!;
  const values: Array<[string, number, string, number]> = [
    ["C16-31-04", 9.5, "9,5 (5)", 12],
    ["C7-24-09", 7, "7", 14],
    ["C11-24-10", 8.5, "8,5", 17],
    ["R6-24-08", 5, "5,0", 19],
    ["R11-24-16", 4.5, "4,5 (11)", 21],
  ];
  return values.map(([zone, value, raw, page]) => patch(
    source,
    zone,
    value,
    "cos-max",
    raw,
    `ANNEXE II, ${zone}, rubrique « DENSITÉ / DENSITY », ligne « RSP maximum / Maximum FAR » : « ${raw} ». La zone C18-24-15 n'est pas déposée : sa valeur « 12,0 » ne s'applique qu'aux colonnes « Jumelée / Semi-detached » et « En rangée / Attached ».`,
    page,
  ));
}

const PATCHES: Record<string, DensityNormPatch[]> = {
  coaticook: coaticookPatches(),
  "grand-metis": grandMetisPatches(),
  "metis-sur-mer": metisSurMerPatches(),
  westmount: westmountPatches(),
};

const REVIEW = [
  {
    slug: "auclair",
    classification: "a-numeric-but-no-verbatim-legal-date",
    owner: "Municipalité d'Auclair",
    source_url: SOURCE_URLS.auclair,
    verbatim: "Dans les zones agroforestières et de réserve urbaine, les usages résidentiels doivent respecter une densité maximale de 2 logements par hectares.",
    constat: "La valeur numérique existe, mais le document lu ne donne pas de date d'adoption ou d'entrée en vigueur verbatim; elle ne se plie donc pas.",
  },
  {
    slug: "barnston-ouest",
    classification: "b",
    owner: "Municipalité de Barnston-Ouest",
    source_url: SOURCE_URLS.barnstonOuest,
    verbatim: "Coefficient d'occupation au sol : Rapport entre la superficie totale du plancher du rez-de-chaussée d'un bâtiment et la superficie du terrain sur lequel il est ou il sera érigé. Densité d'occupation : Le pourcentage correspondant à la superficie totale de plancher du bâtiment par rapport au terrain sur lequel il est construit. Synonyme du coefficient d’occupation du sol (COS).",
    constat: "Les grilles de zones ne remplissent aucune valeur numérique de COS/densité ou de nombre de logements; « Un maximum de 40 sites de camping ... par (1) hectare » est une norme de camping, pas une densité résidentielle.",
  },
  {
    slug: "coaticook",
    classification: "a-folded",
    owner: "Ville de Coaticook",
    source_url: SOURCE_URLS.coaticook,
    verbatim: "a) Il doit y avoir un minimum de trois logements par bâtiment.",
    constat: "Norme de logements par bâtiment, date verbatim : règl. 6-1-60 (2017), en vigueur 21 février 2018.",
  },
  {
    slug: "deux-montagnes",
    classification: "b",
    owner: "Ville de Deux-Montagnes",
    source_url: SOURCE_URLS.deuxMontagnes,
    verbatim: "La grille est organisée par colonnes d'usages (« Unifamiliale », « Bifamiliale », « Trifamiliale », « 4 à 8 logements », « 9 à 12 logements », « 13 à 16 logements », « de 16 logements ») et par rangées de normes (« CES max », « Verdissement », « Bâtiment »).",
    constat: "Les nombres de logements sont des en-têtes de classes d'usage; aucune rangée numérique « densité », « logements par bâtiment » ou COS n'est imprimée. « CES » est l'emprise au sol, pas le COS demandé.",
  },
  {
    slug: "disraeli--les-appalaches",
    classification: "a-numeric-but-no-sig-bridge",
    owner: "Ville de Disraeli",
    source_url: SOURCE_URLS.disraeli,
    verbatim: "Indice d’occupation au sol (%) 40 (zones 1-R à 8-R) et 50 (zone 10-RC).",
    constat: "La source imprime un nombre, mais les codes de la grille (1-R, 9-IP, 10-RC) ne recoupent pas les codes SIG servis (RURA 6, AFAa 2, etc.); aucun pli zone-polygone vérifiable n'est donc autorisé.",
  },
  {
    slug: "grand-metis",
    classification: "a-folded",
    owner: "Municipalité de Grand-Métis",
    source_url: SOURCE_URLS.grandMetis,
    verbatim: "ANNEXE 2 — « Nombre de logements maximum » — valeurs lues colonne par colonne.",
    constat: "La source est « RÈGLEMENT NUMÉRO 2011-0145 — VERSION REFONDUE — 11 AVRIL 2019 »; 24 polygones servis reçoivent une valeur verbatim.",
  },
  {
    slug: "metis-sur-mer",
    classification: "a-folded",
    owner: "Ville de Métis-sur-Mer",
    source_url: SOURCE_URLS.metisSurMer,
    verbatim: "ANNEXE 2 — « Nombre de logements maximum ».",
    constat: "Version refondue — 16 juillet 2020; 63 lignes de zones alimentent 65 polygones servis. Les zones 19 et 30 restent sans nombre parce que la source les imprime sans cellule numérique.",
  },
  {
    slug: "mont-tremblant",
    classification: "a-folded-existing",
    owner: "Ville de Mont-Tremblant",
    source_url: SOURCE_URLS.montTremblant,
    verbatim: "Valeurs de densité déjà déposées dans le rapport d'ingestion normatif daté et relues sur les objets servis.",
    constat: "Le dépôt antérieur est conservé; 218 polygones servis portent déjà une densité numérique sourcée.",
  },
  {
    slug: "saint-frederic",
    classification: "a-numeric-but-no-verbatim-legal-date",
    owner: "Municipalité de Saint-Frédéric",
    source_url: SOURCE_URLS.saintFrederic,
    verbatim: "(20) Une subdivision de lot pour des fins résidentielles doit respecter une densité d’occupation minimale équivalente à 36 logements/hectares.",
    constat: "La valeur numérique existe, mais la grille lue ne porte pas de date d'adoption ou d'entrée en vigueur verbatim; elle ne se plie donc pas.",
  },
  {
    slug: "saint-raphael",
    classification: "a-numeric-but-conditional-scope",
    owner: "Municipalité de Saint-Raphaël",
    source_url: SOURCE_URLS.saintRaphael,
    verbatim: "g) Le coefficient d’occupation du sol de l’ensemble des bâtiments principaux doit être égal ou inférieur à 0,3 ;",
    constat: "La date « Adopté à Saint-Raphaël, le 7 novembre 2022 » est présente, mais la norme est limitée à l'ARTICLE 121 — projet d'ensemble à l'intérieur du périmètre urbain; elle ne peut pas être estampillée sur les 97 polygones.",
  },
  {
    slug: "westmount",
    classification: "a-folded-partial",
    owner: "Ville de Westmount / City of Westmount",
    source_url: SOURCE_URLS.westmount,
    verbatim: "ANNEXE II, rubrique « DENSITÉ / DENSITY », « RSP maximum / Maximum FAR ».",
    constat: "Règlement 1641, séance extraordinaire du 18 septembre 2025; 5 zones à portée générale sont pliées. C18-24-15 (« 12,0 ») est retenue hors pli car la valeur est conditionnelle aux structures jumelée/en rangée.",
  },
] as const;

function localSourcePath(slug: string): string | null {
  if (slug === "coaticook") return "../work/zonage-norms/coaticook/grille.pdf";
  if (slug === "grand-metis") return "../work/zonage-norms/grand-metis/grille.pdf";
  return null;
}

async function ensureSource(s3: ReturnType<typeof s3Client>, slug: string, source: Source): Promise<void> {
  const localPath = localSourcePath(slug);
  if (localPath === null) {
    if (!(await exists(s3, source.storageKey))) {
      throw new Error(`${slug}: source CAS absente ${source.storageKey}`);
    }
    return;
  }
  const bytes = readFileSync(localPath);
  if (sha256(bytes) !== source.sha256) {
    throw new Error(`${slug}: hash local différent de la fiche source`);
  }
  await putBytesIfAbsentOrEqual(s3, source.storageKey, bytes, "application/pdf");
}

async function readRows(s3: ReturnType<typeof s3Client>, slug: string): Promise<Record<string, unknown>[]> {
  return readParquetRowsFromBuffer(await getBytes(s3, normsKey(slug)));
}

type GridFeatureCollection = {
  features?: Array<{ properties?: Record<string, unknown> }>;
};

/**
 * Métis-sur-Mer prints zones 01–09 with a zero and an affectation in the SIG
 * layer, while the old norms rows are bare numbers. The source table itself is
 * keyed by the same zone number and affectation, so this is a measured serve
 * bridge, not a guessed numeric prefix. Refuse the city if the SIG exposes two
 * different surface codes for one number.
 */
async function metisDensityZoneAliases(
  s3: ReturnType<typeof s3Client>,
  patches: readonly DensityNormPatch[],
): Promise<Map<string, string>> {
  const gridKey = "normalized/ca-qc-zonage/qc-zonage-metis-sur-mer.geojson";
  const grid = JSON.parse((await getBytes(s3, gridKey)).toString("utf8")) as GridFeatureCollection;
  const servedByNumber = new Map<string, string>();
  for (const feature of grid.features ?? []) {
    const surface = String(feature.properties?.["zone_code"] ?? "").trim();
    const number = /^0*(\d+)(?:\s|$)/.exec(surface)?.[1];
    if (!number || !surface) continue;
    const key = String(Number(number));
    const previous = servedByNumber.get(key);
    if (previous !== undefined && previous !== surface) {
      throw new Error(`metis-sur-mer: pont SIG ambigu pour zone ${key}: ${previous} <> ${surface}`);
    }
    servedByNumber.set(key, surface);
  }

  const aliases = new Map<string, string>();
  for (const wanted of patches) {
    const servedCode = servedByNumber.get(String(Number(wanted.zoneCode)));
    if (!servedCode) throw new Error(`metis-sur-mer: zone ${wanted.zoneCode} absente du SIG servi`);
    aliases.set(wanted.zoneCode, servedCode);
  }
  return aliases;
}

function alignMetisRowsToServed(
  rows: Record<string, unknown>[],
  patches: readonly DensityNormPatch[],
  aliases: ReadonlyMap<string, string>,
): void {
  for (const wanted of patches) {
    const candidates = rows.filter((candidate) => {
      const code = String(candidate["zone_code"] ?? "").trim();
      const number = /^0*(\d+)(?:\s|$)/.exec(code)?.[1];
      return number !== undefined && String(Number(number)) === String(Number(wanted.zoneCode));
    });
    if (candidates.length > 1) {
      throw new Error(`metis-sur-mer: ${candidates.length} lignes normatives pour zone ${wanted.zoneCode}`);
    }
    if (candidates.length === 1) candidates[0]!["zone_code"] = aliases.get(wanted.zoneCode)!;
  }
}

function verifyRows(
  rows: readonly Record<string, unknown>[],
  patches: readonly DensityNormPatch[],
  aliases: ReadonlyMap<string, string> = new Map(),
): void {
  for (const wanted of patches) {
    const expectedZoneCode = aliases.get(wanted.zoneCode) ?? wanted.zoneCode;
    const row = rows.find((candidate) => String(candidate["zone_code"] ?? "") === expectedZoneCode);
    if (!row || row["densite_value"] !== wanted.value || row["densite_unit"] !== wanted.unit) {
      throw new Error(`zone ${wanted.zoneCode}: densité déposée introuvable ou différente`);
    }
    for (const [field, expected] of Object.entries({
      densite_raw: wanted.raw,
      densite_source_url: wanted.sourceUrl,
      densite_source_sha256: wanted.sourceSha256,
      densite_source_storage_key: wanted.sourceStorageKey,
      densite_snapshot: wanted.snapshot,
      densite_proof: wanted.proof,
      densite_legal_date: wanted.legalDate,
      densite_legal_date_evidence: wanted.legalDateEvidence,
    })) {
      if (row[field] !== expected) throw new Error(`zone ${wanted.zoneCode}: preuve ${field} divergente`);
    }
  }
}

async function depositCity(s3: ReturnType<typeof s3Client>, slug: string, dryRun: boolean): Promise<Record<string, unknown>> {
  const source = SOURCES[slug];
  const patches = PATCHES[slug];
  if (!source || !patches) throw new Error(`worklist absent pour ${slug}`);
  await ensureSource(s3, slug, source);
  const key = normsKey(slug);
  const before = await readRows(s3, slug);
  const aliases = slug === "metis-sur-mer"
    ? await metisDensityZoneAliases(s3, patches)
    : new Map<string, string>();
  if (slug === "metis-sur-mer") alignMetisRowsToServed(before, patches, aliases);
  const mergePatches = patches.map((wanted) => {
    const zoneCode = aliases.get(wanted.zoneCode);
    return zoneCode === undefined ? wanted : { ...wanted, zoneCode };
  });
  const merged = mergeDensityNormRows(before, mergePatches);
  if (!dryRun) {
    const backupKey = `${key}${BACKUP_SUFFIX}`;
    if (!(await exists(s3, backupKey))) await copyObject(s3, key, backupKey);
    await putBytes(s3, key, await writeNormsParquet(merged.rows), "application/octet-stream");
    verifyRows(await readRows(s3, slug), mergePatches);
  }
  const result = {
    slug,
    owner: source.owner,
    source_url: source.url,
    source_sha256: source.sha256,
    source_storage_key: source.storageKey,
    legal_date: source.legalDate,
    legal_date_evidence: source.legalDateEvidence,
    patches: patches.length,
    inserted: merged.inserted,
    enriched: merged.enriched,
    unchanged: merged.unchanged,
    rows_before: before.length,
    rows_after: merged.rows.length,
    dry_run: dryRun,
  };
  console.log(JSON.stringify(result));
  return result;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const requested = argv.includes("--slugs")
    ? String(argv[argv.indexOf("--slugs") + 1] ?? "").split(",").filter(Boolean)
    : Object.keys(PATCHES);
  const s3 = s3Client();
  const deposits: Record<string, unknown>[] = [];
  for (const slug of requested) deposits.push(await depositCity(s3, slug, dryRun));
  await putBytes(s3, REPORT_KEY, Buffer.from(JSON.stringify({
    generated_at: new Date().toISOString(),
    snapshot: SNAPSHOT,
    method: METHOD,
    scope: "unknown-only-38 / source_reglement_identifie_sans_densite_numerique",
    review: REVIEW,
    deposits,
  }, null, 2) + "\n"), "application/json");
  console.log(`REPORT s3://${REPORT_KEY}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
