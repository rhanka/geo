/**
 * Projection read-only du gate col-20 v2 vers le livrable WP5 demandé.
 *
 * La métrique n'est pas réimplémentée ici : `recall-gate.json` provient du
 * harnais gelé et les témoins SET-RECALL réutilisent `setRecallFor` pour
 * reconstruire uniquement l'appariement déterministe déjà décidé par le
 * multiset (premiers événements triés par JSON dans chaque groupe).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { setRecallFor } from "../../../acquisition/src/zoning-events-recall-gate.ts";

const AUDIT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(AUDIT, "../../..");
const STEM = "zoning-events-col20-167-s3gt-v2-20260803";
const OUTPUT_JSON = join(ROOT, "work/coverage", `${STEM}.json`);
const OUTPUT_MD = join(ROOT, "work/coverage", `${STEM}.md`);
const GT_DIR = join(AUDIT, "gt-v2");
const MANIFEST_PATH = join(GT_DIR, "_manifest.json");
const FLAT_INPUT_PATH = join(AUDIT, "gt-v2-flat.ndjson");
const GATE_PATH = join(AUDIT, "recall-gate.json");
const WITNESS_PATH = join(AUDIT, "set-recall-event-partition.ndjson");
const COHORT_PATH = join(ROOT, "work/coverage/zoning-events-col20-167-s3gt-20260803.audit/cohort-167.tsv");

const SOURCE_S3_URI = "s3://radar-immobilier-docs-pocs/gt/designation-events-167-v2-20260803/";
const GAP_ACQUISITION = new Set([
  "kirkland",
  "lile-dorval",
  "marieville",
  "notre-dame-de-stanbridge",
]);
const NA_PROVEN = new Map([
  ["franklin", "2026-06-11"],
  ["montreal-ouest", "2026-06-11"],
  ["saint-charles-sur-richelieu", "2026-06-12"],
  ["saint-chrysostome", "2026-06-12"],
  ["senneville", "2026-06-11"],
  ["terrasse-vaudreuil", "2026-06-12"],
  ["vercheres", "2026-06-11"],
]);

function fail(message: string): never {
  throw new Error(`col20 v2: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonEventSort(left: any, right: any): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function groupToken(key: any): string {
  return JSON.stringify([key.muni, key.source_url_norm, key.date_iso, key.crosswalked_type]);
}

function rawSourceFields(row: any): Record<string, unknown> {
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

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)} %`;
}

function printable(value: number | null): string {
  return value === null ? "—" : String(value);
}

function writeNew(path: string, body: string): void {
  if (existsSync(path)) fail(`refus d'écraser ${path}`);
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

function main(): void {
  assert(!existsSync(OUTPUT_JSON) && !existsSync(OUTPUT_MD) && !existsSync(WITNESS_PATH), "sortie déjà présente");

  const manifestBytes = readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
  const raw = readFileSync(FLAT_INPUT_PATH, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  const gate = readJson(GATE_PATH);
  const cohort = readFileSync(COHORT_PATH, "utf8").trim().split(/\r?\n/u).slice(1).map((line) => {
    const [rank, slug] = line.split("\t");
    return { rank: Number(rank), slug };
  });

  assert(cohort.length === 167, `cohorte attendue 167, reçue ${cohort.length}`);
  assert(manifest.totals.cities === 167 && manifest.totals.citiesWithGraph === 163 && manifest.totals.citiesAbsent === 4,
    "partition S3 v2 inattendue");
  assert(manifest.totals.events === 1018 && raw.length === 1018, "compte DesignationEvent v2 inattendu");
  assert(manifest.totals.sourceUrlHttp === 686, "compte source_url HTTP v2 inattendu");
  assert(Object.keys(manifest.perCity).filter((slug) => manifest.perCity[slug].events === -1).sort().join(",")
    === [...GAP_ACQUISITION].sort().join(","), "GAP S3 v2 différent des quatre GAP autorisés");

  const rawByCity = new Map<string, any[]>();
  const rawById = new Map<string, any>();
  for (const row of raw) {
    assert(row.node_type === "DesignationEvent", `node_type non autorisé dans GT v2: ${String(row.node_type)}`);
    assert(typeof row.city_slug === "string" && typeof row.node_id === "string", "clé naturelle GT v2 incomplète");
    const rows = rawByCity.get(row.city_slug) ?? [];
    rows.push(row);
    rawByCity.set(row.city_slug, rows);
    assert(!rawById.has(row.node_id), `node_id GT v2 dupliqué: ${row.node_id}`);
    rawById.set(row.node_id, row);
  }
  for (const { slug } of cohort) {
    const listed = manifest.perCity[slug];
    assert(listed !== undefined, `muni absente du manifeste: ${slug}`);
    if (GAP_ACQUISITION.has(slug)) continue;
    assert(listed.events === (rawByCity.get(slug) ?? []).length, `compte GT divergent pour ${slug}`);
  }

  const citiesBySlug = new Map(gate.cities.map((city: any) => [city.slug, city]));
  assert(citiesBySlug.size === 167, "gate sans 167 villes");
  const immoEvents = gate.cities.flatMap((city: any) => city.partition.missed.map((entry: any) => entry.immo));
  const geoEvents = gate.cities.flatMap((city: any) => city.partition.extra.map((entry: any) => entry.geo));
  assert(immoEvents.length === 1018 && geoEvents.length === 414, "partition stricte du gate incomplète");
  for (const event of immoEvents) {
    const id = event.source_fields.event_id;
    assert(typeof id === "string" && rawById.has(id), `preuve immo sans ligne GT: ${String(id)}`);
    assert(JSON.stringify(event.source_fields) === JSON.stringify(rawSourceFields(rawById.get(id))),
      `source_fields non verbatim pour ${id}`);
  }

  // Les groups sont produits par le set-recall gelé. Chaque appel unitaire ne
  // fait que retrouver son groupe; le choix des témoins reprend le tri déjà
  // utilisé par le harnais, sans règle de rapprochement supplémentaire.
  const baselineGroups = new Map<string, any>(gate.aggregate.set_recall.groups.map((group: any) => [groupToken(group.key), group]));
  const immoByGroup = new Map<string, any[]>();
  for (const immo of immoEvents) {
    const one = setRecallFor(geoEvents, [immo], 1);
    // `geoEvents` porte tous les groupes de la cohorte; le premier groupe
    // trié peut donc appartenir à une autre ville. L'unique groupe dont
    // `immo_count` vaut 1 est celui de cet event unitaire.
    const group = one.groups.find((candidate: any) => candidate.immo_count === 1);
    if (group === undefined) continue;
    const token = groupToken(group.key);
    if ((baselineGroups.get(token)?.matched ?? 0) === 0) continue;
    const values = immoByGroup.get(token) ?? [];
    values.push(immo);
    immoByGroup.set(token, values);
  }

  const selectedImmo: any[] = [];
  for (const [token, group] of baselineGroups) {
    if (group.matched === 0) continue;
    const values = [...(immoByGroup.get(token) ?? [])].sort(jsonEventSort);
    assert(values.length === group.immo_count, `témoins immo incomplets pour ${token}`);
    selectedImmo.push(...values.slice(0, group.matched));
  }
  assert(selectedImmo.length === gate.aggregate.set_recall.matched, "témoins immo matched divergents");

  const geoByGroup = new Map<string, any[]>();
  for (const geo of geoEvents) {
    const one = setRecallFor([geo], selectedImmo, 1);
    const group = one.groups.find((candidate: any) => candidate.geo_count === 1);
    if (group === undefined) continue;
    const token = groupToken(group.key);
    if ((baselineGroups.get(token)?.matched ?? 0) === 0) continue;
    const values = geoByGroup.get(token) ?? [];
    values.push(geo);
    geoByGroup.set(token, values);
  }

  const witnesses: any[] = [];
  for (const [token, group] of baselineGroups) {
    if (group.matched === 0) continue;
    const immo = [...(immoByGroup.get(token) ?? [])].sort(jsonEventSort).slice(0, group.matched);
    const geo = [...(geoByGroup.get(token) ?? [])].sort(jsonEventSort).slice(0, group.matched);
    assert(immo.length === group.matched && geo.length === group.matched, `témoins SET-RECALL incomplets pour ${token}`);
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
  for (const city of gate.cities) {
    for (const missed of city.set_recall.missed_immo) {
      witnesses.push({
        outcome: "missed",
        match_kind: null,
        set_group: null,
        immo: missed.immo,
        geo: null,
        unmatched_reason: missed.unmatched_reason,
      });
    }
  }
  const matchedWitnesses = witnesses.filter((entry) => entry.outcome === "matched");
  const missedWitnesses = witnesses.filter((entry) => entry.outcome === "missed");
  assert(matchedWitnesses.length === 62 && missedWitnesses.length === 956 && witnesses.length === 1018,
    "partition SET-RECALL non conservatrice");
  writeNew(WITNESS_PATH, `${witnesses.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

  const cities: any[] = [];
  for (const { rank, slug } of cohort) {
    const city = citiesBySlug.get(slug);
    assert(city !== undefined, `city gate absente: ${slug}`);
    const immoEventsCount = city.immo_events;
    const geoEventsCount = city.geo_events;
    const sourceUrlHttpCount = (rawByCity.get(slug) ?? []).filter((row) => /^https?:\/\//u.test(row.source_url ?? "")).length;
    const sourceUrlNonHttpCount = GAP_ACQUISITION.has(slug) ? null : immoEventsCount - sourceUrlHttpCount;

    if (GAP_ACQUISITION.has(slug)) {
      cities.push({
        slug, rank, statut: "gap_acquisition", immo_events: null, geo_events: geoEventsCount,
        matched: null, recall_pct: null, source_url_http_count: null,
        note: "UNKNOWN honnête : fichier GT v2 S3 absent, hors dénominateur; jamais N-A.",
      });
      continue;
    }
    const naDate = NA_PROVEN.get(slug);
    if (naDate !== undefined) {
      assert(immoEventsCount === 0, `N-A attesté avec ${immoEventsCount} DesignationEvent: ${slug}`);
      cities.push({
        slug, rank, statut: "na_proven", immo_events: 0, geo_events: geoEventsCount,
        matched: 0, recall_pct: null, source_url_http_count: sourceUrlHttpCount,
        note: `N-A prouvé : PV parsés, date_scrape=${naDate}, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed.`,
      });
      continue;
    }
    if (geoEventsCount > 0) {
      assert(immoEventsCount > 0, `muni measured sans dénominateur immo: ${slug}`);
      cities.push({
        slug, rank, statut: "measured", immo_events: immoEventsCount, geo_events: geoEventsCount,
        matched: city.set_recall.matched, recall_pct: city.set_recall.matched / immoEventsCount,
        source_url_http_count: sourceUrlHttpCount,
        note: "Mesure directionnelle immo→geo par multiset min-based sur la clé URL/date/type gelée.",
      });
      continue;
    }
    const noHttpNote = sourceUrlNonHttpCount && sourceUrlNonHttpCount > 0
      ? ` ${sourceUrlNonHttpCount} événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes.`
      : "";
    cities.push({
      slug, rank, statut: "no_geo_events", immo_events: immoEventsCount, geo_events: 0,
      matched: 0, recall_pct: immoEventsCount === 0 ? null : 0, source_url_http_count: sourceUrlHttpCount,
      note: `incomplete/pending : aucune émission geo; GT conservée au dénominateur.${noHttpNote}`,
    });
  }

  const summary = {
    measured: cities.filter((city) => city.statut === "measured"),
    noGeo: cities.filter((city) => city.statut === "no_geo_events"),
    na: cities.filter((city) => city.statut === "na_proven"),
    gap: cities.filter((city) => city.statut === "gap_acquisition"),
  };
  assert(summary.measured.length === 2 && summary.noGeo.length === 154 && summary.na.length === 7 && summary.gap.length === 4,
    "partition de statuts v2 inattendue");
  const matchedMeasured = summary.measured.reduce((total, city) => total + city.matched, 0);
  const immoMeasured = summary.measured.reduce((total, city) => total + city.immo_events, 0);
  assert(matchedMeasured === 62 && immoMeasured === 68, "agrégat measured v2 inattendu");

  const naProvenance = Object.fromEntries([...NA_PROVEN].map(([slug, dateScrape]) => [slug, {
    source: "docs/reports/recette/OPTIONA_NA_FINAL.txt",
    conductor_message: "env-cond-geojoint-7na-confirmed",
    attestation: "PV parsed, date_scrape, 0 DesEvent prod densifiant",
    date_scrape: dateScrape,
  }]));
  const artifact = {
    $meta: {
      contract: "qc-zoning-events-col20-s3gt-v2/20260803",
      generated_at: new Date().toISOString(),
      source_s3_uri: SOURCE_S3_URI,
      manifest_byte_check: {
        key: "gt/designation-events-167-v2-20260803/_manifest.json",
        bytes: statSync(MANIFEST_PATH).size,
        sha256: manifestSha,
        summary: manifest.totals,
      },
      geo_events_source: "work/coverage/qc-zoning-events-dryrun-action-grain-20260803/documents.json",
      generator_reused: {
        col20: "acquisition/src/zoning-events-cohort-col20.ts@3929fda0 (exécuté: audit/col20-generator.json)",
        recall_gate: "acquisition/src/zoning-events-recall-gate.ts@67af1c49 (exécuté: audit/recall-gate.json)",
        prior_s3gt_artifact: "79985bfd (non écrasé)",
        set_recall: "multiset min-based sur (muni, source_url_norm, date_iso, type-crosswalké)",
        crosswalk: "acquisition/src/data/crosswalk-taxonomie.json@b9c121d (frozen)",
      },
      source_url_http: {
        present: manifest.totals.sourceUrlHttp,
        absent_or_non_http: manifest.totals.events - manifest.totals.sourceUrlHttp,
        note: "Sans source_url HTTP, la clé URL est non-matchable : missed honnête, aucune fabrication.",
      },
      aggregate: {
        scope: "munis measured seulement",
        matched: matchedMeasured,
        immo_events: immoMeasured,
        recall_pct: matchedMeasured / immoMeasured,
      },
      status_counts: {
        measured: summary.measured.length,
        no_geo_events: summary.noGeo.length,
        na_proven: summary.na.length,
        gap_acquisition: summary.gap.length,
      },
      na_provenance: naProvenance,
      saint_mathieu_resolution: {
        resolution: "Slugs distincts, non fusionnés : saint-mathieu (Roussillon) et saint-mathieu-de-beloeil.",
        saint_mathieu: { slug: "saint-mathieu", immo_events: 10, source_url_http_count: 0, statut: "no_geo_events" },
        saint_mathieu_de_beloeil: { slug: "saint-mathieu-de-beloeil", immo_events: 18, geo_events: 37, matched: 12, statut: "measured" },
      },
      owner_option_a: "Précision symétrique retirée du gate par décision owner Option A; seul le recall directionnel immo→geo est rapporté.",
      audit: {
        raw_gt_v2_directory: `work/coverage/${STEM}.audit/gt-v2/`,
        flat_input: `work/coverage/${STEM}.audit/gt-v2-flat.ndjson`,
        recall_gate: `work/coverage/${STEM}.audit/recall-gate.json`,
        set_recall_event_partition: `work/coverage/${STEM}.audit/set-recall-event-partition.ndjson`,
      },
    },
    cities,
  };
  writeNew(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`);

  const markdown = [
    "# Colonne-20 — recall directionnel immo→geo (GT S3 v2, 2026-08-03)",
    "",
    "## Résumé",
    "",
    `- GT v2 : ${SOURCE_S3_URI}`,
    `- Manifeste vérifié : ${statSync(MANIFEST_PATH).size} octets, SHA-256 \`${manifestSha}\`.`,
    `- Agrégat directionnel sur les munis measured : ${matchedMeasured}/${immoMeasured} (${percent(matchedMeasured / immoMeasured)}).`,
    `- Statuts : ${summary.measured.length} measured · ${summary.noGeo.length} no_geo_events · ${summary.na.length} na_proven · ${summary.gap.length} gap_acquisition.`,
    `- ${manifest.totals.events - manifest.totals.sourceUrlHttp}/${manifest.totals.events} GT sans source_url HTTP sont des missed honnêtes, non matchables par URL.`,
    "- Option A owner : la précision symétrique est retirée du gate; seul le recall directionnel immo→geo est rapporté.",
    "- Saint-Mathieu : slugs distincts, non fusionnés — `saint-mathieu` = 10 GT; `saint-mathieu-de-beloeil` = 18 GT, 12 matched.",
    "",
    "| Rang | Muni | Statut | Immo | Geo | Matched | Recall | URL HTTP | Note |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...cities.map((city) => `| ${city.rank} | ${city.slug} | ${city.statut} | ${printable(city.immo_events)} | ${city.geo_events} | ${printable(city.matched)} | ${percent(city.recall_pct)} | ${printable(city.source_url_http_count)} | ${city.note} |`),
    "",
    "Preuve événement-par-événement SET-RECALL (matched + missed, `source_fields` verbatim) : `set-recall-event-partition.ndjson`. Les octets GT v2 et le manifeste relu sont conservés dans `gt-v2/`.",
    "",
  ].join("\n");
  writeNew(OUTPUT_MD, markdown);
}

main();
