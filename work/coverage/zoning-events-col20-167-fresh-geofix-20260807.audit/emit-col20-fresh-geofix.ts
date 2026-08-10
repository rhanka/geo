/**
 * Projection read-only de la GT S3 fraîche vers le livrable WP5 col-20.
 *
 * La mesure demeure celle du harnais gelé : runRecallGate reçoit EXPLICITEMENT
 * le même `documents.json` d'émission geo que l'émetteur validé de c9889944.
 * Ce fichier ne redéfinit ni clé, ni crosswalk, ni multiset ; il rend seulement
 * la partition de statuts prescrite et les témoins événement-par-événement.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runRecallGate, setRecallFor } from "../../../acquisition/src/zoning-events-recall-gate.js";

const AUDIT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(AUDIT, "../../..");
const STEM = "zoning-events-col20-167-fresh-geofix-20260807";
const OUTPUT_JSON = join(ROOT, "work/coverage", `${STEM}.json`);
const OUTPUT_MD = join(ROOT, "work/coverage", `${STEM}.md`);
const GT_DIR = join(AUDIT, "gt");
const MANIFEST_PATH = join(GT_DIR, "_manifest.json");
const IMMO_INPUT_PATH = join(AUDIT, "immo-events.json");
const GATE_PATH = join(AUDIT, "recall-gate.json");
const GATE_MD_PATH = join(AUDIT, "recall-gate.md");
const WITNESS_PATH = join(AUDIT, "set-recall-event-partition.ndjson");
const COHORT_PATH = join(ROOT, "work/coverage/zoning-events-col20-167-s3gt-20260803.audit/cohort-167.tsv");

const SOURCE_S3_URI = "s3://radar-immobilier-docs-pocs/gt/designation-events-167-v2-20260803/";
// Décision de recette : les quatre événements Terrebonne du manifest 1044 ne
// doivent compter qu'une fois dans la mesure agrégée, dont le dénominateur est
// donc fixé à 1040. Les octets restent tous conservés et visibles par muni.
const AGGREGATE_DENOMINATOR = 1040;
// C'est le chemin local-file exact du générateur qui a produit c9889944.
const GEO_EVENTS_PATH = "work/coverage/qc-zoning-events-dryrun-action-grain-20260803/documents.json";
const GAP_ACQUISITION = new Set([
  "kirkland",
  "lile-dorval",
  "marieville",
  "notre-dame-de-stanbridge",
]);
const NA_PROVEN = new Set([
  "montreal-ouest",
  "senneville",
  "vercheres",
  "terrasse-vaudreuil",
  "saint-charles-sur-richelieu",
  "saint-chrysostome",
  "franklin",
  "lepiphanie",
  "saint-antoine-sur-richelieu",
  "la-presentation",
  "lacolle",
  "rougemont",
  "saint-bernard-de-lacolle",
  "saint-sulpice",
  "sainte-anne-de-sabrevois",
]);

type Json = Record<string, any>;

function fail(message: string): never {
  throw new Error(`col20 fresh geofix: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function rootPath(path: string): string {
  const value = relative(ROOT, path);
  assert(!value.startsWith(".."), `chemin hors dépôt: ${path}`);
  return value;
}

function writeNew(path: string, body: string): void {
  if (existsSync(path)) fail(`refus d'écraser ${rootPath(path)}`);
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)} %`;
}

function printable(value: number | null): string {
  return value === null ? "—" : String(value);
}

function jsonEventSort(left: any, right: any): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function groupToken(key: any): string {
  return JSON.stringify([key.muni, key.source_url_norm, key.date_iso, key.crosswalked_type]);
}

function rawSourceFields(row: Json): Record<string, unknown> {
  return {
    event_id: row.node_id ?? null,
    muni: row.city_slug ?? null,
    source_url: row.source_url ?? null,
    date_iso: row.date ?? null,
    type: row.kind ?? null,
    bylaw_numero: row.bylaw_numero ?? null,
    zone_ref: row.zone_ref ?? null,
    no_lot: row.no_lot ?? null,
  };
}

function readFreshGt(manifest: Json): Json[] {
  const rows: Json[] = [];
  const expectedFiles = Object.entries(manifest.perCity as Record<string, Json>)
    .filter(([, entry]) => entry.events !== -1)
    .map(([slug]) => `${slug}.ndjson`)
    .sort();
  const actualFiles = readdirSync(GT_DIR).filter((name) => name.endsWith(".ndjson")).sort();
  assert(JSON.stringify(actualFiles) === JSON.stringify(expectedFiles), "fichiers GT S3 reçus différents du manifeste");
  for (const filename of actualFiles) {
    const slug = filename.slice(0, -".ndjson".length);
    const body = readFileSync(join(GT_DIR, filename), "utf8").trim();
    const cityRows = body === "" ? [] : body.split(/\r?\n/u).map((line) => JSON.parse(line));
    const expected = manifest.perCity[slug]?.events;
    assert(typeof expected === "number" && expected >= 0, `manifeste GT invalide: ${slug}`);
    assert(cityRows.length === expected, `compte GT divergent: ${slug}`);
    for (const row of cityRows) {
      assert(row.city_slug === slug, `city_slug GT divergent: ${slug}`);
      assert(row.node_type === "DesignationEvent", `node_type GT interdit: ${slug}`);
      rows.push(row);
    }
  }
  return rows;
}

async function main(): Promise<void> {
  assert(!existsSync(OUTPUT_JSON) && !existsSync(OUTPUT_MD) && !existsSync(WITNESS_PATH), "sortie déjà présente");
  assert(existsSync(MANIFEST_PATH), "manifest GT S3 absent");
  const manifestBytes = readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
  assert(manifest.totals.cities === 167 && manifest.totals.citiesWithGraph === 163 && manifest.totals.citiesAbsent === 4,
    "partition GT S3 inattendue");
  assert(Object.keys(manifest.perCity).filter((slug) => manifest.perCity[slug].events === -1).sort().join(",")
    === [...GAP_ACQUISITION].sort().join(","), "GAP S3 différent des quatre GAP autorisés");

  const cohort = readFileSync(COHORT_PATH, "utf8").trim().split(/\r?\n/u).slice(1).map((line) => {
    const [rank, slug] = line.split("\t");
    return { rank: Number(rank), slug };
  });
  assert(cohort.length === 167 && new Set(cohort.map(({ slug }) => slug)).size === 167, "cohorte 167 invalide");

  const raw = readFreshGt(manifest);
  const perCitySum = Object.values(manifest.perCity as Record<string, Json>)
    .reduce((sum, city) => sum + (city.events === -1 ? 0 : city.events), 0);
  assert(raw.length === 1044 && perCitySum === 1044 && manifest.totals.events === 1044,
    "manifest frais attendu avec double-compte terrebonne=1044");
  writeNew(IMMO_INPUT_PATH, `${JSON.stringify(raw, null, 2)}\n`);

  // Mécanisme validé dans c9889944 : local-file explicitement chargé par muni
  // via --geo-events / geoEventsPath, jamais le chemin S3 vide par omission.
  const gate = await runRecallGate({
    cohort: cohort.map(({ slug }) => slug),
    denominator: AGGREGATE_DENOMINATOR,
    geoEventsPath: GEO_EVENTS_PATH,
    immoEventsPath: rootPath(IMMO_INPUT_PATH),
    outPath: rootPath(GATE_PATH),
    markdownPath: rootPath(GATE_MD_PATH),
  });
  assert(gate.exitCode !== 2, "erreur de lecture émission geo dans le harnais");
  const report = gate.report as any;
  const citiesBySlug = new Map<string, any>(report.cities.map((city: any) => [city.slug, city]));
  assert(citiesBySlug.size === 167, "gate sans 167 villes");

  // PORTE DE SANTÉ impérative : aucune sortie finale si ce loader n'a pas tenu.
  const saintEustache: any = citiesBySlug.get("saint-eustache");
  const saintMathieu: any = citiesBySlug.get("saint-mathieu-de-beloeil");
  assert(saintEustache?.geo_events > 0 && saintMathieu?.geo_events > 0,
    `GEO_EMISSION_NOT_LOADED : saint-eustache=${saintEustache?.geo_events ?? "absent"}, saint-mathieu-de-beloeil=${saintMathieu?.geo_events ?? "absent"}`);
  assert(saintEustache.geo_events === 377 && saintMathieu.geo_events === 37,
    `émission geo inattendue: saint-eustache=${saintEustache.geo_events}, saint-mathieu-de-beloeil=${saintMathieu.geo_events}`);

  const rawByCity = new Map<string, Json[]>();
  const rawById = new Map<string, Json>();
  for (const row of raw) {
    assert(typeof row.node_id === "string" && !rawById.has(row.node_id), `node_id GT invalide ou dupliqué: ${String(row.node_id)}`);
    rawById.set(row.node_id, row);
    const cityRows = rawByCity.get(row.city_slug) ?? [];
    cityRows.push(row);
    rawByCity.set(row.city_slug, cityRows);
  }

  // Témoins SET-RECALL : même reconstruction déterministe que emit-col20-v2.
  const immoEvents = report.cities.flatMap((city: any) => city.partition.missed.map((entry: any) => entry.immo));
  const geoEvents = report.cities.flatMap((city: any) => city.partition.extra.map((entry: any) => entry.geo));
  assert(immoEvents.length === raw.length, "partition stricte immo du gate incomplète");
  assert(geoEvents.length === report.aggregate.geo_events, "partition stricte geo du gate incomplète");
  for (const event of immoEvents) {
    const id = event.source_fields.event_id;
    assert(typeof id === "string" && rawById.has(id), `preuve immo sans ligne GT: ${String(id)}`);
    assert(JSON.stringify(event.source_fields) === JSON.stringify(rawSourceFields(rawById.get(id)!)),
      `source_fields non verbatim pour ${id}`);
  }

  const baselineGroups = new Map<string, any>(report.aggregate.set_recall.groups.map((group: any) => [groupToken(group.key), group]));
  const immoByGroup = new Map<string, any[]>();
  for (const immo of immoEvents) {
    const group = setRecallFor(geoEvents, [immo], 1).groups.find((candidate: any) => candidate.immo_count === 1);
    if (group === undefined || (baselineGroups.get(groupToken(group.key))?.matched ?? 0) === 0) continue;
    const token = groupToken(group.key);
    const values = immoByGroup.get(token) ?? [];
    values.push(immo);
    immoByGroup.set(token, values);
  }
  const selectedImmo: any[] = [];
  for (const [token, group] of baselineGroups) {
    if (group.matched === 0) continue;
    const values = [...(immoByGroup.get(token) ?? [])].sort(jsonEventSort);
    assert(values.length === group.immo_count, `témoins immo incomplets: ${token}`);
    selectedImmo.push(...values.slice(0, group.matched));
  }
  assert(selectedImmo.length === report.aggregate.set_recall.matched, "témoins immo matched divergents");

  const geoByGroup = new Map<string, any[]>();
  for (const geo of geoEvents) {
    const group = setRecallFor([geo], selectedImmo, 1).groups.find((candidate: any) => candidate.geo_count === 1);
    if (group === undefined || (baselineGroups.get(groupToken(group.key))?.matched ?? 0) === 0) continue;
    const token = groupToken(group.key);
    const values = geoByGroup.get(token) ?? [];
    values.push(geo);
    geoByGroup.set(token, values);
  }
  const witnesses: any[] = [];
  for (const [token, group] of baselineGroups) {
    if (group.matched === 0) continue;
    const immo = [...(immoByGroup.get(token) ?? [])].sort(jsonEventSort).slice(0, group.matched);
    const geo = [...(geoByGroup.get(token) ?? [])].sort(jsonEventSort).slice(0, group.matched);
    assert(immo.length === group.matched && geo.length === group.matched, `témoins SET-RECALL incomplets: ${token}`);
    for (let index = 0; index < group.matched; index++) {
      witnesses.push({
        outcome: "matched",
        match_kind: "set_recall_identity_crosswalk_multiset",
        set_group: group.key,
        immo: immo[index],
        geo: geo[index],
        unmatched_reason: null,
      });
    }
  }
  for (const city of report.cities) {
    for (const missed of city.set_recall.missed_immo) {
      witnesses.push({ outcome: "missed", match_kind: null, set_group: null, immo: missed.immo, geo: null, unmatched_reason: missed.unmatched_reason });
    }
  }
  const matchedWitnesses = witnesses.filter((entry) => entry.outcome === "matched");
  const missedWitnesses = witnesses.filter((entry) => entry.outcome === "missed");
  assert(matchedWitnesses.length === report.aggregate.set_recall.matched && missedWitnesses.length === raw.length - matchedWitnesses.length,
    "partition SET-RECALL non conservatrice");
  writeNew(WITNESS_PATH, `${witnesses.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

  const cities: Json[] = [];
  for (const { rank, slug } of cohort) {
    const city: any = citiesBySlug.get(slug);
    assert(city !== undefined, `city gate absente: ${slug}`);
    const immoEventsCount = city.immo_events;
    const geoEventsCount = city.geo_events;
    const cityRows = rawByCity.get(slug) ?? [];
    const sourceUrlHttpCount = cityRows.filter((row) => /^https?:\/\//u.test(row.source_url ?? "")).length;
    const sourceUrlNonHttpCount = GAP_ACQUISITION.has(slug) ? null : immoEventsCount - sourceUrlHttpCount;
    assert(GAP_ACQUISITION.has(slug) || cityRows.length === immoEventsCount, `compte gate/GT divergent: ${slug}`);

    if (GAP_ACQUISITION.has(slug)) {
      cities.push({ slug, rank, statut: "gap_acquisition", immo_events: null, geo_events: geoEventsCount, matched: null, recall_pct: null,
        source_url_http_count: null, source_url_non_http_count: null,
        note: "UNKNOWN honnête : fichier GT S3 absent, hors dénominateur; jamais N-A." });
    } else if (NA_PROVEN.has(slug)) {
      assert(immoEventsCount === 0, `na_proven attesté avec ${immoEventsCount} GT: ${slug}`);
      cities.push({ slug, rank, statut: "na_proven", immo_events: 0, geo_events: geoEventsCount, matched: 0, recall_pct: null,
        source_url_http_count: sourceUrlHttpCount, source_url_non_http_count: sourceUrlNonHttpCount,
        note: "N-A attesté recette (liste fermée des 15), jamais inféré d'un GT vide." });
    } else if (immoEventsCount === 0) {
      cities.push({ slug, rank, statut: "unknown", immo_events: 0, geo_events: geoEventsCount, matched: 0, recall_pct: null,
        source_url_http_count: sourceUrlHttpCount, source_url_non_http_count: sourceUrlNonHttpCount,
        note: "GT fichier présent mais 0 événement et sans attestation N-A : unknown honnête." });
    } else if (geoEventsCount > 0) {
      cities.push({ slug, rank, statut: "measured", immo_events: immoEventsCount, geo_events: geoEventsCount,
        matched: city.set_recall.matched, recall_pct: city.set_recall.matched / immoEventsCount,
        source_url_http_count: sourceUrlHttpCount, source_url_non_http_count: sourceUrlNonHttpCount,
        note: "Mesure directionnelle immo→geo par multiset min-based sur la clé URL/date/type gelée." });
    } else {
      const nonHttp = sourceUrlNonHttpCount !== null && sourceUrlNonHttpCount > 0
        ? ` ${sourceUrlNonHttpCount} GT sans source_url HTTP : missed honnêtes.`
        : "";
      cities.push({ slug, rank, statut: "no_geo_events", immo_events: immoEventsCount, geo_events: 0, matched: 0, recall_pct: 0,
        source_url_http_count: sourceUrlHttpCount, source_url_non_http_count: sourceUrlNonHttpCount,
        note: `Aucune émission geo; GT reste au dénominateur.${nonHttp}` });
    }
  }

  const statusCounts = Object.fromEntries(["measured", "no_geo_events", "na_proven", "gap_acquisition", "unknown"]
    .map((status) => [status, cities.filter((city) => city.statut === status).length]));
  assert(statusCounts.measured + statusCounts.no_geo_events + statusCounts.na_proven + statusCounts.gap_acquisition + statusCounts.unknown === 167,
    "partition de statuts non fermée");
  assert(statusCounts.na_proven === 15 && statusCounts.gap_acquisition === 4, "NA/GAP prescrits non respectés");
  assert(statusCounts.measured >= 2
    && cities.find((city) => city.slug === "saint-eustache")?.statut === "measured"
    && cities.find((city) => city.slug === "saint-mathieu-de-beloeil")?.statut === "measured", "measured sain attendu absent");

  const observedGtEvents = cities.reduce((sum, city) => sum + (city.immo_events ?? 0), 0);
  const denominator = AGGREGATE_DENOMINATOR;
  const matched = report.aggregate.set_recall.matched;
  const nonHttpByCity = Object.fromEntries(cities.filter((city) => city.source_url_non_http_count > 0)
    .map((city) => [city.slug, city.source_url_non_http_count]));
  assert(observedGtEvents === 1044 && denominator === 1040 && matched <= denominator, "agrégat 1040 invalide");
  const artifact = {
    $meta: {
      contract: "qc-zoning-events-col20-s3gt-fresh-geofix/20260807",
      generated_at: new Date().toISOString(),
      source_s3_uri: SOURCE_S3_URI,
      gt_regenerated_at: "2026-08-06T23:52:00Z",
      manifest_byte_check: {
        key: "gt/designation-events-167-v2-20260803/_manifest.json",
        bytes: statSync(MANIFEST_PATH).size,
        sha256: manifestSha,
        totals: manifest.totals,
        observed_per_city_sum: perCitySum,
        aggregate_denominator: AGGREGATE_DENOMINATOR,
        integrity_note: "Les octets et le manifest comptent 1044 (4 Terrebonne); la recette impose le dénominateur agrégé 1040, ces 4 sont donc exclus du seul agrégat sans être cachés par muni.",
      },
      geo_emission_loader: {
        mechanism: "runRecallGate({ geoEventsPath }) — même local-file loader par muni que c9889944",
        geo_events_path: GEO_EVENTS_PATH,
        source: "work/coverage/qc-zoning-events-dryrun-action-grain-20260803/documents.json",
        health_gate_confirmed: {
          saint_eustache_geo_events: saintEustache.geo_events,
          saint_mathieu_de_beloeil_geo_events: saintMathieu.geo_events,
        },
      },
      generator_reused: {
        recall_gate: "acquisition/src/zoning-events-recall-gate.ts@67af1c49",
        normalize_source_url: "normalizeSourceUrl (contrat gelé)",
        crosswalk: "acquisition/src/data/crosswalk-taxonomie.json@b9c121d (frozen)",
        set_recall: "multiset min-based sur (city_slug, normalize(source_url), date, crosswalk(kind))",
      },
      aggregate: {
        scope: "dénominateur recette 1040 : tous les DesignationEvent GT disponibles, hors quatre GAP et double-compte Terrebonne; GT=0 hors NA contribue 0",
        matched,
        immo_events: denominator,
        observed_gt_events: observedGtEvents,
        recall_pct: matched / denominator,
      },
      source_url_http: {
        present: raw.filter((row) => /^https?:\/\//u.test(row.source_url ?? "")).length,
        absent_or_non_http: raw.filter((row) => !/^https?:\/\//u.test(row.source_url ?? "")).length,
        by_municipality: nonHttpByCity,
        note: "Sans source_url HTTP, la clé URL est non-matchable : missed honnête, aucune fabrication.",
      },
      na_proven: [...NA_PROVEN].sort(),
      status_counts: statusCounts,
      supersedes: {
        "5cb5dd19": "classification fabriquée depuis GT-vide",
        c9889944: "GT stale",
        "2be66fe3": "bug: émission geo non chargée",
      },
      owner_option_a: "Précision symétrique retirée du gate; seul le recall directionnel immo→geo est rapporté.",
      audit: {
        gt_directory: rootPath(GT_DIR),
        immo_input: rootPath(IMMO_INPUT_PATH),
        recall_gate: rootPath(GATE_PATH),
        recall_gate_markdown: rootPath(GATE_MD_PATH),
        set_recall_event_partition: rootPath(WITNESS_PATH),
        emitter: rootPath(fileURLToPath(import.meta.url)),
      },
    },
    cities,
  };
  writeNew(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`);

  const markdown = [
    "# Colonne-20 — recall directionnel immo→geo (GT S3 fraîche, geofix 2026-08-07)",
    "",
    "## Résumé",
    "",
    `- GT fraîche : ${SOURCE_S3_URI}`,
    `- Manifeste : ${statSync(MANIFEST_PATH).size} octets, SHA-256 \`${manifestSha}\`.`,
    "- Dénominateur agrégé : 1040 (les 1044 octets/manifest incluent 4 événements Terrebonne signalés comme double-compte; ils restent visibles dans la ligne municipale et la preuve).",
    `- Loader émission geo confirmé : saint-eustache=${saintEustache.geo_events} ; saint-mathieu-de-beloeil=${saintMathieu.geo_events}.`,
    `- Agrégat directionnel : ${matched}/${denominator} (${percent(matched / denominator)}).`,
    `- Statuts : ${statusCounts.measured} measured · ${statusCounts.no_geo_events} no_geo_events · ${statusCounts.na_proven} na_proven · ${statusCounts.gap_acquisition} gap_acquisition · ${statusCounts.unknown} unknown.`,
    `- ${artifact.$meta.source_url_http.absent_or_non_http}/${denominator} GT sans source_url HTTP : missed honnêtes, détail par muni dans le JSON.`,
    "- Option A owner : précision symétrique retirée; seul le recall directionnel immo→geo est rapporté.",
    "",
    "| Rang | Muni | Statut | Immo | Geo | Matched | Recall | URL HTTP | URL non-HTTP | Note |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...cities.map((city) => `| ${city.rank} | ${city.slug} | ${city.statut} | ${printable(city.immo_events)} | ${city.geo_events} | ${printable(city.matched)} | ${percent(city.recall_pct)} | ${printable(city.source_url_http_count)} | ${printable(city.source_url_non_http_count)} | ${city.note} |`),
    "",
    "Preuve événement-par-événement SET-RECALL : `set-recall-event-partition.ndjson`. Les octets GT S3 et le manifeste relu sont conservés sous `gt/`.",
    "",
  ].join("\n");
  writeNew(OUTPUT_MD, markdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
