#!/usr/bin/env node
// Strict cross-check of the zones v2 mass promotion (zones-v2mass-promote/v1)
// against an INDEPENDENTLY re-measured provenance-quality matrix.
//
// The provenance-quality runner already re-verifies, for every collection it
// classifies `v2`, the exact url+retrieved_at+sha256 capture-manifest tuple AND
// re-hashes the attached CAS payload (validation.v2.assertion). This script does
// NOT re-implement that proof; it audits the *promotion claim*: every slug the
// promote report says is v2 (restampe-v2 ∪ deja-v2) MUST appear as `v2` in the
// fresh matrix, and it reports the v2 delta vs the previous authoritative matrix.
//
// Read-only. Prints a closed audit and exits non-zero if any promoted slug is
// not v2 in the fresh measure (a promotion that did not survive a fresh read).
//
// Usage:
//   node scripts/verify-v2mass-promotions.mjs \
//     --promote=<zones-v2mass-promote-*.json> \
//     --new=<fresh zone-provenance-quality-matrix-*.json> \
//     --old=<previous zone-provenance-quality-matrix-*.json>
import { readFileSync } from 'node:fs';

function opt(name) {
  const p = `--${name}=`;
  const v = process.argv.slice(2).find((a) => a.startsWith(p));
  return v === undefined ? null : v.slice(p.length);
}

const promotePath = opt('promote');
const newPath = opt('new');
const oldPath = opt('old');
if (!promotePath || !newPath) {
  console.error('required: --promote=<promote.json> --new=<matrix.json> [--old=<matrix.json>]');
  process.exit(2);
}

const promote = JSON.parse(readFileSync(promotePath, 'utf8'));
if (promote.contract !== 'zones-v2mass-promote/v1') {
  throw new Error(`unexpected promote contract: ${promote.contract}`);
}
const newMatrix = JSON.parse(readFileSync(newPath, 'utf8'));
if (newMatrix.contract !== 'zone-provenance-quality-matrix/v1') {
  throw new Error(`unexpected new-matrix contract: ${newMatrix.contract}`);
}

function v2Slugs(matrix) {
  return new Set(
    matrix.rows.filter((r) => r.quality_status === 'v2').map((r) => r.city_slug),
  );
}
function statusOf(matrix) {
  const m = new Map();
  for (const r of matrix.rows) m.set(r.city_slug, r.quality_status);
  return m;
}

const newV2 = v2Slugs(newMatrix);
const newStatus = statusOf(newMatrix);

// Promotion universe: every slug the report claims is v2 (both actions).
const promoted = promote.results
  .filter((r) => r.action === 'restampe-v2' || r.action === 'deja-v2')
  .map((r) => ({ slug: r.slug, action: r.action }));
const restampe = promoted.filter((p) => p.action === 'restampe-v2').map((p) => p.slug);
const dejaV2 = promoted.filter((p) => p.action === 'deja-v2').map((p) => p.slug);

// Strict check: each promoted slug must be v2 in the fresh, independent measure.
const notV2 = promoted
  .filter((p) => !newV2.has(p.slug))
  .map((p) => ({ slug: p.slug, action: p.action, status_in_fresh: newStatus.get(p.slug) ?? 'ABSENT-FROM-MATRIX' }));

// v2 delta vs previous authoritative matrix (if provided).
let delta = null;
if (oldPath) {
  const oldMatrix = JSON.parse(readFileSync(oldPath, 'utf8'));
  const oldV2 = v2Slugs(oldMatrix);
  const gained = [...newV2].filter((s) => !oldV2.has(s)).sort();
  const lost = [...oldV2].filter((s) => !newV2.has(s)).sort();
  const gainedFromPromotion = gained.filter((s) => promoted.some((p) => p.slug === s));
  const gainedOutsidePromotion = gained.filter((s) => !promoted.some((p) => p.slug === s));
  delta = {
    old_v2: oldV2.size,
    new_v2: newV2.size,
    net: newV2.size - oldV2.size,
    gained: gained.length,
    lost: lost.length,
    lost_slugs: lost,
    gained_from_promotion: gainedFromPromotion.length,
    gained_outside_promotion: gainedOutsidePromotion.length,
    gained_outside_promotion_slugs: gainedOutsidePromotion,
  };
}

const report = {
  contract: 'v2mass-promotion-verification/v1',
  new_matrix: newPath.split('/').pop(),
  old_matrix: oldPath ? oldPath.split('/').pop() : null,
  promote_report: promotePath.split('/').pop(),
  promote_partition: promote.partition,
  promoted_total: promoted.length,
  restampe_v2: restampe.length,
  deja_v2: dejaV2.length,
  fresh_v2_total: newV2.size,
  promoted_confirmed_v2: promoted.length - notV2.length,
  promoted_NOT_v2: notV2,
  strict_pass: notV2.length === 0,
  v2_delta_vs_previous: delta,
};
console.log(JSON.stringify(report, null, 2));
process.exit(notV2.length === 0 ? 0 : 1);
