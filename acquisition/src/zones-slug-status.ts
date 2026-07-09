/**
 * zones-slug-status.ts — probe lecture-pure d'une ou plusieurs villes dans la
 * matrice de couverture : index d'énumération (→ shard round-robin index%N),
 * statut de la couche zones, doneTrack, candidateTracks, notes.
 *
 * Sert de diagnostic pour la sélection de shard et pour l'analyse d'échec de gate
 * (aucune écriture, aucun réseau, aucun LLM).
 *
 *   npx tsx acquisition/src/zones-slug-status.ts <slug> [<slug> ...] [--of 4]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const of = (() => {
  const i = process.argv.indexOf("--of");
  return i >= 0 ? Number(process.argv[i + 1]) : 4;
})();
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== String(of));

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
const slugs = Object.keys(cities);
const idx = new Map(slugs.map((s, i) => [s, i]));

for (const slug of wanted) {
  const index = idx.get(slug);
  if (index === undefined) {
    console.log(`${slug}: ABSENT de la matrice`);
    continue;
  }
  const z = cities[slug]?.zones ?? {};
  console.log(
    `${slug}: index=${index} shard=${index % of}(/${of}) zones.status=${z.status} ` +
      `doneTrack=${z.doneTrack ?? "—"} tracks=[${(z.candidateTracks ?? []).join(", ")}]` +
      (z.notes ? ` notes=${z.notes}` : ""),
  );
}
