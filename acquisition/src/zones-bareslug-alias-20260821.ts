/**
 * zones-bareslug-alias-20260821.ts — RUNNER (non-invasif, meta-alias).
 *
 * ALIAS 220 municipalités dont le zonage est servi sous le SLUG NU
 * (`normalized/ca-qc-zonage/<slug>.geojson` → served id `<slug>`, ou nesté
 * `normalized/ca-qc-zonage/<slug>/<slug>.geojson`) vers le littéral canonique
 * `datasetId=qc-zonage-<slug>` attendu par immo (exact-match des served ids).
 *
 * MÉCANISME (confirmé sur origin/main, pattern #242 cadastre-lots) :
 *   geo-api dérive l'id servi = `meta?.datasetId ?? stem`
 *   (packages/geo/src/api/providers/store-provider.ts:231-232), en lisant le
 *   sidecar `<key-stem>.meta.json` (META_SUFFIX=".meta.json", ligne 113).
 *   Déposer un `<bare-key-stem>.meta.json` avec `datasetId=qc-zonage-<slug>`
 *   fait servir la collection sous `qc-zonage-<slug>` → immo matche.
 *
 * NON-INVASIF : ajoute/merge des sidecars `.meta.json` ; la géométrie servie
 * (`.geojson`) est INCHANGÉE octet-pour-octet. AUCUNE capture, AUCUN cluster,
 * AUCUNE réécriture de géométrie. Le sidecar `.meta.json` n'est PAS une clé
 * `.geojson` servie → non couvert par le garde `isServedZoneKey` (s3.ts:68-71).
 *
 * USAGE :
 *   Scan read-only (défaut, N'ÉCRIT RIEN sur S3) :
 *     NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/zones-bareslug-alias-20260821.ts
 *   Appliquer (écrit les sidecars .meta.json sur S3, puis vérifie) :
 *     NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/zones-bareslug-alias-20260821.ts --apply
 *
 * ÉCRIT (fichiers locaux du dépôt) :
 *   work/coverage/zones-bareslug-alias-worklist-20260821.json  (les 220 slugs + source + invariants)
 *   work/coverage/zones-bareslug-alias-scan-20260821.json      (join S3 + no-collision + plan)
 *   work/coverage/zones-bareslug-alias-verify-20260821.json    (--apply : vérif post-écriture)
 *   work/coverage/zones-bareslug-alias-verify-20260821.md      (--apply : rapport lisible)
 */
import { mkdirSync, writeFileSync } from "node:fs";

import {
  exists,
  getBytes,
  parseFeatureCollectionBuffer,
  putBytes,
  s3Client,
} from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const GEOJSON_SUFFIX = ".geojson";
const META_SUFFIX = ".meta.json"; // geo-api store-provider.ts:46
const DEFAULT_CRS = "http://www.opengis.net/def/crs/OGC/1.3/CRS84"; // store-provider.ts:47

const OUT_DIR = "work/coverage";
const OUT_WORKLIST = `${OUT_DIR}/zones-bareslug-alias-worklist-20260821.json`;
const OUT_SCAN = `${OUT_DIR}/zones-bareslug-alias-scan-20260821.json`;
const OUT_VERIFY_JSON = `${OUT_DIR}/zones-bareslug-alias-verify-20260821.json`;
const OUT_VERIFY_MD = `${OUT_DIR}/zones-bareslug-alias-verify-20260821.md`;

/**
 * Les 220 slugs autoritatifs (i-arch diff vs preprod-served-ids.txt — verbatim).
 * EXACT-SLUG : les doubles-tirets (`--`) et suffixes `--2` sont préservés
 * TELS QUELS (0 dash-collapse). Split sur whitespace, assert count==220.
 */
const SLUGS_RAW = `
alleyn-et-cawood aumond baie-durfe baie-johan-beetz beaconsfield beauharnois begin beloeil blainville blanc-sablon bois-des-filion bois-franc bonne-esperance bouchette brome bryson cacouna calixa-lavallee campbells-bay cap-chat cayamant chapais chartierville chibougamau chichester clarendon colombier deleage desbiens dolbeau-mistassini eastman egan-sud gracefield grande-vallee gros-mecatina hampden hebertville henryville kazabazua kipawa la-dore la-martre la-morandiere-rochebaucourt la-patrie labelle lac-aux-sables lac-bouchette lac-edouard lac-poulin laforce lamarche lanse-saint-jean larouche lascension-de-notre-seigneur laurierville lebel-sur-quevillon lery les-mechins lile-perrot lisle-aux-allumettes lisle-verte litchfield lochaber lochaber-partie-ouest longue-pointe-de-mingan longue-rive lorraine malartic maniwaki mansfield-et-pontefract marieville marsoui mascouche massueville matagami mcmasterville mercier messines metabetchouan-lac-a-la-croix mont-saint-gregoire mont-saint-pierre montcerf-lytton napierville natashquan newport north-hatley notre-dame-de-ham notre-dame-de-la-salette notre-dame-de-lorette notre-dame-de-montauban notre-dame-des-sept-douleurs noyan otter-lake petite-vallee pike-river pincourt pointe-calumet pointe-des-cascades port-cartier portage-du-fort portneuf-sur-mer rapides-des-joachims richelieu riviere-a-claude riviere-eternite riviere-heva riviere-saint-jean roxton saint-adalbert saint-adelme saint-alexis-des-monts saint-andre-du-lac-saint-jean saint-arsene saint-augustin--le-golfe-du-saint-laurent saint-augustin--maria-chapdelaine saint-barnabe saint-bernard saint-blaise-sur-richelieu saint-cesaire saint-charles-de-bourget saint-clement saint-cyprien--riviere-du-loup saint-cyprien-de-napierville saint-damase-de-lislet saint-edouard saint-edouard-de-maskinonge saint-eugene-dargentenay saint-eugene-de-guigues saint-francois-de-sales saint-francois-xavier-de-viger saint-fulgence saint-gerard-majella saint-henri-de-taillon saint-honore-de-shenley saint-isidore--la-nouvelle-beauce saint-isidore--roussillon saint-isidore-de-clifton saint-jacques-le-mineur saint-jean-de-cherbourg saint-jean-port-joli saint-jean-sur-richelieu saint-joseph-du-lac saint-lambert-de-lauzon saint-leon-le-grand--maskinonge saint-leonard-de-portneuf saint-louis-de-gonzague--beauharnois-salaberry saint-ludger-de-milot saint-marc-sur-richelieu saint-mathieu-de-rioux saint-modeste saint-nazaire saint-nazaire-dacton saint-norbert saint-norbert-darthabaska saint-omer saint-paul-dabbotsford saint-paul-de-la-croix saint-paul-de-lile-aux-noix saint-philibert saint-placide saint-prime saint-remi saint-robert saint-roch-de-lachigan saint-roch-de-mekinac saint-roch-de-richelieu saint-samuel saint-sebastien--le-haut-richelieu saint-severe saint-severin--mekinac saint-simeon--bonaventure saint-urbain-premier saint-valentin saint-zenon sainte-agathe-des-monts sainte-angele-de-monnoir sainte-angele-de-premont sainte-anne-de-bellevue sainte-anne-des-plaines sainte-christine sainte-felicite--lislet sainte-hedwidge sainte-helene-de-chester sainte-jeanne-darc--maria-chapdelaine sainte-louise sainte-madeleine-de-la-riviere-madeleine sainte-marguerite sainte-marie sainte-marthe sainte-marthe-sur-le-lac sainte-martine sainte-perpetue--lislet sainte-rita sainte-rose-du-nord sainte-sabine--brome-missisquoi sainte-sophie-dhalifax sainte-thecle sainte-therese sainte-ursule saints-anges saints-martyrs-canadiens senneterre--la-vallee-de-lor--2 senneville shawville sheenboro stanbridge-station stanstead--memphremagog--2 tadoussac terrasse-vaudreuil terrebonne thorne tourville trois-rives upton vallee-jonction vaudreuil-sur-le-lac villeroy waltham weedon yamachiche
`;

const EXPECTED_COUNT = 220;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function parseSlugs(): string[] {
  const slugs = SLUGS_RAW.trim().split(/\s+/).filter(Boolean);
  if (slugs.length !== EXPECTED_COUNT) {
    throw new Error(
      `STOP paste-error: attendu ${EXPECTED_COUNT} slugs, trouvé ${slugs.length}. ` +
        `Ne pas fabriquer — vérifier le collage.`,
    );
  }
  const dups = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dups.length) throw new Error(`STOP: slugs dupliqués: ${[...new Set(dups)].join(", ")}`);
  // Sanity: aucun slug ne doit déjà porter le préfixe canonique.
  const alreadyCanon = slugs.filter((s) => s.startsWith("qc-zonage-"));
  if (alreadyCanon.length) throw new Error(`STOP: slug déjà canonique: ${alreadyCanon.join(", ")}`);
  return slugs;
}

interface SlugScan {
  slug: string;
  datasetId: string;
  flat_bare_key: string;
  nested_bare_key: string;
  flat_bare_exists: boolean;
  nested_bare_exists: boolean;
  canonical_flat_key: string;
  canonical_nested_key: string;
  canonical_flat_exists: boolean;
  canonical_nested_exists: boolean;
  bare_keys: string[]; // clés servies existantes (flat/nested nu)
  classification: "aliasable" | "collision" | "not-found-bare";
  reason: string;
}

async function scanSlug(s3: S3Client, slug: string): Promise<SlugScan> {
  const flatBare = `${S3_PREFIX}${slug}${GEOJSON_SUFFIX}`;
  const nestedBare = `${S3_PREFIX}${slug}/${slug}${GEOJSON_SUFFIX}`;
  const canonFlat = `${S3_PREFIX}qc-zonage-${slug}${GEOJSON_SUFFIX}`;
  const canonNested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}${GEOJSON_SUFFIX}`;

  const [flatBareEx, nestedBareEx, canonFlatEx, canonNestedEx] = await Promise.all([
    exists(s3, flatBare),
    exists(s3, nestedBare),
    exists(s3, canonFlat),
    exists(s3, canonNested),
  ]);

  const bareKeys: string[] = [];
  if (flatBareEx) bareKeys.push(flatBare);
  if (nestedBareEx) bareKeys.push(nestedBare);

  let classification: SlugScan["classification"];
  let reason: string;
  if (canonFlatEx || canonNestedEx) {
    classification = "collision";
    reason = `canonique déjà présent (flat=${canonFlatEx}, nested=${canonNestedEx}) — aliaser dédupliquerait/masquerait une collection`;
  } else if (bareKeys.length === 0) {
    classification = "not-found-bare";
    reason = "aucune clé servie nu (flat ni nested) — ne pas fabriquer de collection vide";
  } else {
    classification = "aliasable";
    reason = `servi nu sur ${bareKeys.length} layout(s); aucun canonique en collision`;
  }

  return {
    slug,
    datasetId: `qc-zonage-${slug}`,
    flat_bare_key: flatBare,
    nested_bare_key: nestedBare,
    flat_bare_exists: flatBareEx,
    nested_bare_exists: nestedBareEx,
    canonical_flat_key: canonFlat,
    canonical_nested_key: canonNested,
    canonical_flat_exists: canonFlatEx,
    canonical_nested_exists: canonNestedEx,
    bare_keys: bareKeys,
    classification,
    reason,
  };
}

async function mapLimit<T, U>(items: readonly T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** metaKey pour une clé `.geojson` (store-provider.ts:113). */
function metaKeyOf(geojsonKey: string): string {
  return `${geojsonKey.slice(0, -GEOJSON_SUFFIX.length)}${META_SUFFIX}`;
}

/** stem d'une clé `.geojson` (store-provider.ts:246-250). */
function stemOf(geojsonKey: string): string {
  const slash = geojsonKey.lastIndexOf("/");
  const base = slash === -1 ? geojsonKey : geojsonKey.slice(slash + 1);
  return base.slice(0, -GEOJSON_SUFFIX.length);
}

interface MetaWrite {
  geojson_key: string;
  meta_key: string;
  had_existing_meta: boolean;
  preserved_fields: string[];
  meta_written: Record<string, unknown>;
}

/**
 * Écrit/merge le sidecar `.meta.json` pour UNE clé nu servie.
 * - meta existant : merge `datasetId`, PRÉSERVE tous les champs (count/crs/…).
 * - pas de meta : crée minimal-correct { datasetId, count (feature count), crs }.
 * Primitive : putBytes (le sidecar `.meta.json` n'est pas une clé servie
 * `.geojson`, donc non couvert par isServedZoneKey — s3.ts:68-71,323).
 */
async function writeMetaForKey(s3: S3Client, geojsonKey: string, datasetId: string): Promise<MetaWrite> {
  const metaKey = metaKeyOf(geojsonKey);
  const hadExisting = await exists(s3, metaKey);
  let meta: Record<string, unknown>;
  let preserved: string[] = [];
  if (hadExisting) {
    const existing = JSON.parse((await getBytes(s3, metaKey)).toString("utf8")) as Record<string, unknown>;
    preserved = Object.keys(existing).filter((k) => k !== "datasetId");
    meta = { ...existing, datasetId };
  } else {
    // Lecture du geojson servi pour count + crs (minimal-correct, jamais count=0).
    const buf = await getBytes(s3, geojsonKey);
    const fc = parseFeatureCollectionBuffer(buf, geojsonKey);
    const crs = extractCrs(buf) ?? DEFAULT_CRS;
    meta = { datasetId, count: fc.features.length, crs };
  }
  await putBytes(s3, metaKey, `${JSON.stringify(meta, null, 2)}\n`, "application/json");
  return {
    geojson_key: geojsonKey,
    meta_key: metaKey,
    had_existing_meta: hadExisting,
    preserved_fields: preserved,
    meta_written: meta,
  };
}

/** Extrait le membre `crs` (chaîne URI) d'un FeatureCollection GeoJSON, sinon undefined. */
function extractCrs(buf: Buffer): string | undefined {
  // Le crs GeoJSON legacy: { "crs": { "properties": { "name": "urn:ogc:def:crs:..." } } }
  // ou une chaîne directe. On tente une lecture prudente sur l'entête (RFC7946 l'omet).
  try {
    const head = buf.subarray(0, Math.min(buf.length, 4096)).toString("utf8");
    const m = /"crs"\s*:\s*(\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?\}|"([^"]+)")/.exec(head);
    const name = m?.[2] ?? m?.[3];
    return name ? String(name) : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const slugs = parseSlugs();
  requireS3();
  const s3 = s3Client();

  mkdirSync(OUT_DIR, { recursive: true });

  // ── STEP 1 : worklist autoritatif ──
  const worklist = {
    contract: "zones-bareslug-alias/worklist",
    generated_at_utc: new Date().toISOString(),
    source: "i-arch diff vs preprod-served-ids.txt (verbatim, 0 dash-collapse)",
    canonical_literal: "qc-zonage-<slug>",
    count_asserted: slugs.length,
    // Faits VÉRIFIÉS sur la liste de slugs elle-même (0 invention).
    slug_list_invariants: {
      "count==220": slugs.length === EXPECTED_COUNT,
      "0-already-canonical-prefix": slugs.every((s) => !s.startsWith("qc-zonage-")),
      "0-duplicate": new Set(slugs).size === slugs.length,
    },
    // Revendications i-arch NON re-vérifiées par ce runner (verbatim du brief).
    iarch_claims_unverified_here:
      "i-arch diff vs preprod-served-ids.txt affirme: ces 220 servis NU, 0-missing, 0-already-canonical, 0-overlap-16gaps. " +
      "Ce runner vérifie le SERVICE réel contre la CIBLE S3 déclarée (voir scan report).",
    served_check: "voir work/coverage/zones-bareslug-alias-scan-20260821.json (join HEAD sur clés S3 réelles)",
    slugs,
  };
  writeFileSync(OUT_WORKLIST, `${JSON.stringify(worklist, null, 1)}\n`);
  process.stdout.write(`[step1] count==${slugs.length} asserted OK ; worklist → ${OUT_WORKLIST}\n`);

  // ── STEP 2 + 3 : JOIN S3 (flat/nested nu) + NO-COLLISION (canonique) ──
  const scans = await mapLimit(slugs, 24, (slug) => scanSlug(s3, slug));
  const aliasable = scans.filter((s) => s.classification === "aliasable");
  const collisions = scans.filter((s) => s.classification === "collision");
  const notFound = scans.filter((s) => s.classification === "not-found-bare");

  const flatOnly = aliasable.filter((s) => s.flat_bare_exists && !s.nested_bare_exists);
  const nestedOnly = aliasable.filter((s) => !s.flat_bare_exists && s.nested_bare_exists);
  const both = aliasable.filter((s) => s.flat_bare_exists && s.nested_bare_exists);

  const scanReport = {
    contract: "zones-bareslug-alias/scan",
    generated_at_utc: new Date().toISOString(),
    mode: apply ? "apply" : "scan-only",
    totals: {
      slugs: scans.length,
      aliasable: aliasable.length,
      collision: collisions.length,
      not_found_bare: notFound.length,
    },
    layout_distribution_aliasable: {
      flat_only: flatOnly.length,
      nested_only: nestedOnly.length,
      both: both.length,
    },
    collision_slugs: collisions.map((s) => ({ slug: s.slug, reason: s.reason })),
    not_found_bare_slugs: notFound.map((s) => s.slug),
    scans,
  };
  writeFileSync(OUT_SCAN, `${JSON.stringify(scanReport, null, 1)}\n`);
  process.stdout.write(
    `[step2-3] aliasable=${aliasable.length} collision=${collisions.length} not-found-bare=${notFound.length} ` +
      `| layout flat-only=${flatOnly.length} nested-only=${nestedOnly.length} both=${both.length}\n`,
  );
  if (collisions.length) process.stdout.write(`[step3] COLLISION: ${collisions.map((s) => s.slug).join(", ")}\n`);
  if (notFound.length) process.stdout.write(`[step2] NOT-FOUND-BARE: ${notFound.map((s) => s.slug).join(", ")}\n`);

  if (!apply) {
    process.stdout.write(
      `\n[scan-only] AUCUNE écriture S3. Rejouer avec --apply pour déposer les sidecars .meta.json ` +
        `(${aliasable.length} slugs, ${aliasable.reduce((n, s) => n + s.bare_keys.length, 0)} clés meta).\n`,
    );
    return;
  }

  // ── STEP 5 : ÉCRITURE des sidecars .meta.json (par layout nu existant) ──
  const writes: Array<{ slug: string; datasetId: string; metas: MetaWrite[] }> = [];
  for (const sc of aliasable) {
    const metas: MetaWrite[] = [];
    for (const bareKey of sc.bare_keys) {
      metas.push(await writeMetaForKey(s3, bareKey, sc.datasetId));
    }
    writes.push({ slug: sc.slug, datasetId: sc.datasetId, metas });
    process.stdout.write(`[write] ${sc.slug} → datasetId=${sc.datasetId} (${metas.length} meta)\n`);
  }

  // ── STEP 6 : VÉRIFICATION post-écriture (read-only) ──
  const verifyRows: Array<Record<string, unknown>> = [];
  let derivedOk = 0;
  let regressions = 0;
  for (const w of writes) {
    for (const m of w.metas) {
      const reread = JSON.parse((await getBytes(s3, m.meta_key)).toString("utf8")) as Record<string, unknown>;
      const datasetIdOk = reread["datasetId"] === w.datasetId;
      const stem = stemOf(m.geojson_key);
      const derivedServedId = (reread["datasetId"] as string | undefined) ?? stem; // datasetId ?? stem
      const derivedOkRow = derivedServedId === w.datasetId;
      if (datasetIdOk && derivedOkRow) derivedOk++;
      else regressions++;
      verifyRows.push({
        slug: w.slug,
        meta_key: m.meta_key,
        datasetId_reread: reread["datasetId"],
        datasetId_ok: datasetIdOk,
        derived_served_id: derivedServedId,
        derived_ok: derivedOkRow,
        count: reread["count"] ?? null,
        crs: reread["crs"] ?? null,
        preserved_fields: m.preserved_fields,
      });
    }
  }

  // Critère (a) no-collision tenu : 0 aliasé sur un canonique existant.
  const noCollisionHeld = aliasable.every((s) => !s.canonical_flat_exists && !s.canonical_nested_exists);
  const totalMetaWritten = writes.reduce((n, w) => n + w.metas.length, 0);

  const verify = {
    contract: "zones-bareslug-alias/verify",
    generated_at_utc: new Date().toISOString(),
    criteria: {
      a_no_collision_held: noCollisionHeld,
      b_datasetId_and_derived_id_ok: derivedOk === totalMetaWritten && regressions === 0,
      c_reachable_count: aliasable.length,
      c_target: `${EXPECTED_COUNT} - collision(${collisions.length}) - not-found(${notFound.length}) = ${EXPECTED_COUNT - collisions.length - notFound.length}`,
      d_zero_regression: regressions === 0,
    },
    totals: {
      aliased_slugs: writes.length,
      meta_files_written: totalMetaWritten,
      derived_ok: derivedOk,
      regressions,
      skipped_collision: collisions.map((s) => s.slug),
      not_found_bare: notFound.map((s) => s.slug),
    },
    verify_rows: verifyRows,
  };
  writeFileSync(OUT_VERIFY_JSON, `${JSON.stringify(verify, null, 1)}\n`);

  const md = `# Alias 220 munis zonage bare-slug → datasetId=qc-zonage-<slug> — ${new Date().toISOString().slice(0, 10)}

Mécanisme #242 : sidecar \`.meta.json\` avec \`datasetId=qc-zonage-<slug>\` ; geo-api
sert la collection sous \`datasetId ?? stem\`. Géométrie \`.geojson\` INCHANGÉE.

## Totaux

- slugs autoritatifs (count asserté) : **${slugs.length}**
- **aliasés : ${writes.length}** (fichiers meta écrits : ${totalMetaWritten})
- skipped collision : **${collisions.length}**${collisions.length ? ` (${collisions.map((s) => s.slug).join(", ")})` : ""}
- not-found-bare : **${notFound.length}**${notFound.length ? ` (${notFound.map((s) => s.slug).join(", ")})` : ""}
- distribution layout (aliasables) : flat-only=${flatOnly.length}, nested-only=${nestedOnly.length}, both=${both.length}

## Critères d'acceptation (geo-archi)

| critère | résultat |
|---------|----------|
| (a) no-collision tenu (0 aliasé sur canonique) | ${noCollisionHeld ? "OK" : "ÉCHEC"} |
| (b) datasetId + id dérivé = qc-zonage-<slug> | ${derivedOk === totalMetaWritten && regressions === 0 ? `OK (${derivedOk}/${totalMetaWritten})` : `ÉCHEC (${derivedOk}/${totalMetaWritten})`} |
| (c) nouvellement joignables = aliasés | ${writes.length} (cible ${EXPECTED_COUNT} − collision ${collisions.length} − not-found ${notFound.length}) |
| (d) 0 régression | ${regressions === 0 ? "OK" : `ÉCHEC (${regressions})`} |
`;
  writeFileSync(OUT_VERIFY_MD, md);

  process.stdout.write(
    `\n[verify] aliased=${writes.length} meta_written=${totalMetaWritten} derived_ok=${derivedOk} ` +
      `regressions=${regressions} no_collision_held=${noCollisionHeld}\n`,
  );
  process.stdout.write(`[verify] wrote ${OUT_VERIFY_JSON} + ${OUT_VERIFY_MD}\n`);
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
