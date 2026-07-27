/**
 * _effet-source-url-fix.ts — corriger l'URL citée dans un artefact d'effet.
 *
 * Un artefact d'effet densifiant a été déposé en production en citant, pour son
 * état AVANT, un document qui ne déclare pas le règlement qu'on lui attribuait.
 * Le dépôt a été retiré. Les VALEURS, elles, ont été relues indépendamment et
 * concordent ; c'est la seule URL qui était fausse.
 *
 * Cette passe substitue l'URL, et rien d'autre. Elle REFUSE si l'URL attendue
 * n'est pas présente partout où elle doit l'être : réécrire une citation sans
 * vérifier ce qu'on remplace serait reproduire la faute d'origine dans l'autre
 * sens.
 *
 * Usage :
 *   npx tsx acquisition/src/_effet-source-url-fix.ts <artefact.json> \
 *     --champ source_avant --de <url-fausse> --vers <url-verifiee> [--apply]
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Entry { zone_code?: unknown; source_avant?: unknown; source_apres?: unknown; [k: string]: unknown }

function value(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const [path] = argv;
  const field = value(argv, "--champ");
  const from = value(argv, "--de");
  const to = value(argv, "--vers");
  const apply = argv.includes("--apply");
  if (path === undefined || field === undefined || from === undefined || to === undefined) {
    throw new Error("usage: <artefact.json> --champ <source_avant|source_apres> --de <url> --vers <url> [--apply]");
  }
  if (field !== "source_avant" && field !== "source_apres") throw new Error(`champ inattendu: ${field}`);

  const entries = JSON.parse(readFileSync(path, "utf8")) as Entry[];
  if (!Array.isArray(entries)) throw new Error("artefact: tableau JSON attendu");

  const missing = entries.filter((e) => typeof e[field] !== "string" || !(e[field] as string).includes(from));
  if (missing.length > 0) {
    // Refus explicite : si l'URL a remplacer n'est pas partout, l'artefact n'est
    // pas celui qu'on croit et la substitution serait aveugle.
    throw new Error(
      `REFUS: ${missing.length}/${entries.length} entrées ne contiennent pas l'URL attendue dans ${field} ` +
      `(première: ${String(missing[0]?.zone_code)})`,
    );
  }

  const patched = entries.map((e) => ({ ...e, [field]: (e[field] as string).split(from).join(to) }));
  console.log(`${entries.length} entrées · ${field} · ${from}\n  -> ${to}`);
  console.log(`exemple: ${String(patched[0]?.[field]).slice(0, 160)}`);
  if (!apply) {
    console.log("\n(dry-run — relancer avec --apply pour écrire)");
    return;
  }
  writeFileSync(path, `${JSON.stringify(patched, null, 2)}\n`);
  console.log(`\nécrit: ${path}`);
}

main();
