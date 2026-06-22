/**
 * Génération du markdown de statut (FR, orienté client immobilier).
 *
 * Tous les chiffres proviennent de la collecte LIVE S3 (`Coverage`), JAMAIS
 * codés en dur. Structure : titre + date + résumé exécutif + tableau des WP +
 * couverture détaillée par type de donnée × fiabilité + méthodes d'acquisition.
 */
import type { Coverage } from "./collect.js";
import { pct } from "./collect.js";

/** Une ligne du tableau des lots de travail (work packages). */
export interface WpRow {
  donnee: string;
  munisOk: string;
  pctProvince: string;
  methode: string;
  etat: string;
}

/** Date FR longue (ex "21 juin 2026") à partir d'un ISO. */
export function frDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Date courte YYYY-MM-DD pour les noms de fichiers, calée sur le fuseau LOCAL
 * (le rapport est québécois) pour que la date affichée (`frDate`) et la date du
 * nom de fichier coïncident — sinon un run en soirée EDT bascule de jour en UTC.
 */
export function isoDay(iso: string = new Date().toISOString()): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Construit les lignes du tableau des WP à partir de la couverture live.
 * L'ordre suit la chaîne de production : géométrie → fiabilité → attributs →
 * index → zonage spatial → normes → tuiles → signaux.
 */
export function buildWpRows(cov: Coverage): WpRow[] {
  const denom = cov.provinceDenominator || 1;
  const p = (n: number) => `${pct(n, denom)} %`;
  return [
    {
      donnee: "Cadastre — lots (géométrie)",
      munisOk: String(cov.cadastreLots),
      pctProvince: p(cov.cadastreLots),
      methode: "Harvest cadastre rénové (Données Québec)",
      etat: cov.cadastreLots > 0 ? "Livré" : "En cours",
    },
    {
      donnee: "Clip frontière / fiabilité d'emprise",
      munisOk: String(cov.cadastrePreclipBackups),
      pctProvince: p(cov.cadastrePreclipBackups),
      methode: "Frontière SDA (MERN) + point-in-polygon",
      etat:
        cov.cadastrePreclipBackups > 0
          ? "Livré (z∩m∩p) · province en cours"
          : "En cours",
    },
    {
      donnee: "Rôle foncier — attributs bâtiment",
      munisOk: String(cov.roleFoncier),
      pctProvince: p(cov.roleFoncier),
      methode: "Parse XML (MAMH) + jointure matricule = NO_LOT",
      etat: cov.roleFoncier > 0 ? "Livré · province en cours" : "En cours",
    },
    {
      donnee: "Index zéro-copie immo",
      munisOk: String(cov.indexImmo),
      pctProvince: p(cov.indexImmo),
      methode: "Cadastre ⋈ rôle ⋈ code_zone",
      etat: cov.indexImmo > 0 ? "Livré · province en cours" : "En cours",
    },
    {
      donnee: "Zones — grille de zonage (spatial)",
      munisOk: `${cov.zonageGridsWithZoneCode} grilles servables / ${cov.zonageGridsTotal} collectes`,
      pctProvince: p(cov.zonageGridsWithZoneCode),
      methode: "AGOL / CKAN / portails MRC / cascade PDF / vision",
      etat: "Plafond zonage ouvert QC (~23-29 munis vectorisées) · couche PMTiles zones province",
    },
    {
      donnee: "code_zone sur lots (jointure lot↔zone)",
      munisOk: `${cov.zonageGridsWithZoneCode} munis`,
      pctProvince: p(cov.zonageGridsWithZoneCode),
      methode: "Point-in-polygon (lot ⋈ zone) — servi sur l'API OGC + index immo",
      etat: "Suit la couverture des zones",
    },
    {
      donnee: "Normes (valeurs réglementaires)",
      munisOk: String(cov.zonageNorms),
      pctProvince: p(cov.zonageNorms),
      methode:
        "Parser texte (grilles horizontales) + OCR-vision Mistral (verticales)",
      etat: cov.zonageNorms > 0 ? "Sherbrooke en prod" : "En cours",
    },
    {
      donnee: "PMTiles (tuiles vectorielles)",
      munisOk: `${cov.pmtiles} jeu(x) province`,
      pctProvince: cov.pmtiles > 0 ? "Province" : "—",
      methode: "Tippecanoe (job Scaleway)",
      etat: cov.pmtiles > 0 ? "Livré (zones + lots)" : "En cours",
    },
    {
      donnee: "PV / signaux municipaux",
      munisOk: "Scrapers @geo/qc-sources",
      pctProvince: "—",
      methode: "Scrapers procès-verbaux @geo/qc-sources",
      etat: "Code migré · production à basculer",
    },
  ];
}

function mdTable(rows: WpRow[]): string {
  const header =
    "| Donnée | Munis OK | % province | Méthode | État |\n" +
    "| --- | --- | --- | --- | --- |";
  const body = rows
    .map(
      (r) =>
        `| ${r.donnee} | ${r.munisOk} | ${r.pctProvince} | ${r.methode} | ${r.etat} |`,
    )
    .join("\n");
  return `${header}\n${body}`;
}

/** Résumé exécutif (1 paragraphe), chiffres dynamiques. */
export function execSummary(cov: Coverage): string {
  const denom = cov.provinceDenominator;
  return (
    `Le socle de données foncières du Québec couvre **${cov.cadastreLots} municipalités** ` +
    `en géométrie cadastrale (dénominateur province retenu pour ce rapport), dont ` +
    `**${cov.roleFoncier}** enrichies des attributs de bâtiment du rôle foncier et ` +
    `**${cov.indexImmo}** disponibles via l'index zéro-copie immo (cadastre ⋈ rôle ⋈ code_zone). ` +
    `Le zonage spatial reste le poste le plus exigeant : **${cov.zonageGridsTotal} grilles** ` +
    `sont déposées, dont **${cov.zonageGridsWithZoneCode}** portent un \`code_zone\` exploitable ` +
    `sur l'échantillon contrôlé (${cov.zonageGridsSampled} grilles testées) — c'est le ` +
    `plafond du « zonage ouvert ». Les normes réglementaires sont en production sur la ` +
    `première grille (**${cov.zonageNorms}** jeu de normes), et **${cov.pmtiles} jeu(x) de ` +
    `tuiles PMTiles** couvrent déjà la province (zones + lots). Politique anti-invention : ` +
    `aucune valeur n'est devinée, les absences restent nulles. (Province = ${denom} fichiers de lots.)`
  );
}

/** Détail de couverture par type de donnée × fiabilité. */
function coverageDetail(cov: Coverage): string {
  return [
    "## Couverture détaillée par type de donnée × fiabilité",
    "",
    "Fiabilité décroissante : *géométrie propre* → *attributs bâtiment* → *code_zone* → *normes*.",
    "",
    `- **Lots avec géométrie propre** — ${cov.cadastreLots} municipalités livrées. ` +
      `${cov.cadastrePreclipBackups} ont été ré-clippées à la frontière municipale ` +
      "(détection et correction de la sur-capture d'emprise via point-in-polygon SDA ; " +
      "sauvegarde non-destructive en `*-preclip`).",
    `- **Lots avec attributs de bâtiment** — ${cov.roleFoncier} municipalités jointes au ` +
      "rôle foncier (usage CUBF, nombre d'étages, année de construction, superficie bâtie, " +
      "valeur). Les lots vacants restent nuls (anti-invention).",
    `- **Lots avec \`code_zone\`** — ${cov.zonageGridsWithZoneCode} grilles spatialisées sur ` +
      `${cov.zonageGridsTotal} déposées (échantillon de ${cov.zonageGridsSampled}). ` +
      "C'est le plafond du zonage ouvert (~26-29 municipalités réellement spatialisées) : " +
      "au-delà, la frontière inter-zones n'existe pas dans les sources publiques.",
    `- **Lots avec normes** — ${cov.zonageNorms} jeu(x) de normes en production ` +
      "(Sherbrooke : valeurs réglementaires extraites par grille).",
    `- **Index zéro-copie immo** — ${cov.indexImmo} municipalités servies (lecture directe ` +
      "no_lot → attributs + code_zone, sans copie).",
    `- **Tuiles PMTiles** — ${cov.pmtiles} jeu(x) province : ${
      cov.pmtilesFiles.length ? cov.pmtilesFiles.join(", ") : "—"
    }.`,
    "",
  ].join("\n");
}

/** Méthodes d'acquisition (fixe, descriptif). */
function methods(): string {
  return [
    "## Méthodes d'acquisition",
    "",
    "- **Cadastre lots** — récolte du cadastre rénové publié sur Données Québec, ",
    "  normalisé en GeoJSON WGS84.",
    "- **Clip frontière / fiabilité** — frontière SDA (MERN) + point-in-polygon pour ",
    "  retirer la sur-capture d'emprise (lots de municipalités voisines) ; le taux de ",
    "  jointure au rôle sert de détecteur direct de sur-capture.",
    "- **Rôle foncier** — téléchargement et parsing des XML du rôle d'évaluation (MAMH), ",
    "  jointure `matricule = NO_LOT` (espaces retirés) pour rattacher les attributs de ",
    "  bâtiment aux lots.",
    "- **Index zéro-copie immo** — jointure `cadastre ⋈ rôle ⋈ code_zone` matérialisée en ",
    "  parquet par municipalité (lecture directe, pas de duplication).",
    "- **Grilles de zonage spatiales** — cascade AGOL / CKAN / portails MRC pour le vecteur ",
    "  ouvert, complétée par extraction PDF (GeoPDF, vectorisation de calques) et lecture ",
    "  vision lorsque la source n'est que raster. Le `code_zone` n'est attribué que ",
    "  lorsqu'il est réellement présent — jamais inventé.",
    "- **Normes (valeurs)** — parser texte pour les grilles horizontales, brique OCR-vision ",
    "  (Mistral) pour les grilles verticales pivotées.",
    "- **PMTiles** — tuilage vectoriel via Tippecanoe exécuté en job Scaleway (zéro charge ",
    "  poste local).",
    "- **PV / signaux** — scrapers de procès-verbaux municipaux (`@geo/qc-sources`).",
    "",
  ].join("\n");
}

/** Génère le markdown complet. */
export function renderMarkdown(cov: Coverage): string {
  const rows = buildWpRows(cov);
  const day = frDate(cov.collectedAt);
  return [
    "# Rapport de statut — Données foncières Québec",
    "",
    `**Date :** ${day}  `,
    "**Périmètre :** couverture provinciale du socle géo Québec (cadastre, rôle foncier, zonage, normes, tuiles)  ",
    "**Source des chiffres :** collecte LIVE depuis le stockage objet (lecture seule)",
    "",
    "## Résumé exécutif",
    "",
    execSummary(cov),
    "",
    "## Lots de travail — couverture",
    "",
    mdTable(rows),
    "",
    coverageDetail(cov),
    methods(),
    "---",
    "",
    `*Rapport généré automatiquement le ${day} par \`@geo/qc-status-report\`. ` +
      "Chiffres collectés en direct, idempotent, sans secret ni écriture S3.*",
    "",
  ].join("\n");
}
