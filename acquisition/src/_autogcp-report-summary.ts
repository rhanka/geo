// Summarize a t2-autogcp report: top verdict + best passing candidates ranked
// by residual, with anisotropy / iso-gate reason. $0 read-only triage.
// Usage: _autogcp-report-summary.ts <report.json>
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('usage: _autogcp-report-summary.ts <report.json>');
const r = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
console.log('top pass:', r.pass, '| reason:', r.reason);
console.log('svg_points:', r.svg_points, '| cadastre_features:', r.cadastre_features);
const cands = (r.candidates as any[]) || (r.attempts as any[]) || [];
const passing = cands.filter((x) => x && x.pass);
passing.sort((a, b) => (a.residual_max_m ?? 9e9) - (b.residual_max_m ?? 9e9));
console.log(`passing residual+holdout: ${passing.length}/${cands.length}`);
for (const x of passing.slice(0, 8)) {
  console.log(
    JSON.stringify({
      extent: x.extent,
      rot: x.rotation_deg,
      gcps: x.selected_gcps,
      res: x.residual_max_m,
      aniso: x.anisotropy,
      isoGate: x.affine_gate_pass,
      reason: typeof x.affine_gate_reason === 'string' ? x.affine_gate_reason.slice(0, 70) : undefined,
    }),
  );
}
