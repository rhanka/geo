/**
 * _effet-retrait-cles-export.ts — la LISTE DES CLÉS d'un retrait d'effet.
 *
 * Annoncer « 85 effets retirés sur sutton » ne permet à personne de cibler une
 * purge : un consommateur a besoin des clés, pas d'un volume. immo l'a demandé
 * explicitement, et il a raison — c'est ma donnée, donc c'est à moi de fournir la
 * clé sur laquelle il peut agir.
 *
 * Émet la clé de jointure VALIDÉE par immo — {city_slug, zone_ref_canon_v1,
 * reglement_number} — pour chaque zone d'un artefact neutralisé, avec l'effet
 * qu'elle portait AVANT le retrait quand il est encore lisible.
 *
 * Lecture seule stricte. N'écrit qu'un rapport sous work/coverage/.
 *
 * Usage :
 *   npx tsx acquisition/src/_effet-retrait-cles-export.ts \
 *     --slug sutton --reglement 358 --effets-avant "48 stable, 27 densifie, 10 reduit"
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Entry { zone_code?: unknown; _neutralise?: unknown; [key: string]: unknown }

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const slug = valueOf(argv, "--slug");
  const reglement = valueOf(argv, "--reglement");
  if (slug === undefined || reglement === undefined) {
    throw new Error("usage: --slug <ville> --reglement <numero attribué> [--effets-avant <texte>]");
  }
  const entries = JSON.parse(
    readFileSync(`work/effet-densifiant/${slug}.json`, "utf8"),
  ) as Entry[];

  const reason = entries.find((e) => typeof e._neutralise === "string")?._neutralise ?? null;
  const keys = entries
    .map((e) => (typeof e.zone_code === "string" ? e.zone_code : null))
    .filter((z): z is string => z !== null);

  const report = {
    _note: "Cles des enregistrements dont l'effet densifiant a ete RETIRE de la production. La cle est celle validee par immo : {city_slug, zone_ref_canon_v1, reglement_number}. zone_ref_canon_v1 est ici le zone_code servi, forme canonique.",
    _generatedAt: new Date().toISOString(),
    city_slug: slug,
    reglement_number_attribue: reglement,
    motif_du_retrait: reason,
    effets_avant_retrait: valueOf(argv, "--effets-avant") ?? null,
    zones: keys.length,
    join_keys: keys.map((zone) => ({ city_slug: slug, zone_ref_canon_v1: zone, reglement_number: reglement })),
  };

  const path = `work/coverage/effet-retrait-cles-${slug}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${slug}: ${keys.length} clés -> ${path}`);
  console.log(`  échantillon: ${keys.slice(0, 6).join(", ")}`);
}

main();
