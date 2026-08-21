/**
 * _zones-bareslug-locate-20260821.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Le runner d'alias a trouvé 0/220 slug servi nu aux chemins présumés
 * (`normalized/ca-qc-zonage/<slug>.geojson` et `<slug>/<slug>.geojson`).
 * Avant toute conclusion : LISTER les vraies clés S3 et localiser où chacun des
 * 220 slugs est RÉELLEMENT servi (nu-flat / nu-nested / canonique-flat /
 * canonique-nested / substring). Anti-invention : on ne devine aucun chemin.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-bareslug-locate-20260821.ts
 *
 * ÉCRIT (local) : work/coverage/zones-bareslug-locate-20260821.json
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { listObjectEntries, s3Client } from "./lib/s3.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const OUT = "work/coverage/zones-bareslug-locate-20260821.json";

const SLUGS_RAW = `
alleyn-et-cawood aumond baie-durfe baie-johan-beetz beaconsfield beauharnois begin beloeil blainville blanc-sablon bois-des-filion bois-franc bonne-esperance bouchette brome bryson cacouna calixa-lavallee campbells-bay cap-chat cayamant chapais chartierville chibougamau chichester clarendon colombier deleage desbiens dolbeau-mistassini eastman egan-sud gracefield grande-vallee gros-mecatina hampden hebertville henryville kazabazua kipawa la-dore la-martre la-morandiere-rochebaucourt la-patrie labelle lac-aux-sables lac-bouchette lac-edouard lac-poulin laforce lamarche lanse-saint-jean larouche lascension-de-notre-seigneur laurierville lebel-sur-quevillon lery les-mechins lile-perrot lisle-aux-allumettes lisle-verte litchfield lochaber lochaber-partie-ouest longue-pointe-de-mingan longue-rive lorraine malartic maniwaki mansfield-et-pontefract marieville marsoui mascouche massueville matagami mcmasterville mercier messines metabetchouan-lac-a-la-croix mont-saint-gregoire mont-saint-pierre montcerf-lytton napierville natashquan newport north-hatley notre-dame-de-ham notre-dame-de-la-salette notre-dame-de-lorette notre-dame-de-montauban notre-dame-des-sept-douleurs noyan otter-lake petite-vallee pike-river pincourt pointe-calumet pointe-des-cascades port-cartier portage-du-fort portneuf-sur-mer rapides-des-joachims richelieu riviere-a-claude riviere-eternite riviere-heva riviere-saint-jean roxton saint-adalbert saint-adelme saint-alexis-des-monts saint-andre-du-lac-saint-jean saint-arsene saint-augustin--le-golfe-du-saint-laurent saint-augustin--maria-chapdelaine saint-barnabe saint-bernard saint-blaise-sur-richelieu saint-cesaire saint-charles-de-bourget saint-clement saint-cyprien--riviere-du-loup saint-cyprien-de-napierville saint-damase-de-lislet saint-edouard saint-edouard-de-maskinonge saint-eugene-dargentenay saint-eugene-de-guigues saint-francois-de-sales saint-francois-xavier-de-viger saint-fulgence saint-gerard-majella saint-henri-de-taillon saint-honore-de-shenley saint-isidore--la-nouvelle-beauce saint-isidore--roussillon saint-isidore-de-clifton saint-jacques-le-mineur saint-jean-de-cherbourg saint-jean-port-joli saint-jean-sur-richelieu saint-joseph-du-lac saint-lambert-de-lauzon saint-leon-le-grand--maskinonge saint-leonard-de-portneuf saint-louis-de-gonzague--beauharnois-salaberry saint-ludger-de-milot saint-marc-sur-richelieu saint-mathieu-de-rioux saint-modeste saint-nazaire saint-nazaire-dacton saint-norbert saint-norbert-darthabaska saint-omer saint-paul-dabbotsford saint-paul-de-la-croix saint-paul-de-lile-aux-noix saint-philibert saint-placide saint-prime saint-remi saint-robert saint-roch-de-lachigan saint-roch-de-mekinac saint-roch-de-richelieu saint-samuel saint-sebastien--le-haut-richelieu saint-severe saint-severin--mekinac saint-simeon--bonaventure saint-urbain-premier saint-valentin saint-zenon sainte-agathe-des-monts sainte-angele-de-monnoir sainte-angele-de-premont sainte-anne-de-bellevue sainte-anne-des-plaines sainte-christine sainte-felicite--lislet sainte-hedwidge sainte-helene-de-chester sainte-jeanne-darc--maria-chapdelaine sainte-louise sainte-madeleine-de-la-riviere-madeleine sainte-marguerite sainte-marie sainte-marthe sainte-marthe-sur-le-lac sainte-martine sainte-perpetue--lislet sainte-rita sainte-rose-du-nord sainte-sabine--brome-missisquoi sainte-sophie-dhalifax sainte-thecle sainte-therese sainte-ursule saints-anges saints-martyrs-canadiens senneterre--la-vallee-de-lor--2 senneville shawville sheenboro stanbridge-station stanstead--memphremagog--2 tadoussac terrasse-vaudreuil terrebonne thorne tourville trois-rives upton vallee-jonction vaudreuil-sur-le-lac villeroy waltham weedon yamachiche
`;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const slugs = SLUGS_RAW.trim().split(/\s+/).filter(Boolean);

  const entries = await listObjectEntries(s3, S3_PREFIX);
  const keys = entries.map((e) => e.key);
  const keySet = new Set(keys);

  // Toutes les clés .geojson sous le préfixe → jeux par layout.
  const geojson = keys.filter((k) => k.endsWith(".geojson"));
  const bareFlat = new Set<string>();     // <slug>.geojson (slug != qc-zonage-*)
  const bareNested = new Set<string>();   // <slug>/<slug>.geojson
  const canonFlat = new Set<string>();    // qc-zonage-<slug>.geojson
  const canonNested = new Set<string>();  // qc-zonage-<slug>/qc-zonage-<slug>.geojson
  const otherKeys: string[] = [];
  const flatRe = /^([a-z0-9-]+)\.geojson$/;
  const nestedRe = /^([a-z0-9-]+)\/([a-z0-9-]+)\.geojson$/;
  for (const k of geojson) {
    const rest = k.slice(S3_PREFIX.length);
    const mf = flatRe.exec(rest);
    if (mf) {
      const s = mf[1]!;
      if (s.startsWith("qc-zonage-")) canonFlat.add(s.slice("qc-zonage-".length));
      else bareFlat.add(s);
      continue;
    }
    const mn = nestedRe.exec(rest);
    if (mn && mn[1] === mn[2]) {
      const s = mn[1]!;
      if (s.startsWith("qc-zonage-")) canonNested.add(s.slice("qc-zonage-".length));
      else bareNested.add(s);
      continue;
    }
    otherKeys.push(rest);
  }

  const rows = slugs.map((slug) => {
    const substrHits = keys.filter((k) => k.slice(S3_PREFIX.length).includes(slug)).slice(0, 8);
    return {
      slug,
      bare_flat: bareFlat.has(slug),
      bare_nested: bareNested.has(slug),
      canon_flat: canonFlat.has(slug),
      canon_nested: canonNested.has(slug),
      served_somewhere: bareFlat.has(slug) || bareNested.has(slug) || canonFlat.has(slug) || canonNested.has(slug),
      substring_keys: substrHits,
    };
  });

  const summary = {
    contract: "zones-bareslug-locate/diagnostic",
    generated_at_utc: new Date().toISOString(),
    s3_prefix: S3_PREFIX,
    totals: {
      keys_listed: keys.length,
      geojson_keys: geojson.length,
      bare_flat_slugs: bareFlat.size,
      bare_nested_slugs: bareNested.size,
      canon_flat_slugs: canonFlat.size,
      canon_nested_slugs: canonNested.size,
      other_geojson_keys: otherKeys.length,
    },
    target_220: {
      served_somewhere: rows.filter((r) => r.served_somewhere).length,
      as_bare_flat: rows.filter((r) => r.bare_flat).length,
      as_bare_nested: rows.filter((r) => r.bare_nested).length,
      as_canon_flat: rows.filter((r) => r.canon_flat).length,
      as_canon_nested: rows.filter((r) => r.canon_nested).length,
      absent_everywhere: rows.filter((r) => !r.served_somewhere).length,
    },
    sample_geojson_keys: geojson.slice(0, 40).map((k) => k.slice(S3_PREFIX.length)),
    sample_other_keys: otherKeys.slice(0, 40),
    rows,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(summary, null, 1)}\n`);

  process.stdout.write(
    `[locate] keys=${keys.length} geojson=${geojson.length} | bare_flat=${bareFlat.size} bare_nested=${bareNested.size} ` +
      `canon_flat=${canonFlat.size} canon_nested=${canonNested.size} other=${otherKeys.length}\n`,
  );
  const t = summary.target_220;
  process.stdout.write(
    `[locate] 220-targets: served_somewhere=${t.served_somewhere} bare_flat=${t.as_bare_flat} bare_nested=${t.as_bare_nested} ` +
      `canon_flat=${t.as_canon_flat} canon_nested=${t.as_canon_nested} absent=${t.absent_everywhere}\n`,
  );
  process.stdout.write(`[locate] sample geojson keys: ${summary.sample_geojson_keys.slice(0, 12).join(" | ")}\n`);
  process.stdout.write(`[locate] wrote ${OUT}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
