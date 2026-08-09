/**
 * _effet-neutralise-artefact.ts — désarmer un artefact d'effet RÉFUTÉ.
 *
 * Retirer un effet de la production ne suffit pas : son artefact reste sur
 * disque, et un simple `fold-effet-densifiant --slug <ville>` le rétablit. Pour
 * `sutton`, ce serait redéposer 85 effets fondés sur un document qui déclare
 * « Projet de Règlement de zonage numéro xxxx » — un projet, sans force légale.
 *
 * Le garde-fou de `readEntries` ne l'attrape PAS : il lit la chaîne de la
 * citation, et celle-ci dit « 358 Annexe B p.19 … » sans jamais prononcer le mot
 * projet. Le vice est dans le DOCUMENT, pas dans le texte de la citation.
 *
 * Cette passe met donc chaque entrée à `inconnu` avec des compteurs `null` :
 * l'artefact reste lisible et traçable, mais il ne peut plus affirmer quoi que
 * ce soit. `inconnu` est une abstention explicite — « on a regardé, on ne sait
 * pas » — et c'est exactement l'état de vérité ici.
 *
 * Usage :
 *   npx tsx acquisition/src/_effet-neutralise-artefact.ts <artefact.json> \
 *     --raison "<pourquoi>" [--apply]
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Entry { zone_code?: unknown; effet_densifiant?: unknown; [key: string]: unknown }

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const path = argv[0];
  const reason = valueOf(argv, "--raison");
  const apply = argv.includes("--apply");
  if (path === undefined || path.startsWith("--") || reason === undefined) {
    throw new Error('usage: <artefact.json> --raison "<pourquoi>" [--apply]');
  }

  const entries = JSON.parse(readFileSync(path, "utf8")) as Entry[];
  if (!Array.isArray(entries)) throw new Error("artefact: tableau JSON attendu");

  const before = entries.reduce<Record<string, number>>((acc, e) => {
    const key = String(e.effet_densifiant);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const neutralised = entries.map((entry) => ({
    ...entry,
    densite_avant: null,
    densite_apres: null,
    effet_densifiant: "inconnu",
    effet_densifiant_delta: null,
    // La citation d'origine part avec l'affirmation — la garder donnerait a un
    // relecteur l'impression qu'une preuve subsiste. Mais la VIDER est pire : le
    // schema du rollup exige une chaine non vide, et surtout un champ blanc ne
    // dit pas POURQUOI il n'y a plus de preuve. On y ecrit donc le motif du
    // retrait, qui est la seule chose vraie qu'on puisse mettre a cet endroit.
    source_avant: `RETIRÉ — ${reason}`,
    source_apres: `RETIRÉ — ${reason}`,
    _neutralise: reason,
  }));

  console.log(JSON.stringify({ path, entrees: entries.length, avant: before, raison: reason }, null, 1));
  if (!apply) {
    console.log("\n(dry-run — relancer avec --apply pour écrire)");
    return;
  }
  writeFileSync(path, `${JSON.stringify(neutralised, null, 2)}\n`);
  console.log(`\nécrit: ${path} — ${neutralised.length} entrées à 'inconnu'`);
}

main();
