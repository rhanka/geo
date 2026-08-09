/**
 * Gate $0 d'IDENTITÉ DOCUMENTAIRE d'un PDF candidat au recalage zones.
 *
 * Motivation (mesurée le 2026-07-20, shard 0/1) : la qualité géométrique du géoréf est
 * ORTHOGONALE à l'identité du document. Sur 5 slugs, la chaîne avait produit des GCP
 * parfaitement gatés — jusqu'à un géoréf EMBARQUÉ à 0,09 m de résidu — sur :
 *   - un AVIS PUBLIC (saint-robert)          - une TABLE DES MATIÈRES (hebertville)
 *   - un SCHÉMA D'AMÉNAGEMENT de MRC (labelle, planche SAD : les nombres imprimés
 *     sont des numéros de LOTS, pas des codes de zone)
 *   - le plan d'un TERRITOIRE NON ORGANISÉ de MRC (la-dore : la muni cible n'y est
 *     qu'une voisine étiquetée)
 *   - un extrait cadastral MRC « sans valeur légale » (notre-dame-de-ham)
 * Ni le résidu, ni le holdout, ni le nombre de GCP `independent` ne voient rien de tout
 * cela : ils sont auto-référentiels. Ce gate lit la COUCHE TEXTE et cherche les marqueurs.
 *
 * ⚠️ Ce gate est un FILTRE, pas une preuve. Il ne remplace PAS le fait de rendre la page
 * et de la REGARDER (une carte de localisation sans zones ne porte aucun marqueur et
 * passe ce gate — cas saint-adelphe). Un verdict OK signifie « rien de disqualifiant
 * trouvé », jamais « c'est bien un plan de zonage ».
 *
 * Usage :
 *   npx tsx acquisition/src/zones-doc-identity-gate.ts --pdf <f.pdf> --slug <slug> [--pages 4] [--json]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const pdf = arg("pdf");
const slug = arg("slug");
const nPages = Number(arg("pages", "4"));
if (!pdf || !slug) throw new Error("required: --pdf <file.pdf> --slug <slug>");
if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);

/** Marqueurs DISQUALIFIANTS, chacun adossé au cas réel qui l'a révélé. */
const DISQUALIFIERS: Array<{ re: RegExp; why: string; evidence: string }> = [
  { re: /avis\s+public/i, why: "AVIS-PUBLIC", evidence: "saint-robert" },
  { re: /table\s+des\s+mati[eè]res/i, why: "TABLE-DES-MATIERES", evidence: "hebertville" },
  { re: /sch[eé]ma\s+d[’']?\s*am[eé]nagement/i, why: "SAD-REGIONAL", evidence: "labelle" },
  { re: /territoire\s+non\s+organis[eé]|\bTNO\b/i, why: "TNO-MRC", evidence: "la-dore" },
  { re: /sans\s+valeur\s+l[eé]gale/i, why: "SANS-VALEUR-LEGALE", evidence: "notre-dame-de-ham" },
  { re: /\bPMAD\b|plan\s+m[eé]tropolitain/i, why: "PMAD", evidence: "§2.4 liste de rejet" },
  { re: /proc[eè]s[-\s]verbal/i, why: "PROCES-VERBAL", evidence: "§2.4 mauvais document" },
];

/**
 * ⛔ Les slugs sont désaccentués, les documents NON (`Saint-Valérien-de-Milton`). Comparer
 * les deux tels quels fait manquer la muni et rend un « SUSPECT » sur un plan parfaitement
 * valide — mesuré sur saint-valerien-de-milton, pourtant servi à 89 % de couverture-lots.
 * Même famille que le point aveugle sur l'apostrophe typographique : on compare des formes
 * NORMALISÉES des deux côtés.
 */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Le nom de muni écrit sur un plan : `saint-jean-de-matha` → /saint[-\s]jean[-\s]de[-\s]matha/i */
function slugToNameRegex(s: string): RegExp {
  const body = s
    .replace(/--\d+$/, "")
    .split("--")[0]!
    .split("-")
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    // d'/l' sont écrits collés ou avec apostrophe typographique selon les documents
    .map((w) => (/^(d|l)$/i.test(w) ? `${w}['’]?` : w))
    .join("[-\\s'’]*");
  return new RegExp(body, "i");
}

function pdfText(path: string, last: number): string {
  try {
    return execFileSync("pdftotext", ["-f", "1", "-l", String(last), path, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

const text = pdfText(pdf, nPages);
const normText = deaccent(text);
const nameRe = slugToNameRegex(slug);
const namesMuni = nameRe.test(normText);
const hits = DISQUALIFIERS.filter((d) => d.re.test(normText));

// Une couche texte vide n'est PAS un verdict : un plan-glyphes est légitime.
const noTextLayer = text.trim().length < 40;

const verdict = hits.length > 0 ? "REJET" : noTextLayer ? "INDETERMINE" : namesMuni ? "OK" : "SUSPECT";
const reason =
  hits.length > 0
    ? `marqueur(s) disqualifiant(s) : ${hits.map((h) => `${h.why} (revele par ${h.evidence})`).join(" · ")}`
    : noTextLayer
      ? "aucune couche texte exploitable — plan-glyphes possible et legitime ; RENDRE ET REGARDER la page"
      : namesMuni
        ? "le document nomme la municipalite cible et ne porte aucun marqueur disqualifiant"
        : `le document ne NOMME PAS « ${slug} » dans ses ${nPages} premieres pages — suspecter l'homonyme ou un document regional`;

const out = { pdf, slug, pages_scanned: nPages, verdict, reason, names_muni: namesMuni, disqualifiers: hits.map((h) => h.why) };

if (has("json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`[doc-identity] ${slug} :: ${verdict}`);
  console.log(`  pdf    ${pdf}`);
  console.log(`  raison ${reason}`);
  console.log(
    `  ⚠️ FILTRE, PAS PREUVE : un « OK » veut dire « rien de disqualifiant trouve », jamais « c'est un plan de zonage ». RENDS la page et REGARDE-la.`,
  );
}
process.exit(verdict === "REJET" ? 2 : 0);
