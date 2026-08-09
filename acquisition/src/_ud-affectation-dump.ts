/**
 * _ud-affectation-dump.ts — $0 read-only: pour chaque slug, groupe les zone_code
 * servis par préfixe alpha (via canonZoneCodeServe) et montre la/les valeurs
 * distinctes du champ `affectation` (ou autre champ vocation) associées. Aide à
 * croiser la nomenclature SIG avec la légende du règlement. N'écrit rien.
 * Usage: npx tsx acquisition/src/_ud-affectation-dump.ts --slugs a,b --field affectation
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function zoneCodeOf(props: Record<string, unknown>): string | null {
  for (const name of SIG_ZONE_CODE_FIELDS) {
    const v = props[name];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function alphaPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return m ? m[0] : "(num)";
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const fields = (arg("field") ?? "affectation,Description,Usages,vocation").split(",");
  if (!slugs.length) throw new Error("required: --slugs a,b");
  const s3 = s3Client();
  for (const slug of slugs) {
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let key: string | null = null;
    for (const k of candidates) if (await exists(s3, k)) { key = k; break; }
    if (!key) { console.log(`${slug}: NON servi`); continue; }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: { properties?: Record<string, unknown> }[] };
    const byPref = new Map<string, Map<string, Set<string>>>(); // prefix -> code -> affectations
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      const code = zoneCodeOf(p);
      if (!code) continue;
      const pref = alphaPrefix(canonZoneCodeServe(code) || code);
      let vals = "";
      for (const fld of fields) { if (p[fld] != null && String(p[fld]).trim()) { vals = String(p[fld]).trim(); break; } }
      if (!byPref.has(pref)) byPref.set(pref, new Map());
      const m = byPref.get(pref)!;
      if (!m.has(code)) m.set(code, new Set());
      if (vals) m.get(code)!.add(vals);
    }
    console.log(`\n=== ${slug} ===`);
    for (const [pref, codes] of [...byPref.entries()].sort()) {
      const affs = new Set<string>();
      for (const s of codes.values()) for (const a of s) affs.add(a);
      console.log(`  [${pref}] n=${codes.size}  affectation: ${affs.size ? [...affs].join(" | ") : "(vide)"}`);
    }
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
