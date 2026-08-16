#!/usr/bin/env node
// LISTE CANONIQUE des slugs IN-COHORTE — SOURCE-OF-TRUTH UNIQUE que toutes les lanes
// consomment pour viser la cohorte /167 (et non la traîne /1106). Aujourd'hui
// coverage-matrix.json = 1106 SANS flag cohorte → chaque lane devinait sa cible.
//
// Source : work/coverage/palier-matrix-cohort-167.json (set-167-bprime, priorityRank
// figé, graph_matched dérivé). Sortie stable : work/coverage/cohort-slugs-canonical.json.
// Prêt à basculer sur la LISTE-124 (vrai dénominateur owner) dès qu'immo/recette la
// fournit : il suffira de pointer --source dessus.
//
// ANTI-INVENTION : un slug n'est dans la liste QUE s'il est dans la source ; jamais
// deviné. in_cohort=true = membre par rang ; graph_matched = matché au graphe (les
// PENDING-GRAPH-NODE sont in_cohort mais graph_matched=false).
//
// Usage : node scripts/generate-cohort-slugs-canonical.mjs [--source=<cohort.json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const opt = (n, d) => { const p = `--${n}=`; const v = ARGV.find((a) => a.startsWith(p)); return v ? v.slice(p.length) : d; };
const AS_OF = '2026-08-16';
const SRC_REL = opt('source', 'work/coverage/palier-matrix-cohort-167.json');

const srcAbs = path.join(ROOT, SRC_REL);
const rawBytes = fs.readFileSync(srcAbs);
const src = JSON.parse(rawBytes.toString('utf8'));
const cities = Array.isArray(src.cities) ? src.cities : [];

// RÉCONCILIATION au référentiel municipal AUTORITAIRE (tiret double des munis
// désambiguïsées, ex 'sainte-sabine--brome-missisquoi'). La source cohorte porte
// parfois un tiret SIMPLE → faux gaps. Règle : deux slugs = même muni si collapse
// '--'→'-' les rend égaux. On remplace un slug par sa forme référentiel UNIQUEMENT
// si le match normalisé est UNIQUE (anti-invention : jamais deviné).
const REF_REL = 'packages/qc-sources/src/geo/municipalities.qc.json';
const refBytes = fs.readFileSync(path.join(ROOT, REF_REL));
const refArr = JSON.parse(refBytes.toString('utf8'));
const refSlugs = (Array.isArray(refArr) ? refArr : refArr.municipalities || [])
  .map((m) => m?.slug).filter((s) => typeof s === 'string' && s.length > 0);
const refSet = new Set(refSlugs);
const norm = (s) => s.replace(/--/g, '-');
const refNormMap = new Map();
for (const rs of refSlugs) { const k = norm(rs); if (!refNormMap.has(k)) refNormMap.set(k, new Set()); refNormMap.get(k).add(rs); }

const corrections = [];
function reconcile(slug) {
  if (refSet.has(slug)) return slug; // déjà canonique (présent verbatim au référentiel)
  const cands = [...(refNormMap.get(norm(slug)) || new Set())];
  if (cands.length === 1 && cands[0] !== slug) { corrections.push({ source: slug, canonical: cands[0] }); return cands[0]; }
  return slug; // pas de match unique → garder tel quel (anti-invention)
}

// Anti-invention : ne garder que les entrées avec un slug réel présent dans la source.
const slugs = cities
  .filter((c) => c && typeof c.slug === 'string' && c.slug.length > 0)
  .map((c) => ({ slug: reconcile(c.slug), rank: c.priorityRank ?? null, in_cohort: true, graph_matched: c.graph_matched === true }))
  .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.slug.localeCompare(b.slug));

// fermeture : slugs uniques.
const seen = new Set();
for (const s of slugs) { if (seen.has(s.slug)) throw new Error('slug dupliqué: ' + s.slug); seen.add(s.slug); }

const out = {
  contract: 'cohort-slugs-canonical/v1',
  as_of: AS_OF,
  cohort: src.cohort ?? 'set-167-bprime',
  source: { path: SRC_REL, sha256: 'sha256:' + crypto.createHash('sha256').update(rawBytes).digest('hex') },
  reference: { path: REF_REL, sha256: 'sha256:' + crypto.createHash('sha256').update(refBytes).digest('hex'), note: 'référentiel municipal autoritaire — slugs canoniques (tiret double des désambiguïsées)' },
  slug_corrections: corrections.sort((a, b) => a.source.localeCompare(b.source)),
  denominator_note: 'Liste /167 (priorityRank<=167). Basculera sur la LISTE-124 (dénominateur owner) dès qu\'immo/recette la fournit : relancer avec --source=<list-124>.',
  usage: 'Filtrer sur in_cohort===true pour la cohorte ; graph_matched===true pour les villes réellement matchées au graphe (les autres = PENDING-GRAPH-NODE).',
  total: slugs.length,
  graph_matched: slugs.filter((s) => s.graph_matched).length,
  slugs,
};

const outRel = 'work/coverage/cohort-slugs-canonical.json';
fs.writeFileSync(path.join(ROOT, outRel), JSON.stringify(out, null, 2) + '\n');
console.log(`écrit: ${outRel} — total ${out.total} (graph_matched ${out.graph_matched}) · ${corrections.length} slugs réconciliés au référentiel`);
for (const c of corrections) console.log(`  ${c.source} → ${c.canonical}`);
