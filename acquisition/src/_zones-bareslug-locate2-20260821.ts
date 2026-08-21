/**
 * _zones-bareslug-locate2-20260821.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * locate(1) a montré 0/220 sous normalized/ca-qc-zonage/. Le commit #242 indique
 * que le zonage servi NU vit à la RACINE de normalized/ (`normalized/<slug>.geojson`,
 * id `<slug>`), pas sous ca-qc-zonage/. On sonde donc TOUS les layouts plausibles
 * par HEAD pour localiser chaque slug de façon décisive. Anti-invention.
 *
 * USAGE : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-bareslug-locate2-20260821.ts
 * ÉCRIT (local) : work/coverage/zones-bareslug-locate2-20260821.json
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { exists, s3Client } from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

const OUT = "work/coverage/zones-bareslug-locate2-20260821.json";

const SLUGS_RAW = `
alleyn-et-cawood aumond baie-durfe baie-johan-beetz beaconsfield beauharnois begin beloeil blainville blanc-sablon bois-des-filion bois-franc bonne-esperance bouchette brome bryson cacouna calixa-lavallee campbells-bay cap-chat cayamant chapais chartierville chibougamau chichester clarendon colombier deleage desbiens dolbeau-mistassini eastman egan-sud gracefield grande-vallee gros-mecatina hampden hebertville henryville kazabazua kipawa la-dore la-martre la-morandiere-rochebaucourt la-patrie labelle lac-aux-sables lac-bouchette lac-edouard lac-poulin laforce lamarche lanse-saint-jean larouche lascension-de-notre-seigneur laurierville lebel-sur-quevillon lery les-mechins lile-perrot lisle-aux-allumettes lisle-verte litchfield lochaber lochaber-partie-ouest longue-pointe-de-mingan longue-rive lorraine malartic maniwaki mansfield-et-pontefract marieville marsoui mascouche massueville matagami mcmasterville mercier messines metabetchouan-lac-a-la-croix mont-saint-gregoire mont-saint-pierre montcerf-lytton napierville natashquan newport north-hatley notre-dame-de-ham notre-dame-de-la-salette notre-dame-de-lorette notre-dame-de-montauban notre-dame-des-sept-douleurs noyan otter-lake petite-vallee pike-river pincourt pointe-calumet pointe-des-cascades port-cartier portage-du-fort portneuf-sur-mer rapides-des-joachims richelieu riviere-a-claude riviere-eternite riviere-heva riviere-saint-jean roxton saint-adalbert saint-adelme saint-alexis-des-monts saint-andre-du-lac-saint-jean saint-arsene saint-augustin--le-golfe-du-saint-laurent saint-augustin--maria-chapdelaine saint-barnabe saint-bernard saint-blaise-sur-richelieu saint-cesaire saint-charles-de-bourget saint-clement saint-cyprien--riviere-du-loup saint-cyprien-de-napierville saint-damase-de-lislet saint-edouard saint-edouard-de-maskinonge saint-eugene-dargentenay saint-eugene-de-guigues saint-francois-de-sales saint-francois-xavier-de-viger saint-fulgence saint-gerard-majella saint-henri-de-taillon saint-honore-de-shenley saint-isidore--la-nouvelle-beauce saint-isidore--roussillon saint-isidore-de-clifton saint-jacques-le-mineur saint-jean-de-cherbourg saint-jean-port-joli saint-jean-sur-richelieu saint-joseph-du-lac saint-lambert-de-lauzon saint-leon-le-grand--maskinonge saint-leonard-de-portneuf saint-louis-de-gonzague--beauharnois-salaberry saint-ludger-de-milot saint-marc-sur-richelieu saint-mathieu-de-rioux saint-modeste saint-nazaire saint-nazaire-dacton saint-norbert saint-norbert-darthabaska saint-omer saint-paul-dabbotsford saint-paul-de-la-croix saint-paul-de-lile-aux-noix saint-philibert saint-placide saint-prime saint-remi saint-robert saint-roch-de-lachigan saint-roch-de-mekinac saint-roch-de-richelieu saint-samuel saint-sebastien--le-haut-richelieu saint-severe saint-severin--mekinac saint-simeon--bonaventure saint-urbain-premier saint-valentin saint-zenon sainte-agathe-des-monts sainte-angele-de-monnoir sainte-angele-de-premont sainte-anne-de-bellevue sainte-anne-des-plaines sainte-christine sainte-felicite--lislet sainte-hedwidge sainte-helene-de-chester sainte-jeanne-darc--maria-chapdelaine sainte-louise sainte-madeleine-de-la-riviere-madeleine sainte-marguerite sainte-marie sainte-marthe sainte-marthe-sur-le-lac sainte-martine sainte-perpetue--lislet sainte-rita sainte-rose-du-nord sainte-sabine--brome-missisquoi sainte-sophie-dhalifax sainte-thecle sainte-therese sainte-ursule saints-anges saints-martyrs-canadiens senneterre--la-vallee-de-lor--2 senneville shawville sheenboro stanbridge-station stanstead--memphremagog--2 tadoussac terrasse-vaudreuil terrebonne thorne tourville trois-rives upton vallee-jonction vaudreuil-sur-le-lac villeroy waltham weedon yamachiche
`;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: NODE_OPTIONS");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: AWS_MAX_ATTEMPTS=10");
}

async function mapLimit<T, U>(items: readonly T[], limit: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i]!); }
  }));
  return out;
}

async function main(): Promise<void> {
  requireS3();
  const s3: S3Client = s3Client();
  const slugs = SLUGS_RAW.trim().split(/\s+/).filter(Boolean);

  const layouts = (slug: string): Record<string, string> => ({
    root_bare_flat: `normalized/${slug}.geojson`,
    root_bare_nested: `normalized/${slug}/${slug}.geojson`,
    subdir_bare_flat: `normalized/ca-qc-zonage/${slug}.geojson`,
    subdir_bare_nested: `normalized/ca-qc-zonage/${slug}/${slug}.geojson`,
    root_canon_flat: `normalized/qc-zonage-${slug}.geojson`,
    root_canon_nested: `normalized/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    subdir_canon_flat: `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`,
    subdir_canon_nested: `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  });

  const rows = await mapLimit(slugs, 8, async (slug) => {
    const L = layouts(slug);
    const names = Object.keys(L);
    const found: Record<string, boolean> = {};
    // HEADs séquentiels par slug pour plafonner les sockets concurrents (~8),
    // évite le burst happy-eyeballs qui provoque des ETIMEDOUT de connexion.
    for (const n of names) found[n] = await exists(s3, L[n]!);
    // meta présence sur les clés bare trouvées
    const rootBareMeta = found.root_bare_flat ? await exists(s3, `normalized/${slug}.meta.json`) : false;
    return { slug, found, root_bare_meta_exists: rootBareMeta };
  });

  const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
  const summary = {
    contract: "zones-bareslug-locate2/diagnostic",
    generated_at_utc: new Date().toISOString(),
    totals: {
      slugs: rows.length,
      root_bare_flat: count((r) => r.found.root_bare_flat!),
      root_bare_nested: count((r) => r.found.root_bare_nested!),
      subdir_bare_flat: count((r) => r.found.subdir_bare_flat!),
      subdir_bare_nested: count((r) => r.found.subdir_bare_nested!),
      root_canon_flat: count((r) => r.found.root_canon_flat!),
      root_canon_nested: count((r) => r.found.root_canon_nested!),
      subdir_canon_flat: count((r) => r.found.subdir_canon_flat!),
      subdir_canon_nested: count((r) => r.found.subdir_canon_nested!),
      served_nowhere: count((r) => !Object.values(r.found).some(Boolean)),
      root_bare_meta_already: count((r) => r.root_bare_meta_exists),
    },
    served_nowhere_slugs: rows.filter((r) => !Object.values(r.found).some(Boolean)).map((r) => r.slug),
    rows,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(summary, null, 1)}\n`);
  const t = summary.totals;
  process.stdout.write(
    `[locate2] slugs=${t.slugs} | root_bare_flat=${t.root_bare_flat} root_bare_nested=${t.root_bare_nested} ` +
      `subdir_bare_flat=${t.subdir_bare_flat} subdir_bare_nested=${t.subdir_bare_nested}\n` +
    `[locate2] root_canon_flat=${t.root_canon_flat} root_canon_nested=${t.root_canon_nested} ` +
      `subdir_canon_flat=${t.subdir_canon_flat} subdir_canon_nested=${t.subdir_canon_nested}\n` +
    `[locate2] served_nowhere=${t.served_nowhere} root_bare_meta_already=${t.root_bare_meta_already}\n`,
  );
  process.stdout.write(`[locate2] wrote ${OUT}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
