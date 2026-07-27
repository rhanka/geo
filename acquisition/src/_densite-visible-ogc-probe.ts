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
 * Lecture seule stricte, aucun accès S3, n'écrit rien.
 *
 * Usage :
 *   npx tsx acquisition/src/_densite-visible-ogc-probe.ts --slugs sayabec,matane
 */
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

  for (const slug of slugs) {
    const url = `${API}/collections/qc-zonage-${slug}/items?limit=1000`;
    let payload: { features?: Feature[]; numberMatched?: number };
    try {
      const response = await fetch(url, { headers: { accept: "application/geo+json" } });
      if (!response.ok) {
        // Un statut non-OK est une mesure de CE QUE L'API REND, pas une preuve
        // que la donnee est absente du bucket : on le rapporte tel quel.
        console.log(`${slug.padEnd(30)} HTTP ${response.status}`);
        continue;
      }
      payload = (await response.json()) as typeof payload;
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
