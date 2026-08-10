/**
 * _vplus-tree-grep.ts — lane P0_1 (provenance règlement), READ-ONLY, $0.
 *
 * Les portails VPlus/Modellium servent une COQUILLE SPA (~2630 octets) à la place
 * des PDF: toute lecture directe de la page publique est un faux négatif
 * ([[vplus-modellium-portal-lane]]). Le contenu réel s'obtient par l'API:
 *   https://vplus.modellium.com/api/<hostname>/structure/tree?localisation=fr
 *   https://vplus.modellium.com/api/<hostname>/structure/detail/<GUID>?inStructure=true&localisation=fr
 *
 * Ce script grep l'arbre JSON déjà téléchargé ou déposé sur S3 et imprime les noeuds dont le titre
 * matche, AVEC leur GUID — c'est le GUID qu'il faut passer à /structure/detail
 * pour obtenir le HTML porteur des liens S3 du bucket vplus-documents.
 *
 * ANTI-INVENTION: n'extrait aucun numéro, ne décide rien, n'écrit rien.
 *
 * Usage:
 *   npx tsx acquisition/src/_vplus-tree-grep.ts <tree.json> [motif ...]
 *   npx tsx acquisition/src/_vplus-tree-grep.ts --s3-key raw/.../tree.json [motif ...]
 * Sans motif: zonage|urbanisme|reglement (défaut).
 * La variante --s3-key lit l'objet en mémoire; elle ne crée aucune capture locale.
 */
import { readFileSync } from "node:fs";
import { getBytes, s3Client } from "./lib/s3.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Descend n'importe quelle forme d'arbre et rend {titre, guid, chemin}. */
function walk(
  node: unknown,
  path: string[],
  out: Array<{ titre: string; guid: string | null; chemin: string }>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, path, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;

  let titre = "";
  for (const k of ["titre", "title", "nom", "name", "libelle", "label", "text"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) { titre = v.trim(); break; }
  }
  let guid: string | null = null;
  for (const k of ["guid", "id", "identifiant", "structureId", "Id", "GUID"]) {
    const v = rec[k];
    if (typeof v === "string" && GUID_RE.test(v)) { guid = v; break; }
  }
  const nextPath = titre ? [...path, titre] : path;
  if (titre) out.push({ titre, guid, chemin: nextPath.join(" > ") });

  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") walk(v, nextPath, out);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const s3KeyIndex = args.indexOf("--s3-key");
  const s3Key = s3KeyIndex === -1 ? undefined : args[s3KeyIndex + 1];
  if (s3KeyIndex !== -1 && !s3Key) {
    console.error("usage: _vplus-tree-grep.ts --s3-key <key> [motif ...]");
    process.exit(2);
  }
  const remaining = s3KeyIndex === -1
    ? args
    : [...args.slice(0, s3KeyIndex), ...args.slice(s3KeyIndex + 2)];
  const file = s3Key ? undefined : remaining[0];
  const motifs = s3Key ? remaining : remaining.slice(1);
  if (!file && !s3Key) {
    console.error("usage: _vplus-tree-grep.ts <tree.json> [motif ...] | --s3-key <key> [motif ...]");
    process.exit(2);
  }
  const pats = (motifs.length ? motifs : ["zonage", "urbanisme", "reglement"]).map(norm);

  const out: Array<{ titre: string; guid: string | null; chemin: string }> = [];
  const source = s3Key
    ? (await getBytes(s3Client(), s3Key)).toString("utf8")
    : readFileSync(file!, "utf8");
  walk(JSON.parse(source), [], out);

  const seen = new Set<string>();
  let n = 0;
  for (const e of out) {
    const key = `${e.guid ?? ""}|${e.chemin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!pats.some((p) => norm(e.chemin).includes(p))) continue;
    n += 1;
    console.log(`${e.guid ?? "(sans-guid)"}\t${e.chemin}`);
  }
  console.log(`# noeuds=${out.length} retenus=${n} motifs=${pats.join("|")}`);
  console.log("# detail: https://vplus.modellium.com/api/<host>/structure/detail/<GUID>?inStructure=true&localisation=fr");
}

void main();
