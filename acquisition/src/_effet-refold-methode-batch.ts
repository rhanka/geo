/**
 * _effet-refold-methode-batch.ts — re-plie l'effet densifiant sur les villes déjà
 * pliées, pour y faire descendre les trois champs que le fold jetait :
 * `effet_densifiant_methode`, `densite_avant_source`, `densite_apres_source`.
 *
 * POURQUOI : 80 des 224 deltas des artefacts sont `deduit` (inférés des classes
 * d'habitation autorisées) et non `explicit` (lus dans une colonne de grille).
 * Servir le verdict sans sa méthode ni sa citation à la page rendait les deux
 * indiscernables chez le consommateur — qui annote des procès-verbaux.
 *
 * LA CONFIG EST RÉCUPÉRÉE DES OCTETS SERVIS, PAS DEVINÉE. Le fold exige
 * `--old-reglement/--new-reglement/--old-millesime/--new-millesime`, valeurs que
 * la passe précédente a déjà écrites sur les features. On les relit donc, et une
 * ville dont ces quatre valeurs ne sont pas TOUTES retrouvées de façon UNIQUE
 * est ignorée : re-plier avec une config supposée réécrirait un millésime faux
 * sur une donnée servie.
 *
 * Lecture seule ici : ce runner n'écrit RIEN. Il imprime, par ville, la ligne de
 * commande exacte à exécuter. C'est volontaire — le dépôt servi se touche par le
 * runner de fold et son gate additif, pas par un batch qui contourne.
 *
 * Usage : npx tsx acquisition/src/_effet-refold-methode-batch.ts
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { getBytes, s3Client } from "./lib/s3.js";

const ARTIFACT_DIR = resolve(import.meta.dirname, "../../work/effet-densifiant");
const PREFIX = "normalized/ca-qc-zonage/";

const CONFIG_FIELDS = [
  "densite_avant_reglement",
  "densite_apres_reglement",
  "densite_avant_millesime",
  "densite_apres_millesime",
] as const;

interface FeatureLike { properties?: Record<string, unknown> }

/** Les clés possibles : plat ET sous-dossier — geo-api sert le sous-dossier quand
 *  les deux coexistent, donc la config doit venir de ce qui est RÉELLEMENT servi. */
function zonageKeys(slug: string): string[] {
  return [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`];
}

/** Une valeur n'est retenue que si elle est UNIQUE sur toutes les features qui la
 *  portent. Deux valeurs concurrentes = config ambiguë = on ne touche pas. */
function uniqueValue(features: FeatureLike[], field: string): string | null {
  const seen = new Set<string>();
  for (const feature of features) {
    const value = feature.properties?.[field];
    if (typeof value === "string" && value.length > 0) seen.add(value);
  }
  return seen.size === 1 ? [...seen][0]! : null;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const slugs = readdirSync(ARTIFACT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const ready: string[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];

  for (const slug of slugs) {
    let features: FeatureLike[] | null = null;
    for (const key of zonageKeys(slug)) {
      try {
        const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: FeatureLike[] };
        if (Array.isArray(parsed.features)) features = parsed.features;
      } catch {
        // clé absente : l'autre layout peut exister, on continue sans conclure
      }
    }
    if (!features) { skipped.push({ slug, reason: "aucune collection servie lisible" }); continue; }

    const values = CONFIG_FIELDS.map((field) => uniqueValue(features!, field));
    const missing = CONFIG_FIELDS.filter((_, i) => values[i] === null);
    if (missing.length > 0) { skipped.push({ slug, reason: `config non unique/absente: ${missing.join(", ")}` }); continue; }

    ready.push(
      `npx tsx src/fold-effet-densifiant.ts --slug ${slug}`
      + ` --old-reglement ${values[0]} --new-reglement ${values[1]}`
      + ` --old-millesime ${values[2]} --new-millesime ${values[3]}`,
    );
  }

  console.log(JSON.stringify({ ready_count: ready.length, skipped }, null, 2));
  for (const line of ready) console.log(line);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
