/**
 * _pdf-page-text.ts — rendre le texte d'une page AVEC sa mise en page.
 *
 * `_pdf-grep-reglement.ts` cherche dans les flux décompressés et a un angle mort
 * démontré : un trait d'union ou un chiffre dessiné comme opérateur PDF séparé
 * fait rendre ZÉRO occurrence sur un document qui porte le motif. Quand une
 * recherche négative doit devenir un CONSTAT, il faut lire la page en clair.
 *
 * Enveloppe `pdftotext -layout` sur une plage de pages et filtre éventuellement
 * les lignes. Aucun réseau, aucun S3 : opère sur un fichier local.
 *
 * Usage :
 *   npx tsx acquisition/src/_pdf-page-text.ts <fichier.pdf> --pages 1-3 [--grep <motif>]
 */
import { execFileSync } from "node:child_process";

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const file = argv[0];
  if (file === undefined || file.startsWith("--")) throw new Error("usage: <fichier.pdf> --pages 1-3 [--grep <motif>]");
  const pages = valueOf(argv, "--pages") ?? "1-1";
  const match = /^(\d+)-(\d+)$/.exec(pages);
  if (match === null) throw new Error(`--pages invalide: ${pages} (attendu N-M)`);
  const grep = valueOf(argv, "--grep");

  const text = execFileSync(
    "pdftotext",
    ["-layout", "-f", match[1]!, "-l", match[2]!, file, "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  // Le filtre est insensible a la casse ET aux accents, parce qu'un « règlement »
  // sort tantot accentue, tantot non, selon la police du document.
  const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const kept = grep === undefined ? lines : lines.filter((line) => fold(line).includes(fold(grep)));
  for (const line of kept.slice(0, 40)) console.log(line.trimEnd());
  console.log(`\n[${kept.length} ligne(s) retenue(s) sur ${lines.length}, pages ${pages}]`);
}

main();
