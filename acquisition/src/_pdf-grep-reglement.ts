/**
 * _pdf-grep-reglement.ts — quel RÈGLEMENT ce PDF porte-t-il, verbatim ?
 *
 * Sert à trancher une confusion de source : un état « avant » cité depuis le
 * document « après » produit un effet densifiant comparé à lui-même, donc
 * `stable` par construction et sans valeur. La seule façon de le savoir est de
 * lire le numéro de règlement DANS les octets du document.
 *
 * Décompresse les flux FlateDecode et cherche les motifs demandés dans le texte
 * obtenu. Ne conclut rien : elle rapporte les occurrences et leur contexte pour
 * qu'on lise soi-même.
 *
 * Aucun réseau, aucun S3 : opère sur des fichiers locaux déjà téléchargés.
 *
 * Usage :
 *   npx tsx acquisition/src/_pdf-grep-reglement.ts <fichier.pdf> <motif> [motif…]
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Texte lisible d'un PDF : flux decompresses + octets bruts en repli. */
function extractText(bytes: Buffer): string {
  const chunks: string[] = [bytes.toString("latin1")];
  const raw = bytes.toString("latin1");
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      chunks.push(inflateSync(bytes.subarray(start, end)).toString("latin1"));
    } catch {
      // Flux non deflate ou tronque : on l'ignore plutot que d'inventer un texte.
    }
  }
  return chunks.join("\n");
}

function main(): void {
  const [file, ...patterns] = process.argv.slice(2);
  if (file === undefined || patterns.length === 0) {
    throw new Error("usage: <fichier.pdf> <motif> [motif…]");
  }
  const text = extractText(readFileSync(file));
  // Les PDF coupent souvent les chaines par des operateurs de positionnement :
  // on retire ce bruit avant de chercher, sans toucher aux chiffres ni aux tirets.
  const flat = text.replace(/\)\s*-?\d+(\.\d+)?\s*\(/g, "").replace(/[\\()]/g, "");
  for (const pattern of patterns) {
    const hits = [...flat.matchAll(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))];
    console.log(`${file}  « ${pattern} »  occurrences=${hits.length}`);
    for (const hit of hits.slice(0, 3)) {
      const from = Math.max(0, (hit.index ?? 0) - 70);
      console.log(`   …${flat.slice(from, (hit.index ?? 0) + 70).replace(/\s+/g, " ")}…`);
    }
  }
}

main();
