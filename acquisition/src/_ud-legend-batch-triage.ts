/**
 * _ud-legend-batch-triage.ts — $0 read-only (lane usage_dominant). Pour chaque slug,
 * prend le PDF local le plus gros de `work/zonage-norms/<slug>/`, extrait le texte
 * via `pdftotext -layout` et rapporte:
 *   - le nombre de lignes de texte (0/1 => scan sans couche texte => NO-TEXT)
 *   - le nombre de lignes matchant le motif « légende » (vocation/fonction dominante,
 *     classification des zones, abréviation, division du territoire en zones)
 * Ne télécharge rien, n'écrit rien. Sert à router: LEGEND-HIT => lire; NO-TEXT => écarter.
 *
 *   npx tsx acquisition/src/_ud-legend-batch-triage.ts --slugs a,b,c
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORPUS = resolve(ROOT, "work", "zonage-norms");

const LEGEND_RE =
  /(fonction|vocation)\s+dominante|dominance|classification\s+des\s+zones|abr[ée]viation|divis[ée]\s+en\s+zones|division\s+du\s+territoire|identification\s+des\s+zones|appellation\s+des\s+zones|d[ée]signation\s+des\s+zones|codification\s+des\s+zones/i;

// Motif ÉLARGI (--wide): attrape les formulations de légende moins canoniques.
const WIDE_RE =
  /\bvocations?\b|usages?\s+dominants?|lettres?\s+d.\s?appellation|lettres?\s+suivantes|caract[èe]re\s+dominant|affectation\s+dominante|nomenclature\s+des\s+zones|type\s+de\s+zone|cat[ée]gories?\s+de\s+zones?/i;

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pdfsOf(slug: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 2048)
    .sort((a, b) => statSync(b).size - statSync(a).size);
}

const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slugs.length) {
  console.error("required: --slugs a,b");
  process.exit(2);
}
const maxPdfs = Number(arg("max-pdfs") ?? "2");

for (const slug of slugs) {
  const pdfs = pdfsOf(slug).slice(0, maxPdfs);
  if (!pdfs.length) {
    console.log(`${slug}: NO-PDF`);
    continue;
  }
  for (const pdf of pdfs) {
    const name = pdf.replace(ROOT + "/", "");
    let text = "";
    try {
      text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch {
      console.log(`${slug}: PDFTOTEXT-FAIL ${name}`);
      continue;
    }
    const lines = text.split("\n");
    if (lines.length <= 2) {
      console.log(`${slug}: NO-TEXT-LAYER ${name}`);
      continue;
    }
    const re = process.argv.includes("--wide") ? WIDE_RE : LEGEND_RE;
    const hits: number[] = [];
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i]!)) hits.push(i + 1);
    const tag = hits.length ? `LEGEND-HIT(${hits.length})` : "NO-LEGEND";
    console.log(`${slug}: ${tag} lines=${lines.length} ${name} L=${hits.slice(0, 12).join(",")}`);
  }
}
