/**
 * naked-fetch-scan.ts — le SCANNER du gate « plus aucun `fetch()` nu ».
 *
 * SPEC_CAPTURE_ON_CLUSTER.md §5.1 : « un test de lib DOIT échouer si un fichier de
 * `acquisition/src/**` contient un `fetch(` nu hors du chokepoint. Sans ce gate, la
 * règle est un vœu. »
 *
 * Le compte actuel est FIGÉ dans `acquisition/config/naked-fetch-allowlist.json`
 * et ne peut que DÉCROÎTRE : la migration des ~73 fichiers est progressive, mais la
 * dette ne repousse pas. Le test qui l'oppose est `naked-fetch-gate.test.ts` ; le
 * script de régénération est `_capture-naked-fetch-scan.ts`.
 *
 * Pourquoi on dépouille commentaires et littéraux AVANT de compter : sans cela, la
 * simple PHRASE « plus aucun fetch() nu ici » dans un en-tête de fichier compterait
 * comme un appel. Un gate qui compte de la prose est un gate qui ment.
 * Limite assumée : une interpolation `${…}` d'un littéral gabarit est dépouillée
 * avec lui — un appel réseau caché là passerait ; aucun n'existe dans le dépôt.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * `fetch(` NU : ni `.fetch(` (méthode), ni `capturedFetch(` / `nodeFetch(`
 * (identifiant composé). C'est exactement l'appel au `fetch` global.
 */
export const NAKED_FETCH_PATTERN = "(?<![\\w.$])fetch\\s*\\(";

/** Retire commentaires (`//`, `/* *\/`) et littéraux (`'`, `"`, `` ` ``). */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Nombre d'appels `fetch(` nus dans un source TypeScript. */
export function countNakedFetch(src: string): number {
  const re = new RegExp(NAKED_FETCH_PATTERN, "g");
  return (stripCommentsAndStrings(src).match(re) ?? []).length;
}

/** Tous les `.ts` sous `dir` (récursif, `node_modules`/`dist` exclus). */
export function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d).sort()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith(".ts")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Les `.ts` SUIVIS PAR GIT sous `subdir` (contenu lu dans l'arbre de travail).
 *
 * Pourquoi git et pas un simple balayage : l'arbre de développement porte en
 * permanence des sondes `_*.ts` NON SUIVIES appartenant à d'autres lanes. Les
 * figer dans un registre committé reviendrait à graver le scratch de quelqu'un
 * d'autre, et le gate deviendrait dépendant de l'état local. Le gate garde ce qui
 * ENTRE dans le dépôt. Repli sur le balayage disque si git est indisponible.
 */
export function trackedTsFiles(repoRoot: string, subdir: string): string[] {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "ls-files", "-z", "--", subdir], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = out
      .split("\0")
      .filter((p) => p.endsWith(".ts"))
      .map((p) => resolve(repoRoot, p))
      .filter((p) => existsSync(p));
    if (files.length > 0) return files.sort();
  } catch {
    // git absent / hors dépôt : repli.
  }
  return listTsFiles(resolve(repoRoot, subdir));
}

export interface NakedFetchScan {
  /** chemin relatif au repo root → nombre d'occurrences (>0 seulement). */
  files: Record<string, number>;
  total: number;
  /** Nombre de fichiers portant au moins une occurrence. */
  fileCount: number;
}

/** Compte les `fetch(` nus dans `absFiles`, clés relatives à `repoRoot`. */
export function scanNakedFetch(absFiles: string[], repoRoot: string): NakedFetchScan {
  const files: Record<string, number> = {};
  let total = 0;
  for (const abs of absFiles) {
    const count = countNakedFetch(readFileSync(abs, "utf8"));
    if (count === 0) continue;
    files[relative(repoRoot, abs).split("\\").join("/")] = count;
    total += count;
  }
  return { files, total, fileCount: Object.keys(files).length };
}

/** Forme du registre committé qui FIGE la dette. */
export interface NakedFetchAllowlist {
  _doc: string;
  pattern: string;
  /** Sous-arbre balayé, relatif au repo root. */
  scanned: string;
  frozen_at: string;
  total: number;
  file_count: number;
  files: Record<string, number>;
}
