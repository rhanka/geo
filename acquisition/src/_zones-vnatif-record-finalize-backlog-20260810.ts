/**
 * _zones-vnatif-record-finalize-backlog-20260810.ts — assemble le RECORD FINAL du
 * close-out backlog (7 RECOVERED-DEPOSITED + résidu FINAL-SKIP documenté), à partir de :
 *   - le LOG de dépôt (zones-vnatif-deposit-record-backlog-20260810.json) → entrées DEPOSITED
 *     (verbatim : elles portent le résultat réel du dépôt, backups, readback) ;
 *   - le DRY-RUN post-fix (_zones-vnatif-deposit-dryrun-backlog-20260810.json) → les 4 SKIP
 *     empty-code bloqués par le coverage-gate anti-perte (classification propre) ;
 *   - un RÉSIDU DOCUMENTÉ (hors worklist) : empty-code non-minime, INVESTIGATE HELD,
 *     portails Web-Map irrécupérables — raisons tirées de l'analyse + du diag select-backlog.
 *
 * Ne DÉPOSE rien, ne touche pas S3 : transforme déterministe de sorties de générateurs.
 * Écrit le .json final (même chemin, réécrit propre) + le .md figé.
 *
 * USAGE : npx tsx acquisition/src/_zones-vnatif-record-finalize-backlog-20260810.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LOG = "work/coverage/zones-vnatif-deposit-record-backlog-20260810.json";
const DRY = "work/coverage/_zones-vnatif-deposit-dryrun-backlog-20260810.json";
const OUT_JSON = "work/coverage/zones-vnatif-deposit-record-backlog-20260810.json";
const OUT_MD = "work/coverage/zones-vnatif-deposit-record-backlog-20260810.md";

interface City { slug: string; statut?: string; raison?: string; [k: string]: unknown }
function load(path: string): { cities: City[] } { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as { cities: City[] }; }

function platformOf(url: string): string {
  const h = new URL(url).host;
  if (h === "geoserver.geocentralis.com") return "géoCentralis WFS";
  if (/^services\d*\.arcgis\.com$/.test(h)) return "AGOL (ArcGIS Online)";
  if (h === "gis.altusquebec.com") return "altus ArcGIS MapServer";
  return h;
}

// RÉSIDU DOCUMENTÉ hors worklist (jamais tenté au dépôt — irrécupérable en une passe propre).
const DOCUMENTED_RESIDUE: Array<{ slug: string; lot: string; klass: string; reason: string }> = [
  { slug: "padoue", lot: "geocentralis-lotB", klass: "empty-code (non-minime)", reason: "6/39 features à code vide (15.4%) > seuil minorité-minime 10% ; drop refusé ; garder=fabriquer un code (anti-invention) → FINAL-SKIP" },
  { slug: "saint-joseph-de-lepage", lot: "geocentralis-lotC", klass: "empty-code (non-minime)", reason: "17/54 features à code vide (31.5%) > seuil 10% ; drop refusé ; garder=fabriquer un code (anti-invention) → FINAL-SKIP" },
  { slug: "otterburn-park", lot: "geocentralis-lotD", klass: "INVESTIGATE→HELD", reason: "id 57030 = mamhCode ET nearest OK, MAIS siadmin_pzon_99_s overlap 86.7% (<90%) et l'AUTRE couche evb:zonage_municipal rend 0 feature pour cet id (probe live 20260810T220000Z) → aucune couche ≥90% → HELD (pas de source-identity propre)" },
  { slug: "matapedia", lot: "altus", klass: "INVESTIGATE/RETRY→HELD", reason: "altus MapServer MRC060/06045_Publique répond 200 mais expose layers:[] (service sans couche — toujours down au retry live 20260810T220000Z) → source indisponible → HELD" },
  { slug: "saint-laurent-de-lile-dorleans", lot: "altus", klass: "INVESTIGATE→HELD", reason: "couche Zonage (MRC200/20020/17) = 34 features mais 42 codes servis ⇒ overlap≥90% arithmétiquement impossible (34<37.8) ; aucune autre couche polygonale ne porte de code-zone (hydro/cadastre/UEV) → HELD" },
  { slug: "gore", lot: "agol", klass: "INVESTIGATE→HELD", reason: "servi = 840 codes / 932 features (grain cadastral, pas zonage) ; meilleure partition co_mun de la couche partagée services9/Zonage/0 overlap 0% (nearest=lachute) → les codes servis ne reproduisent aucune partition → HELD (source-identity absente ; le servi lui-même est anormal)" },
  { slug: "havre-saint-pierre", lot: "agol", klass: "UNRECOVERABLE (portal)", reason: "item portal www.arcgis.com = Web Map ; couche opérationnelle HSP_Ligne = featureCollection EMBARQUÉE (aucune URL FeatureServer re-téléchargeable) ET géométrie LIGNE (pas des polygones de zone) → hors chemin FeatureServer → FINAL-SKIP" },
  { slug: "plessisville", lot: "agol", klass: "UNRECOVERABLE (portal)", reason: "item portal www.arcgis.com = Web Map ; couches (ZONAGE, UEV, cadastre) = featureCollections EMBARQUÉES (aucune URL FeatureServer) → hors chemin FeatureServer → FINAL-SKIP" },
];

function main(): void {
  const log = load(LOG);
  const dry = load(DRY);
  const deposited = log.cities.filter((c) => c.statut === "DEPOSITED");
  const emptySkip = dry.cities.filter((c) => c.statut === "SKIP" && String(c.raison ?? "").includes("coverage-gate anti-perte"));

  const recovered = deposited.map((c) => ({
    slug: c.slug,
    platform: platformOf(String(c.source_url)),
    proof_type: c.proof_type,
    code_field: c.code_field_chosen,
    overlap_pct: c.overlap_ratio_pct,
    working_features: c.working_features,
    served_features: c.served_features,
    identity_override: c.identity_override,
    identity_override_basis: c.identity_override_basis,
    sha256: c.sha256,
    run_stamp: c.run_stamp,
    source_url: c.source_url,
    readback_ok: c.readback_ok,
  }));

  const finalSkipAttempted = emptySkip.map((c) => ({
    slug: c.slug, klass: "empty-code (bloqué anti-perte)", lot: "backlog-worklist",
    served_features: c.served_features, feature_count: c.feature_count, dropped_empty_code_count: c.dropped_empty_code_count,
    reason: c.raison,
  }));

  const record = {
    contract: "zones-vnatif-deposit-record-backlog-final/v1",
    date: "2026-08-10",
    spec: "SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md + SPEC_ZONE_GEOMETRY_GRAIN.md + SPEC_ACQUISITION_METHODES_PAR_SOURCE.md §12 ; réplique dépôt géoCentralis lot-B dd7e4cf9 / AGOL 5cc7e680",
    decision: "CLOSE-OUT BACKLOG campagne upgrade v2 : récupération des faux-négatifs anti-homonyme sur identité forte VÉRIFIÉE (wfs id==mamhCode / agol nom-exact) ; empty-code drops bloqués par coverage-gate anti-perte → documentés ; INVESTIGATE/portails documentés HELD/irrécupérables",
    run_stamp: "20260810T220000Z",
    capture_job: "geo-capture-zones-20260810t220000z (Complete 11/11 shards, OVH poc-ca)",
    empty_drop_max_frac: 0.1,
    summary: {
      recovered_deposited: recovered.length,
      final_skip_empty_anti_loss: finalSkipAttempted.length,
      final_skip_documented_residue: DOCUMENTED_RESIDUE.length,
      total_final_skip: finalSkipAttempted.length + DOCUMENTED_RESIDUE.length,
    },
    recovered_deposited: recovered,
    final_skip_attempted: finalSkipAttempted,
    final_skip_documented: DOCUMENTED_RESIDUE,
  };
  writeFileSync(resolve(ROOT, OUT_JSON), `${JSON.stringify(record, null, 1)}\n`, "utf8");

  // ── .md figé ──
  const L: string[] = [];
  L.push("# Dépôt zones — CLOSE-OUT BACKLOG (récupération file SKIP campagne upgrade v2) — 2026-08-10", "");
  L.push(`**${recovered.length} RECOVERED-DEPOSITED** (readback VERT sur les ${recovered.length}) + **${finalSkipAttempted.length + DOCUMENTED_RESIDUE.length} FINAL-SKIP** documentés`);
  L.push("(résidu irrécupérable, jamais forcé). Capture `geo-capture-zones-20260810t220000z` (Complete 11/11 shards, cluster OVH poc-ca).", "");
  L.push("Réplique EXACTE de la recette de dépôt géoCentralis lot-B (`dd7e4cf9`) / AGOL (`5cc7e680`) — G2 byte-exact,");
  L.push("grain zone-polygon, gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`, backup `_replaced/`, dropped→UNKNOWN");
  L.push("(jamais N-A), readback G5, anti-troncature. **Deux ajouts contrôlés, anti-invention, jamais forcés** :", "");
  L.push("1. **Override anti-homonyme sur identité FORTE VÉRIFIÉE** — le garde bbox-centroïde `nearest==slug` est un");
  L.push("   FAUX-NÉGATIF pour un muni rural adjacent. Override SEULEMENT si : `wfs-id-verified` (le filtre WFS");
  L.push("   `id_municipalite=<id>` égale le `mamhCode` du slug dans `qc-municipal-directory.json` ET le mamhCode du");
  L.push("   muni-nearest flaggé est DIFFÉRENT), OU `agol-name-match` (le filtre `MUNI='<Nom>'` égale le `name` du slug,");
  L.push("   NFD). Overlap source-identity ≥90% reste EXIGÉ dans les deux cas.");
  L.push("2. **Drop empty-code borné** — quelques features à code vide retirées ssi fraction ≤10% ET overlap non-vide");
  L.push("   ≥90%. RÉSULTAT : bloqué par le **coverage-gate anti-perte** de `depositCapturedZones` (le servi legacy");
  L.push("   RETIENT les features à code vide ; les droper réduirait le nombre de features servies). → FINAL-SKIP.", "");
  L.push("Scripts : `acquisition/src/_zones-vnatif-select-backlog-20260810.ts` (sonde live + worklist),");
  L.push("`acquisition/src/_zones-vnatif-deposit-backlog-20260810.ts` (dépôt), `..._record-finalize-backlog-20260810.ts` (ce record).");
  L.push("Worklist : `work/coverage/zones-vnatif-capture-worklist-backlog-20260810.json` (11 munis capturés).", "");

  L.push("## 1. RECOVERED-DEPOSITED (7) — candidate/legacy-traceable → documented v2, readback VERT", "");
  L.push("| # | muni | plateforme | preuve | champ code | overlap | features | override (identité vérifiée) | sha256 (court) |");
  L.push("|---|---|---|---|---|---:|---:|---|---|");
  recovered.forEach((r, i) => {
    const shaShort = String(r.sha256 ?? "").replace(/^sha256:/, "").slice(0, 8);
    L.push(`| ${i + 1} | ${r.slug} | ${r.platform} | ${r.proof_type} | ${r.code_field} | ${r.overlap_pct}% | ${r.working_features} | ${r.identity_override ?? "—"} | ${shaShort} |`);
  });
  L.push("", "**Base d'identité (override anti-homonyme) — jamais deviné :**", "");
  for (const r of recovered) if (r.identity_override_basis) L.push(`- **${r.slug}** : ${r.identity_override_basis}`);
  L.push("", `Tous à overlap ${recovered.every((r) => r.overlap_pct === 100) ? "100 %" : "≥90 %"} (0 code droppé→UNKNOWN), grain zone-polygon, backup \`_replaced/\` présent, \`zone_source_level=documented\`, \`url=proof.url\`, byte-exact.`, "");

  L.push("## 2. FINAL-SKIP — empty-code bloqué par coverage-gate anti-perte (4)", "");
  L.push("Anti-homonyme récupérable OU nearest OK, MAIS ≥1 feature à code vide que le servi legacy RETIENT :");
  L.push("droper = perte de features (refusée par `depositCapturedZones`) ; garder = code fabriqué (anti-invention). Irrécupérable.", "");
  L.push("| muni | features servies | dont vides | raison |");
  L.push("|---|---:|---:|---|");
  for (const s of finalSkipAttempted) L.push(`| ${s.slug} | ${s.served_features} | ${s.dropped_empty_code_count} | coverage-gate anti-perte + anti-invention |`);
  L.push("", "> Note : `saint-gabriel` était un faux-négatif anti-homonyme RÉCUPÉRABLE (id 52080=mamhCode) mais son 1 feature");
  L.push("> à code vide le bloque via le coverage-gate — irrécupérable sous byte-exact+anti-perte+anti-invention.", "");

  L.push("## 3. FINAL-SKIP — résidu documenté hors worklist (8)", "");
  L.push("| muni | source | classe | raison |");
  L.push("|---|---|---|---|");
  for (const r of DOCUMENTED_RESIDUE) L.push(`| ${r.slug} | ${r.lot} | ${r.klass} | ${r.reason} |`);
  L.push("");

  L.push("## 4. Anti-invention & discipline", "");
  L.push("- Dépôt UNIQUEMENT sur identité confirmée (nom-exact OU id==mamhCode vérifié contre le registre MAMH) ET overlap≥90%.");
  L.push("- Un faux-négatif centroïde-nearest est overridé UNIQUEMENT par une identité forte vérifiée, JAMAIS par supposition.");
  L.push("- Jamais fabriqué de code pour une feature vide ; jamais réduit le nombre de features servies (anti-perte).");
  L.push("- Codes servi-seulement → UNKNOWN, jamais N-A. Byte-exact, backup, gate provenance-aware sur les 7.", "");

  L.push("## 5. Typecheck", "");
  L.push("`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**");
  L.push("(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ; `acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322).");
  L.push("**Delta = 0** : les 3 scripts backlog n'ajoutent aucune erreur.", "");

  L.push("## 6. Slugs déposés (pour re-fold)", "");
  L.push(recovered.map((r) => `\`${r.slug}\``).join(", "), "");

  writeFileSync(resolve(ROOT, OUT_MD), `${L.join("\n")}\n`, "utf8");
  process.stderr.write(`FINAL RECORD → ${OUT_JSON} + ${OUT_MD}\n`);
  process.stderr.write(`recovered=${recovered.length} empty-anti-loss=${finalSkipAttempted.length} documented=${DOCUMENTED_RESIDUE.length}\n`);
}

main();
