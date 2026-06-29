/**
 * Conversion du rapport de statut en DOCX avec un tableau SOIGNÉ.
 *
 * Utilise la lib `docx` (construction programmatique, contrôle total — pas
 * pandoc). Le tableau a : en-tête à fond bleu sentropic + texte blanc gras,
 * bordures `single` cohérentes, largeurs de colonnes lisibles, lignes alternées
 * (banding gris clair) pour la lisibilité, titre + date + résumé au-dessus.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import type { Coverage } from "./collect.js";
import { buildWpRows, execSummary, frDate, type WpRow } from "./markdown.js";

/** Palette sentropic. */
const BLUE = "1F4E79"; // en-tête (bleu sentropic foncé, lisible avec texte blanc)
const WHITE = "FFFFFF";
const BAND = "EEF3F8"; // banding gris-bleu très clair (lignes paires)
const ROW = "FFFFFF"; // lignes impaires
const BORDER = "B7C4D2"; // bordures discrètes cohérentes
const TEXT = "222222";

/** Largeurs relatives des 5 colonnes (en cinquantièmes de %, total = 5000). */
const COL_WIDTHS = [1500, 900, 700, 1300, 1100]; // Donnée | Munis OK | % | Méthode | État
const COL_HEADERS = ["Donnée", "Munis OK", "% province", "Méthode", "État"];

/** Une bordure single fine de la couleur donnée. */
function edge(color: string = BORDER) {
  return { style: BorderStyle.SINGLE, size: 4, color };
}

/** Jeu de bordures cohérentes (single) pour une cellule. */
function cellBorders(color: string = BORDER) {
  return {
    top: edge(color),
    bottom: edge(color),
    left: edge(color),
    right: edge(color),
  };
}

/** Cellule d'en-tête : fond bleu, texte blanc gras. */
function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: BLUE },
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders(BLUE),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: WHITE, size: 20 })],
      }),
    ],
  });
}

/** Cellule de corps : fond banded selon la parité de ligne. */
function bodyCell(text: string, widthPct: number, even: boolean): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: even ? BAND : ROW },
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders(),
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, color: TEXT, size: 19 })],
      }),
    ],
  });
}

function totalUnits(): number {
  return COL_WIDTHS.reduce((a, b) => a + b, 0);
}

/** Convertit une largeur relative en pourcentage de table. */
function widthPct(i: number): number {
  const w = COL_WIDTHS[i] ?? 1000;
  return Math.round((w / totalUnits()) * 10000) / 100; // 2 décimales
}

function buildTable(rows: WpRow[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: COL_HEADERS.map((h, i) => headerCell(h, widthPct(i))),
  });

  const bodyRows = rows.map((r, idx) => {
    const even = idx % 2 === 1; // bande 1 ligne sur 2 (la 2e, 4e…)
    const cells = [r.donnee, r.munisOk, r.pctProvince, r.methode, r.etat];
    return new TableRow({
      children: cells.map((c, i) => bodyCell(c, widthPct(i), even)),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: COL_WIDTHS,
    borders: {
      top: edge(),
      bottom: edge(),
      left: edge(),
      right: edge(),
      insideHorizontal: edge(),
      insideVertical: edge(),
    },
    rows: [headerRow, ...bodyRows],
  });
}

/** Paragraphe de titre H1. */
function title(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 120 },
    children: [new TextRun({ text, bold: true, color: BLUE, size: 36 })],
  });
}

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label} : `, bold: true, color: TEXT, size: 20 }),
      new TextRun({ text: value, color: TEXT, size: 20 }),
    ],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, color: BLUE, size: 26 })],
  });
}

/**
 * Convertit un fragment de markdown inline (**gras**, `code`) en TextRuns.
 * Minimal : suffit pour le résumé exécutif et les puces de détail.
 */
function inlineRuns(md: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: md.slice(last, m.index), color: TEXT, size: 20 }));
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      runs.push(new TextRun({ text: tok.slice(2, -2), bold: true, color: TEXT, size: 20 }));
    } else {
      runs.push(
        new TextRun({ text: tok.slice(1, -1), font: "Consolas", color: "1F4E79", size: 19 }),
      );
    }
    last = re.lastIndex;
  }
  if (last < md.length) {
    runs.push(new TextRun({ text: md.slice(last), color: TEXT, size: 20 }));
  }
  return runs;
}

function paragraph(md: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160, line: 276 },
    alignment: AlignmentType.JUSTIFIED,
    children: inlineRuns(md),
  });
}

function bullet(md: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: inlineRuns(md),
  });
}

/** Construit le document DOCX complet et retourne un Buffer. */
export async function renderDocx(cov: Coverage): Promise<Buffer> {
  const rows = buildWpRows(cov);
  const day = frDate(cov.collectedAt);

  const detailBullets: string[] = [
    `**Lots avec géométrie propre** — ${cov.cadastreLots} municipalités ; ${cov.cadastrePreclipBackups} ré-clippées à la frontière municipale (sauvegarde non-destructive \`-preclip\`).`,
    `**Lots avec attributs de bâtiment** — ${cov.roleFoncier} municipalités jointes au rôle foncier (CUBF, étages, année, superficie, valeur). Lots vacants nuls (anti-invention).`,
    `**Lots avec \`code_zone\`** — ${cov.zonageGridsWithZoneCode} grilles spatialisées sur ${cov.zonageGridsTotal} (échantillon ${cov.zonageGridsSampled}). Plafond du zonage ouvert (~26-29 munis).`,
    `**Lots avec normes** — ${cov.zonageNorms} jeu(x) de normes en production (Sherbrooke).`,
    `**Index zéro-copie immo** — ${cov.indexImmo} municipalités servies (no_lot → attributs + code_zone).`,
    `**Tuiles PMTiles** — ${cov.pmtiles} jeu(x) province : ${cov.pmtilesFiles.join(", ") || "—"}.`,
  ];

  const methodBullets: string[] = [
    "**Cadastre lots** — harvest du cadastre rénové (Données Québec), normalisé GeoJSON WGS84.",
    "**Clip frontière** — frontière SDA (MERN) + point-in-polygon ; retire la sur-capture d'emprise.",
    "**Rôle foncier** — parse XML (MAMH) + jointure `matricule = NO_LOT`.",
    "**Index immo** — `cadastre ⋈ rôle ⋈ code_zone` matérialisé en parquet zéro-copie.",
    "**Grilles zonage** — cascade AGOL / CKAN / MRC + extraction PDF / vision ; `code_zone` jamais inventé.",
    "**Normes** — parser texte (horizontales) + OCR-vision Mistral (verticales).",
    "**PMTiles** — Tippecanoe en job Scaleway (zéro charge locale).",
    "**PV / signaux** — scrapers de procès-verbaux `@geo/qc-sources`.",
  ];

  const doc = new Document({
    creator: "@geo/qc-status-report",
    title: "Rapport de statut — Données foncières Québec",
    description: "Statut de couverture provincial (collecte live S3, lecture seule).",
    styles: {
      default: { document: { run: { font: "Calibri", size: 20, color: TEXT } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } },
        },
        children: [
          title("Rapport de statut — Données foncières Québec"),
          metaLine("Date", day),
          metaLine(
            "Périmètre",
            "couverture provinciale du socle géo Québec (cadastre, rôle foncier, zonage, normes, tuiles)",
          ),
          metaLine("Source des chiffres", "collecte LIVE depuis le stockage objet (lecture seule)"),
          h2("Résumé exécutif"),
          paragraph(execSummary(cov)),
          h2("Lots de travail — couverture"),
          buildTable(rows),
          h2("Couverture détaillée par type de donnée × fiabilité"),
          ...detailBullets.map(bullet),
          h2("Méthodes d'acquisition"),
          ...methodBullets.map(bullet),
          new Paragraph({
            spacing: { before: 240 },
            children: [
              new TextRun({
                text: `Rapport généré automatiquement le ${day} par @geo/qc-status-report — chiffres collectés en direct, idempotent, sans secret ni écriture S3.`,
                italics: true,
                color: "6A6A6A",
                size: 17,
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
