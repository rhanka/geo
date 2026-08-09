/**
 * _ud-code-vocation-dump.ts — $0 read-only (lane usage_dominant). Imprime, POUR
 * CHAQUE zone_code servi d'un slug, la valeur VERBATIM de l'attribut de vocation
 * porté par le SIG (`affectation`/`Affectation`/`Description`/…). Complément de
 * _ud-affectation-dump (qui agrège par préfixe ALPHA et masque donc les
 * nomenclatures NUMÉRIQUES, où c'est le premier chiffre qui encode la famille).
 * N'écrit rien.
 *
 *   npx tsx acquisition/src/_ud-code-vocation-dump.ts --slugs sainte-madeleine
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const VOCATION_FIELDS = [
  "affectation", "Affectation", "AFFECTATION",
  "Description", "DESCRIPTION", "description",
  "Usages", "USAGE", "usage", "vocation", "VOCATION",
  "nom_zone", "NOM_ZONE", "TYPE_ZONE", "type_zone",
];

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

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
      features?: { properties?: Record<string, unknown> }[];
    };
    const byCode = new Map<string, Set<string>>();
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      const raw = zoneCodeOf(p);
      if (!raw) continue;
      const code = canonZoneCodeServe(raw) || raw;
      let val = "(vide)";
      for (const fld of VOCATION_FIELDS) {
        const v = p[fld];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) { val = `${fld}=${s}`; break; }
      }
      if (!byCode.has(code)) byCode.set(code, new Set());
      byCode.get(code)!.add(val);
    }
    console.log(`\n=== ${slug} (${byCode.size} codes) ===`);
    for (const [code, vals] of [...byCode.entries()].sort()) {
      console.log(`  ${code.padEnd(12)} ${[...vals].join(" | ")}`);
    }
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
