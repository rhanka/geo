/**
 * _reglement-prov-set.ts — lane P0_1 (provenance règlement).
 *
 * Écrit UNE entrée curée dans acquisition/config/reglement-provenance.json en
 * préservant le formatage canonique du fichier (JSON 2-espaces). Refuse d'écrire
 * si le fichier n'est PAS déjà en forme canonique (sinon le diff toucherait tout
 * le registre) — dans ce cas, éditer à la main.
 *
 * Anti-invention: l'opérateur passe des valeurs VERBATIM relevées dans le document.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-prov-set.ts --check
 *   npx tsx acquisition/src/_reglement-prov-set.ts --slug <s> --numero <n> \
 *     --millesime <YYYY|null> --page <int|null> --url <url> --note "<verbatim>" --write
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function main(): void {
  const before = readFileSync(REGISTRY, "utf8");
  const obj = JSON.parse(before) as { $comment?: string; slugs: Record<string, Record<string, unknown>> };
  const canonical = JSON.stringify(obj, null, 2) + "\n";
  const isCanonical = before === canonical;
  console.log(`canonical=${isCanonical} (before=${before.length}o roundtrip=${canonical.length}o)`);
  if (process.argv.includes("--check")) return;
  if (!isCanonical) {
    console.error("REFUS: fichier non-canonique — éditer à la main pour un diff minimal.");
    process.exit(3);
  }
  const slug = arg("slug");
  if (!slug) { console.error("--slug requis"); process.exit(2); }
  // --show: relit l'entrée EXISTANTE. Indispensable quand plusieurs agents écrivent
  // dans le même arbre: le `DRY` ci-dessous n'affiche que ce qu'on VA écrire, jamais
  // ce que le registre porte déjà, donc il ne prouve rien sur l'état courant.
  if (process.argv.includes("--show")) {
    const cur = obj.slugs[slug];
    console.log(cur ? `${slug}: ${JSON.stringify(cur)}` : `${slug}: ABSENT du registre`);
    return;
  }
  const numeroRaw = arg("numero");
  const milRaw = arg("millesime");
  const pageRaw = arg("page");
  const url = arg("url");
  const note = arg("note");
  const numero = numeroRaw && numeroRaw !== "null" ? numeroRaw : null;
  const millesime = milRaw && milRaw !== "null" ? Number(milRaw) : null;
  const page = pageRaw && pageRaw !== "null" ? Number(pageRaw) : null;
  const entry = {
    reglement_numero: numero,
    reglement_millesime: millesime,
    reglement_page_source: page,
    reglement_url: url ?? null,
    _note: note ?? "",
  };
  obj.slugs[slug!] = entry;
  const out = JSON.stringify(obj, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    writeFileSync(REGISTRY, out, "utf8");
    console.log(`ÉCRIT ${slug}: numero=${numero} millesime=${millesime} page=${page}`);
  } else {
    console.log(`DRY ${slug}: ${JSON.stringify(entry)}`);
  }
}

main();
