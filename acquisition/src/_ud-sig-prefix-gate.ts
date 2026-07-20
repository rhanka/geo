/**
 * _ud-sig-prefix-gate.ts — $0 read-only (lane usage_dominant). Gate AMONT: pour
 * chaque cible d'un shard (work/coverage/zonage-enrichment.json: served &&
 * !usage_dominant, sans config committé), imprime la distribution des PRÉFIXES
 * ALPHABÉTIQUES des zone_code servis.
 *
 * POURQUOI — le fold `fold-usage-dominant.ts` mappe un PRÉFIXE ALPHA -> catégorie.
 * Une muni dont le SIG ne sert que des codes NUMÉRIQUES ("01", "203") n'a AUCUN
 * préfixe mappable: lire son règlement est du temps perdu. Ce gate les écarte
 * AVANT toute lecture de PDF. Il révèle aussi les SIG à codes tronqués (un seul
 * caractère par zone, ex namur "A","B","C","D" = fragment obscura-gonet) qui sont
 * un faux gisement.
 *
 * N'écrit rien.
 *
 *   npx tsx acquisition/src/_ud-sig-prefix-gate.ts --shard 1 --of 2
 *   npx tsx acquisition/src/_ud-sig-prefix-gate.ts --slugs a,b
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

function arg(k: string, d?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
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
  return m ? m[0] : "";
}

async function main(): Promise<void> {
  const explicit = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let mine: string[];
  if (explicit.length) {
    mine = explicit;
  } else {
    const shard = Number(arg("shard", "0"));
    const of = Number(arg("of", "1"));
    const data = JSON.parse(readFileSync(ENRICH, "utf8")) as {
      perMuni: { slug: string; served: boolean; usage_dominant: boolean }[];
    };
    mine = data.perMuni
      .filter((m) => m.served && !m.usage_dominant)
      .map((m) => m.slug)
      .sort((a, b) => a.localeCompare(b))
      .filter((_, i) => i % of === shard)
      .filter((s) => !existsSync(resolve(MAP_DIR, `${s}.json`)));
  }

  const s3 = s3Client();
  let mappable = 0;
  for (const slug of mine) {
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let key: string | null = null;
    for (const k of candidates) if (await exists(s3, k)) { key = k; break; }
    if (!key) {
      console.log(`${slug}: NO-KEY`);
      continue;
    }
    let fc: { features?: { properties?: Record<string, unknown> }[] };
    try {
      fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    } catch {
      console.log(`${slug}: PARSE-FAIL`);
      continue;
    }
    const byPref = new Map<string, number>();
    let numeric = 0;
    let noCode = 0;
    const feats = fc.features ?? [];
    for (const f of feats) {
      const code = zoneCodeOf(f.properties ?? {});
      if (!code) { noCode++; continue; }
      const pref = alphaPrefix(canonZoneCodeServe(code) || code);
      if (!pref) { numeric++; continue; }
      byPref.set(pref, (byPref.get(pref) ?? 0) + 1);
    }
    const rows = [...byPref.entries()].sort((a, b) => b[1] - a[1]);
    const alphaN = rows.reduce((s, r) => s + r[1], 0);
    if (!rows.length) {
      console.log(`${slug}: NUMERIC-ONLY pol=${feats.length} num=${numeric} sansCode=${noCode}`);
      continue;
    }
    mappable++;
    const tag = alphaN / (feats.length || 1) < 0.5 ? "MIXTE" : "ALPHA";
    console.log(
      `${slug}: ${tag} pol=${feats.length} alpha=${alphaN} num=${numeric} | ` +
        rows.map(([p, n]) => `${p}:${n}`).join(" "),
    );
  }
  console.log(`\n[gate: ${mine.length} cibles, ${mappable} avec préfixe alphabétique]`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
