#!/usr/bin/env node
// MANIFESTE DE CORROBORATION COL-1 (zones) — job garant conducteur 2026-08-09
// (work/coverage/qa-job-20260809.md). Pour les 163 villes MATCHÉES de la cohorte
// 167 (set-167-bprime), atteste la PROVENANCE de la cellule col-1 avec la
// sémantique RATIFIÉE par la conductrice :
//   source_origin="v"            = géométrie servie via dépôt VECTEUR-NATIF
//                                  (GOnet/ArcGIS/WFS), preuve v2 (url+retrieved_at+sha256).
//   v2_acquisition_readiness="v2-served" = zone servie AVEC preuve v2 intacte et
//                                  rattachée (sha256 cohérent S3) — eligible recall v3.4.
//
// ANTI-INVENTION (contraintes du job) :
//  - v2_acquisition_readiness="v2-served" UNIQUEMENT si une attestation garant
//    vecteur-natif PASS-BANC (committée lane/qa) EXISTE pour le slug ET que la
//    ville est réellement SERVIE (dépôt confirmé). Sinon → "unknown", JAMAIS
//    "v2-served" par défaut.
//  - source_origin dérivé d'un fait committé (attestation v2, ou manifeste de
//    provenance 07-22) ; jamais deviné. Absent des deux → "unknown".
//  - N-A seulement si la source autoritaire le porte (pas d'inférence depuis GT-vide).
//
// Déterministe, LOCAL (aucun S3/réseau) : lit uniquement des artefacts committés.
// Usage : node scripts/generate-col1-corroboration-manifest.mjs        # écrit le JSON
//         node scripts/generate-col1-corroboration-manifest.mjs --check # valide, n'écrit pas
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const CHECK = process.argv.slice(2).includes('--check');
const AS_OF = '2026-08-09';

const rel = (p) => path.relative(ROOT, p);
const sha256File = (p) => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function loadJson(role, abs, { optional = false } = {}) {
  if (!fs.existsSync(abs)) { if (optional) return { role, abs, present: false, json: null }; throw new Error(`source absente: ${role} (${rel(abs)})`); }
  return { role, abs, present: true, json: JSON.parse(fs.readFileSync(abs, 'utf8')), sha256: sha256File(abs) };
}

// ---- sources committées -----------------------------------------------------
const S = {
  cohort: loadJson('cohort-167', path.join(COV, 'palier-matrix-cohort-167.json')),
  zones: loadJson('completion-1-zones', path.join(COV, 'completion-1-zones-matrix-20260723.json')),
  prov: loadJson('zone-provenance-status-manifest', path.join(COV, 'zone-provenance-status-manifest-20260722.json')),
  attGonet: loadJson('vecteur-natif-attestation-gonet', path.join(COV, 'vecteur-natif-attestation-20260803.json')),
  attArcgis: loadJson('vecteur-natif-attestation-arcgis', path.join(COV, 'vecteur-natif-attestation-arcgis-20260803.json')),
};

// ---- index par slug ---------------------------------------------------------
// col-1 state (source autoritaire figée 07-23)
const zoneState = new Map();
for (const c of S.zones.json.cities ?? []) if (c?.slug) zoneState.set(c.slug, c.state);

// provenance manifeste r2 (row_fields/rows positionnels)
const provBySlug = new Map();
{
  const rf = S.prov.json.row_fields ?? [];
  const idx = Object.fromEntries(rf.map((f, i) => [f, i]));
  for (const row of S.prov.json.rows ?? []) {
    const slug = row[idx.slug];
    if (slug == null) continue;
    provBySlug.set(slug, {
      collection_key: row[idx.collection_key] ?? null,
      source_origin: row[idx.source_origin] ?? null,
      v2_acquisition_readiness: row[idx.v2_acquisition_readiness] ?? null,
      provenance_state: row[idx.provenance_state] ?? null,
      evidence_refs: row[idx.evidence_refs] ?? null,
    });
  }
}

// attestations vecteur-natif PASS-BANC (preuve v2 committée)
const attBySlug = new Map();
for (const src of [S.attGonet, S.attArcgis]) {
  for (const a of src.json.attestations ?? []) {
    if (a?.slug && a.verdict === 'PASS-BANC') {
      attBySlug.set(a.slug, {
        source_url: a.metrics?.source_url ?? null,
        sha256: a.metrics?.sha256 ?? null,
        retrieved_at: a.metrics?.retrieved_at ?? null,
        attestation_source: rel(src.abs),
      });
    }
  }
}

// SERVI vecteur-natif v2 (dépôts confirmés — faits committés cités, lane/zones).
// v2-served exige attestation PASS-BANC (ci-dessus) ET dépôt servi (ci-dessous).
const SERVED_V2 = new Map([
  ['saint-charles-sur-richelieu', 'lane/zones@1f4ff519 (orphan→documented)'],
  ['saint-dominique', 'lane/zones@1f4ff519 (documented)'],
  ['saint-michel', 'lane/zones@1f4ff519 (documented)'],
  ['saint-patrice-de-sherrington', 'lane/zones@1f4ff519 (documented)'],
  ['saint-pie', 'lane/zones@1f4ff519 (legacy→documented)'],
  ['contrecoeur', 'lane/zones@ca58a4f9 (orphan→documented, 164/164)'],
]);
// Attestées PASS-BANC mais HELD (gate anti-régression : orphelin tiers geomatiquecn
// plus riche) — NON servies ⇒ jamais v2-served (lane/zones@b371eb73).
const ATTESTED_HELD = new Map([
  ['saint-bernard-de-michaudville', 'held: superset geomatiquecn requis (lane/zones@b371eb73)'],
  ['saint-jude', 'held: superset geomatiquecn requis (lane/zones@b371eb73)'],
]);

// map de la lecture v2 du manifeste 07-22 → sémantique du job (anti-invention).
function mapManifestReadiness(v) {
  if (v == null) return 'unknown';
  if (v === 'not-assessed') return 'unknown'; // jamais évalué localement ⇒ indéterminé
  return String(v); // valeur inattendue conservée telle quelle (signalée en warning)
}

// ---- construction -----------------------------------------------------------
const WARN = [];
const matched = (S.cohort.json.cities ?? []).filter((c) => c.graph_matched === true);
const cities = matched.map((c) => {
  const slug = c.slug;
  const state = zoneState.has(slug) ? zoneState.get(slug) : 'unknown';
  const att = attBySlug.get(slug) ?? null;
  const prov = provBySlug.get(slug) ?? null;

  const row = { slug, priorityRank: c.priorityRank, col1_state: state, attestation: null, flags: {} };

  // Attestation de provenance UNIQUEMENT sur cellule complete (périmètre du job).
  if (state === 'complete') {
    if (SERVED_V2.has(slug) && att) {
      row.attestation = {
        source_origin: 'v',
        v2_acquisition_readiness: 'v2-served',
        evidence: {
          attestation: att.attestation_source,
          v2_proof: { source_url: att.source_url, sha256: att.sha256, retrieved_at: att.retrieved_at },
          served: SERVED_V2.get(slug),
        },
      };
    } else if (prov) {
      const mapped = mapManifestReadiness(prov.v2_acquisition_readiness);
      if (mapped !== 'unknown' && mapped !== 'v2-served') WARN.push(`readiness inattendue "${prov.v2_acquisition_readiness}" pour ${slug}`);
      row.attestation = {
        source_origin: prov.source_origin ?? 'unknown',
        v2_acquisition_readiness: mapped,
        evidence: { manifest: rel(S.prov.abs), collection_key: prov.collection_key, refs: prov.evidence_refs },
      };
    } else {
      row.attestation = {
        source_origin: 'unknown',
        v2_acquisition_readiness: 'unknown',
        evidence: { note: 'complete dans la matrice 07-23 mais aucun row de provenance ni attestation v2' },
      };
    }
  }

  // FLAGS transverses (indépendants de l'état figé) — pour la re-mesure S3 à venir.
  if (SERVED_V2.has(slug) && att && state !== 'complete') {
    row.flags.fresh_v2_deposit_pending = true; // dépôt v2 frais non reflété par la matrice 07-23
  }
  if (ATTESTED_HELD.has(slug)) {
    row.flags.attested_but_held = ATTESTED_HELD.get(slug); // capture v2 PASS-BANC mais non servie
  }
  return row;
});

// ---- agrégats ---------------------------------------------------------------
const tally = (arr, key) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const complete = cities.filter((c) => c.col1_state === 'complete');
const summary = {
  matched: cities.length,
  col1_state: tally(cities, (c) => c.col1_state),
  complete_total: complete.length,
  complete_by_source_origin: tally(complete, (c) => c.attestation?.source_origin ?? 'unknown'),
  complete_by_v2_readiness: tally(complete, (c) => c.attestation?.v2_acquisition_readiness ?? 'unknown'),
  v2_served: complete.filter((c) => c.attestation?.v2_acquisition_readiness === 'v2-served').map((c) => c.slug),
  fresh_v2_deposit_pending: cities.filter((c) => c.flags.fresh_v2_deposit_pending).map((c) => c.slug),
  attested_but_held: cities.filter((c) => c.flags.attested_but_held).map((c) => c.slug),
};

const out = {
  contract: 'col1-corroboration-manifest/v1',
  as_of: AS_OF,
  cohort: S.cohort.json.cohort ?? 'set-167-bprime',
  job: 'work/coverage/qa-job-20260809.md',
  ratified_semantics: {
    source_origin_v: 'géométrie servie via dépôt vecteur-natif (GOnet/ArcGIS/WFS), preuve v2 exigée (url+retrieved_at+sha256)',
    v2_served: 'zone servie avec preuve v2 intacte et rattachée (sha256 cohérent S3), eligible recall v3.4',
    anti_invention: 'v2-served seulement si attestation PASS-BANC + dépôt servi ; sinon unknown ; N-A seulement si source le porte',
  },
  col1_authoritative_source: rel(S.zones.abs) + ' (figée 07-23 ; en attente re-mesure S3 fraîche)',
  sources: Object.values(S).map((s) => ({ role: s.role, path: rel(s.abs), sha256: s.sha256 })),
  summary,
  cities,
};

// ---- validation / écriture --------------------------------------------------
const STATES = new Set(['complete', 'incomplete', 'unknown', 'N-A']);
const ORIGINS = new Set(['v', 'h', 'q', 'unknown']);
const READINESS = new Set(['v2-served', 'unknown']);
for (const c of cities) {
  if (!STATES.has(c.col1_state)) throw new Error(`état col-1 hors partition: ${c.slug}=${c.col1_state}`);
  if (c.attestation) {
    if (!ORIGINS.has(c.attestation.source_origin)) WARN.push(`source_origin hors vocab "${c.attestation.source_origin}" (${c.slug})`);
    if (!READINESS.has(c.attestation.v2_acquisition_readiness)) throw new Error(`v2_readiness hors partition: ${c.slug}=${c.attestation.v2_acquisition_readiness}`);
  }
}
// garde-fou anti-invention : aucun v2-served sans attestation ET dépôt servi.
for (const c of complete) {
  if (c.attestation?.v2_acquisition_readiness === 'v2-served' && !(SERVED_V2.has(c.slug) && attBySlug.has(c.slug))) {
    throw new Error(`INVENTION: v2-served sans preuve pour ${c.slug}`);
  }
}

if (CHECK) {
  console.log(`CHECK OK — ${cities.length} villes matchées ; complete ${complete.length} ; v2-served ${summary.v2_served.length} ; pending ${summary.fresh_v2_deposit_pending.length} ; held ${summary.attested_but_held.length}. ${WARN.length} warnings.`);
  for (const w of WARN) console.log('  WARN: ' + w);
  process.exit(0);
}

const outPath = path.join(COV, `col1-corroboration-manifest-${AS_OF.replaceAll('-', '')}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`écrit: ${rel(outPath)}`);
console.log(JSON.stringify(summary, null, 2));
for (const w of WARN) console.log('WARN: ' + w);
