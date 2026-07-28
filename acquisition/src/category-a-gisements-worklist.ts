/**
 * Matérialise les trois lots de capture de la catégorie A du bilan 4A.
 *
 * Cette passe cible exclusivement les gisements que le crawl de pages publiques
 * ne fermait pas : flux CMS natif, sitemaps, portail/centre documentaire de la
 * MRC, CDX Wayback par DOMAINE et catalogue SIG ArcGIS.
 *
 * Le programme n'effectue aucun fetch. Les JSON produits sont consommés par
 * k8s-capture-run.ts, donc chaque GET passe ensuite par capturedFetch sur le
 * cluster et devient une capture CAS auditée.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseCaptureWorklist, type CaptureWorklistTarget } from "../../packages/qc-sources/src/capture/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BILAN = resolve(ROOT, "work/coverage/bilan-4a-133-non-connues-20260728T134431Z.json");
const DEFAULT_OUT = resolve(ROOT, "acquisition/config");
const SOURCE = "normes-a-gisements-catalog";
const LOT_SIZE = 6;

interface TargetSeed {
  slug: string;
  name: string;
  website: string;
  mrcName: string | null;
  mrcPortals: string[];
}

const TARGETS: readonly TargetSeed[] = [
  { slug: "lislet", name: "L'Islet", website: "https://www.lislet.com", mrcName: "MRC de L'Islet", mrcPortals: ["https://mrclislet.com"] },
  { slug: "notre-dame-du-rosaire", name: "Notre-Dame-du-Rosaire", website: "https://www.notredamedurosaire.com", mrcName: "MRC de Montmagny", mrcPortals: ["https://www.montmagny.com"] },
  { slug: "saint-francois-de-la-riviere-du-sud", name: "Saint-François-de-la-Rivière-du-Sud", website: "https://www.stfrancois.ca", mrcName: "MRC de Montmagny", mrcPortals: ["https://www.montmagny.com"] },
  { slug: "batiscan", name: "Batiscan", website: "https://www.batiscan.ca", mrcName: "MRC des Chenaux", mrcPortals: ["https://www.mrcdeschenaux.ca"] },
  { slug: "gaspe", name: "Gaspé", website: "https://www.ville.gaspe.qc.ca", mrcName: "MRC de La Côte-de-Gaspé", mrcPortals: ["https://cotedegaspe.ca"] },
  {
    slug: "levis",
    name: "Lévis",
    website: "https://www.ville.levis.qc.ca",
    mrcName: "Agglomération de Lévis",
    mrcPortals: ["https://donneesouvertes.ville.levis.qc.ca"],
  },
  {
    slug: "petite-riviere-saint-francois",
    name: "Petite-Rivière-Saint-François",
    website: "https://www.petiteriviere.com",
    mrcName: "MRC de Charlevoix",
    mrcPortals: ["https://mrccharlevoix.ca"],
  },
  { slug: "pont-rouge", name: "Pont-Rouge", website: "https://www.ville.pontrouge.qc.ca", mrcName: "MRC de Portneuf", mrcPortals: ["https://portneuf.ca"] },
  {
    slug: "saint-benoit-labre",
    name: "Saint-Benoît-Labre",
    website: "https://www.saintbenoitlabre.com",
    mrcName: "MRC de Beauce-Sartigan",
    mrcPortals: ["https://www.mrcbeaucesartigan.com"],
  },
  {
    slug: "saint-bruno-de-montarville",
    name: "Saint-Bruno-de-Montarville",
    website: "https://www.stbruno.ca",
    mrcName: "Agglomération de Longueuil",
    mrcPortals: ["https://longueuil.quebec", "https://www.donneesquebec.ca"],
  },
  {
    slug: "saint-come-liniere",
    name: "Saint-Côme–Linière",
    website: "https://www.stcomeliniere.com",
    mrcName: "MRC de Beauce-Sartigan",
    mrcPortals: ["https://www.mrcbeaucesartigan.com"],
  },
  {
    slug: "saint-denis-de-la-bouteillerie",
    name: "Saint-Denis-De La Bouteillerie",
    website: "https://www.munstdenis.com",
    mrcName: "MRC de Kamouraska",
    mrcPortals: ["https://www.mrckamouraska.com"],
  },
  {
    slug: "saint-elie-de-caxton",
    name: "Saint-Élie-de-Caxton",
    website: "https://www.st-elie-de-caxton.ca",
    mrcName: "MRC de Maskinongé",
    mrcPortals: ["https://www.mrcmaskinonge.ca"],
  },
  { slug: "saint-ours", name: "Saint-Ours", website: "https://www.saintours.qc.ca", mrcName: "MRC de Pierre-De Saurel", mrcPortals: ["https://www.mrcpierredesaurel.com"] },
  { slug: "sutton", name: "Sutton", website: "https://www.sutton.ca", mrcName: "MRC de Brome-Missisquoi", mrcPortals: ["https://www.mrcbm.qc.ca"] },
  {
    slug: "tres-saint-redempteur",
    name: "Très-Saint-Rédempteur",
    website: "https://www.tressaintredempteur.ca",
    mrcName: "MRC de Vaudreuil-Soulanges",
    mrcPortals: ["https://mrcvs.ca"],
  },
  {
    slug: "saint-alphonse",
    name: "Saint-Alphonse",
    website: "https://www.st-alphonsegaspesie.com",
    mrcName: "MRC de Bonaventure",
    mrcPortals: ["https://mrcbonaventure.com"],
  },
] as const;

function origin(value: string): string {
  return new URL(value).origin;
}

function addUrl(urls: Set<string>, base: string, path: string): void {
  urls.add(new URL(path, `${origin(base)}/`).href);
}

function wpCatalogUrls(urls: Set<string>, base: string, ownerSearch: string): void {
  for (const search of ["zonage", "grille", "urbanisme", "reglement", "densite", ownerSearch]) {
    const url = new URL("/wp-json/wp/v2/media", `${origin(base)}/`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("search", search);
    urls.add(url.href);
  }
}

function discoveryUrls(target: TargetSeed): string[] {
  const urls = new Set<string>();
  wpCatalogUrls(urls, target.website, target.name);
  for (const path of ["/storage/app/media", "/sitemap.xml", "/sitemap_index.xml"]) {
    addUrl(urls, target.website, path);
  }

  for (const portal of target.mrcPortals) {
    urls.add(`${origin(portal)}/`);
    wpCatalogUrls(urls, portal, target.name);
    for (const path of [
      "/centre-documentaire/",
      "/documentation/",
      "/reglements/",
      "/municipalites/",
      "/sitemap.xml",
      "/sitemap_index.xml",
    ]) {
      addUrl(urls, portal, path);
    }
  }

  // Le portail Montmagny masque ses PV derrière JetSmartFilters. Le catalogue
  // WP REST paginé est le seul inventaire mesuré comme exhaustif.
  if (target.mrcPortals.some((portal) => origin(portal) === "https://www.montmagny.com")) {
    for (let page = 1; page <= 4; page++) {
      const url = new URL("/wp-json/wp/v2/media", "https://www.montmagny.com/");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      url.searchParams.set("search", "verbal");
      url.searchParams.set("mime_type", "application/pdf");
      urls.add(url.href);
    }
  }

  for (const base of [target.website, ...target.mrcPortals]) {
    const host = new URL(base).hostname.replace(/^www\./, "");
    const cdx = new URL("https://web.archive.org/cdx/search/cdx");
    cdx.searchParams.set("url", `${host}/*`);
    cdx.searchParams.set("matchType", "domain");
    cdx.searchParams.set("output", "json");
    cdx.searchParams.set("fl", "original,timestamp,statuscode,mimetype,digest,length");
    cdx.searchParams.append("filter", "statuscode:200");
    cdx.searchParams.set("collapse", "urlkey");
    cdx.searchParams.set("limit", "5000");
    urls.add(cdx.href);
  }

  for (const query of [target.name, target.mrcName].filter((value): value is string => value !== null)) {
    const arcgis = new URL("https://www.arcgis.com/sharing/rest/search");
    arcgis.searchParams.set("f", "json");
    arcgis.searchParams.set("num", "100");
    arcgis.searchParams.set("q", `"${query}" (zonage OR zoning OR grille OR densite)`);
    urls.add(arcgis.href);
  }
  return [...urls];
}

export function categoryAGisementsWorklists(): CaptureWorklistTarget[][] {
  const expected = (JSON.parse(readFileSync(BILAN, "utf8")) as {
    partitions?: { A?: { collections?: Array<{ slug?: unknown }> } };
  }).partitions?.A?.collections?.map((entry) => entry.slug) ?? [];
  const configured = TARGETS.map((target) => target.slug);
  if (JSON.stringify(expected) !== JSON.stringify(configured)) {
    throw new Error(`périmètre A différent du bilan: attendu=${expected.join(",")} configuré=${configured.join(",")}`);
  }
  const worklist = parseCaptureWorklist(TARGETS.map((target) => ({
    slug: target.slug,
    source: SOURCE,
    urls: discoveryUrls(target),
  })));
  return Array.from({ length: Math.ceil(worklist.length / LOT_SIZE) }, (_value, index) =>
    worklist.slice(index * LOT_SIZE, (index + 1) * LOT_SIZE));
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(): void {
  const outDir = resolve(option(process.argv.slice(2), "out-dir") ?? DEFAULT_OUT);
  if (!outDir.startsWith(`${ROOT}/`)) throw new Error("--out-dir doit rester dans le dépôt");
  mkdirSync(outDir, { recursive: true });
  const lots = categoryAGisementsWorklists();
  for (const [index, lot] of lots.entries()) {
    const path = resolve(
      outDir,
      `density-document-category-a-gisements-20260728-lot-${String(index + 1).padStart(2, "0")}.json`,
    );
    writeFileSync(path, `${JSON.stringify(lot, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${path.replace(`${ROOT}/`, "")}\t${lot.length}\t${lot.reduce((sum, target) => sum + target.urls.length, 0)} URL\n`);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

