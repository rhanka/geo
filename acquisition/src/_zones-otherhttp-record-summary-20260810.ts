// Diagnostic sonde (read-only): print a concise per-muni verification summary of the
// other-http deposit record (statut, field, count, overlap, grain, dropped, sha, readback).
// Run: npx tsx acquisition/src/_zones-otherhttp-record-summary-20260810.ts [record.json]
import { readFileSync } from 'node:fs';
const path = process.argv[2] ?? 'work/coverage/zones-vnatif-deposit-record-otherhttp-20260810.json';
const rec = JSON.parse(readFileSync(path, 'utf8'));
console.log('mode=', rec.mode, 'run_stamp=', rec.run_stamp, 'summary=', JSON.stringify(rec.summary));
for (const c of rec.cities ?? []) {
  const rb = Array.isArray(c.readback) ? c.readback.map((r: any) => ({ key: r.key, fc_match: r.feature_count_matches_capture, byte_exact: r.geometry_digest_byte_exact, url_ok: r.proof_url_matches, sha_ok: r.proof_sha_matches_capture, level: r.zone_source_levels, grain_ok: r.grain_uniform_expected })) : null;
  console.log(`\n[${c.slug}] ${c.statut}`);
  console.log('  field=', c.code_field_chosen, 'count=', c.feature_count, 'overlap%=', c.overlap_ratio_pct, 'grain=', c.geometry_grain_classified, 'nearest_ok=', c.nearest_matches_slug, 'count_complete=', c.count_complete, 'dropped=', c.dropped_count);
  console.log('  geom_types=', JSON.stringify(c.geometry_types), 'sha=', c.sha256);
  console.log('  readback_ok=', c.readback_ok, 'replaced_backups=', JSON.stringify(c.replaced_backups_listed));
  if (rb) for (const r of rb) console.log('    ', JSON.stringify(r));
  if (String(c.statut).startsWith('SKIP') || c.statut === 'ERROR') console.log('  raison=', c.raison);
}
