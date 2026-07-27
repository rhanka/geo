/**
 * _densite-visible-ogc-probe.ts — la densité déposée est-elle VISIBLE ?
 *
 * Déposer sur S3 ne suffit pas : geo-api a déjà servi des couches périmées
 * pendant qu'un dépôt frais existait, et sert le sous-dossier quand les deux
 * layouts coexistent. Une densité invisible depuis l'API ne vaut rien pour immo,
 * dont le passthrough lit l'API publique et pas le bucket.
 *
 * Cette sonde interroge l'API OGC PUBLIQUE, pas S3 : c'est le seul point de vue
 * qui prouve ce qu'un tiers voit réellement.
 *
 * Lecture du produit servie seulement : elle n'écrit aucune donnée servie. La
 * réponse est toutefois capturée dans le CAS avec son manifeste, pour que cette
 * observation publique reste rejouable et auditée.
 *
 * Usage :
 *   npx tsx acquisition/src/_densite-visible-ogc-probe.ts --slugs sayabec,matane
 */
import {
  capturedFetch,
  capturedText,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
} from "../../packages/qc-sources/src/capture/index.js";

import { openCaptureRun } from "./lib/capture-s3.js";

const API = "https://api.geo.sent-tech.ca";

interface Feature { properties?: Record<string, unknown> }

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf("--slugs");
  const slugs = (index >= 0 ? argv[index + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b");

  const run = openCaptureRun({ lane: "zones" });
  try {
    for (const slug of slugs) {
      const url = `${API}/collections/qc-zonage-${slug}/items?limit=1000`;
      let payload: { features?: Feature[]; numberMatched?: number };
      try {
        const captured = await capturedFetch(url, { headers: { accept: "application/geo+json" } }, {
          run,
          lane: "zones",
          source: "geo-api-readback",
          slugs: [slug],
          // Le `fetch` nu historique n'avait pas de délai ni une limite de
          // redirections plus stricte que Node; préserver cette sémantique.
          timeoutMs: null,
          maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
          // La sonde doit analyser le GeoJSON après sa capture.
          retainBody: true,
        });
        if (!captured.ok || captured.bytes === null) {
          if (captured.response !== null && !captured.response.ok) {
            // Un statut non-OK est une mesure de CE QUE L'API REND, pas une preuve
            // que la donnee est absente du bucket : on le rapporte tel quel.
            console.log(`${slug.padEnd(30)} HTTP ${captured.response.status}`);
          } else {
            console.log(`${slug.padEnd(30)} ERREUR ${captured.line.error ?? "sans réponse"}`);
          }
          continue;
        }
        payload = JSON.parse(capturedText(captured)) as typeof payload;
      } catch (error) {
        console.log(`${slug.padEnd(30)} ERREUR ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const features = payload.features ?? [];
      const withDensity = features.filter((f) => filled(f.properties?.["densite_value"]));
      const sample = withDensity[0]?.properties;
      // `densite_value` vient du pli des NORMES ; `effet_densifiant` vient du pli
      // du DELTA et porte ses propres compteurs. Une collection peut servir l'un
      // sans l'autre : ne pas les confondre en lisant un seul champ.
      const effects = features.reduce<Record<string, number>>((acc, f) => {
        const effect = f.properties?.["effet_densifiant"];
        if (!filled(effect)) return acc;
        acc[String(effect)] = (acc[String(effect)] ?? 0) + 1;
        return acc;
      }, {});
      // La provenance est ce qu'immo consomme reellement. Leur ingestion filtre par
      // une ALLOWLIST POSITIVE qui rejette l'enveloppe ENTIERE des qu'une cle
      // inconnue apparait : un champ ajoute de mon cote peut donc faire disparaitre
      // zone_source_url et proof chez eux. On mesure au moins ce que MOI je sers.
      const provenance = ["zone_source_url", "zone_source_level", "proof", "reglement_numero"]
        .map((field) => `${field}=${features.filter((f) => filled(f.properties?.[field])).length}`)
        .join(" ");
      console.log(
        `${slug.padEnd(30)} rendues=${String(features.length).padStart(4)} ` +
        `total=${String(payload.numberMatched ?? "?").padStart(4)} ` +
        `avec_densite=${String(withDensity.length).padStart(4)}` +
        (sample ? `  ex ${String(sample["zone_code"])}=${String(sample["densite_value"])}` : "") +
        (Object.keys(effects).length > 0 ? `  effets=${JSON.stringify(effects)}` : "") +
        `\n${" ".repeat(32)}${provenance}`,
      );
    }
  } finally {
    await run.finish(0);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
