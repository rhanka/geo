/**
 * _ud-geocentralis-etiquette-dump.ts — $0 read-only (réseau, n'écrit rien)
 *
 * Généralise le levier qui a servi saint-paul-de-montminy : la couche geocentralis
 * `evb:siadmin_pzon_99_s` porte, pour certaines MRC (Montmagny / L'Islet…), la
 * VOCATION VERBATIM dans l'attribut `etiquette_2`, le préfixe alphabétique dans
 * `etiquette_3` et le code de zone complet dans `etiquette_1`. Quand elle existe,
 * cette table dispense de lire un PDF (cf. [[usage-dominant-affectation-sig-gisement]]).
 *
 * Pour chaque slug : lit la collection SERVIE sur S3, calcule sa bbox, interroge le
 * WFS par BBOX, groupe par id_municipalite, et retient le(s) id_municipalite dont
 * l'ensemble des `etiquette_1` RECOUVRE les zone_code servis. Le recouvrement est
 * imprimé : c'est le GATE propriétaire (un recouvrement faible = mauvaise muni).
 *
 * USAGE : npx tsx acquisition/src/_ud-geocentralis-etiquette-dump.ts --slugs a,b
 *         [--type evb:siadmin_pzon_99_s] [--max 4000]
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const BASE = "https://geoserver.geocentralis.com/geoserver/ows";

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

function bboxOf(fc: { features?: { geometry?: unknown }[] }): [number, number, number, number] | null {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c as [number, number];
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
      return;
    }
    for (const sub of c) walk(sub);
  };
  for (const f of fc.features ?? []) walk((f.geometry as { coordinates?: unknown } | undefined)?.coordinates);
  if (!Number.isFinite(minx)) return null;
  return [minx, miny, maxx, maxy];
}

async function wfsByBbox(
  type: string,
  bbox: [number, number, number, number],
  max: number,
): Promise<{ properties?: Record<string, unknown> }[]> {
  // WFS 2.0 + EPSG:4326 : l'ordre des axes est lat,lon (urn:ogc:def:crs:EPSG::4326)
  const [minx, miny, maxx, maxy] = bbox;
  const cql = `BBOX(geom,${miny},${minx},${maxy},${maxx},'urn:ogc:def:crs:EPSG::4326')`;
  const url =
    `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(type)}` +
    `&outputFormat=${encodeURIComponent("application/json")}&count=${max}` +
    `&CQL_FILTER=${encodeURIComponent(cql)}`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 geo-diagnostic" } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} :: ${txt.slice(0, 200).replace(/\s+/g, " ")}`);
  let js: { features?: { properties?: Record<string, unknown> }[] };
  try {
    js = JSON.parse(txt);
  } catch {
    throw new Error(`réponse non-JSON :: ${txt.slice(0, 200).replace(/\s+/g, " ")}`);
  }
  return js.features ?? [];
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const type = arg("type") ?? "evb:siadmin_pzon_99_s";
  const max = Number(arg("max") ?? 4000);
  if (!slugs.length) throw new Error("required: --slugs a,b");
  const s3 = s3Client();

  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let key: string | null = null;
    for (const k of candidates) if (await exists(s3, k)) { key = k; break; }
    if (!key) { console.log("  NON servi sur S3"); continue; }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
      features?: { properties?: Record<string, unknown>; geometry?: unknown }[];
    };
    const served = new Set<string>();
    for (const f of fc.features ?? []) {
      const c = zoneCodeOf(f.properties ?? {});
      if (c) served.add(c);
    }
    const bbox = bboxOf(fc);
    if (!bbox) { console.log("  bbox introuvable"); continue; }
    console.log(`  servi: ${served.size} codes distincts, bbox=${bbox.map((n) => n.toFixed(4)).join(",")}`);

    let feats: { properties?: Record<string, unknown> }[];
    try {
      feats = await wfsByBbox(type, bbox, max);
    } catch (e) {
      console.log(`  WFS-ERR ${(e as Error).message}`);
      continue;
    }
    console.log(`  WFS ${type}: ${feats.length} entités dans la bbox`);

    if (feats.length) {
      console.log(`  champs WFS: ${Object.keys(feats[0].properties ?? {}).join(",")}`);
    }
    // GATE PROPRIÉTAIRE : les champs descriptifs doivent NOMMER la municipalité.
    const descByMuni = new Map<string, Set<string>>();
    for (const f of feats) {
      const p = f.properties ?? {};
      const id = String(p.id_municipalite ?? "?");
      if (!descByMuni.has(id)) descByMuni.set(id, new Set());
      for (const fld of ["description", "id_nom_cover", "type_cover", "etiquette_4", "etiquette_5"]) {
        const v = p[fld];
        if (v != null && String(v).trim()) descByMuni.get(id)!.add(`${fld}=${String(v).trim()}`);
      }
    }

    // groupe par id_municipalite. Le préfixe vient de etiquette_3 si peuplé,
    // sinon il est dérivé de etiquette_1 (certaines munis ne servent pas etiquette_3).
    const byMuni = new Map<string, { n: number; e1: Set<string>; pairs: Map<string, Set<string>> }>();
    for (const f of feats) {
      const p = f.properties ?? {};
      const id = String(p.id_municipalite ?? "?");
      const e1 = p.etiquette_1 == null ? "" : String(p.etiquette_1).trim();
      const e2 = p.etiquette_2 == null ? "" : String(p.etiquette_2).trim();
      const e3raw = p.etiquette_3 == null ? "" : String(p.etiquette_3).trim();
      const e3 = e3raw || (e1.match(/^[A-Za-z]+/)?.[0] ?? "");
      if (!byMuni.has(id)) byMuni.set(id, { n: 0, e1: new Set(), pairs: new Map() });
      const g = byMuni.get(id)!;
      g.n++;
      if (e1) g.e1.add(e1);
      if (e3) {
        if (!g.pairs.has(e3)) g.pairs.set(e3, new Set());
        if (e2) g.pairs.get(e3)!.add(e2);
      }
    }

    const ranked = [...byMuni.entries()]
      .map(([id, g]) => {
        let hit = 0;
        for (const c of served) if (g.e1.has(c)) hit++;
        return { id, g, hit, pct: served.size ? (100 * hit) / served.size : 0 };
      })
      .sort((a, b) => b.hit - a.hit || b.g.n - a.g.n);

    for (const r of ranked.slice(0, 3)) {
      console.log(
        `  -- id_municipalite=${r.id} entités=${r.g.n} recouvrement=${r.hit}/${served.size}` +
          ` (${r.pct.toFixed(1)}%) etiquette_1=${r.g.e1.size}`,
      );
      if (r.hit === 0) continue;
      console.log(`     [descriptif] ${[...(descByMuni.get(r.id) ?? [])].slice(0, 8).join(" ; ") || "(vide)"}`);
      for (const [e3, e2s] of [...r.g.pairs.entries()].sort()) {
        console.log(`     ${e3.padEnd(8)} -> ${[...e2s].join(" | ") || "(vide)"}`);
      }
    }
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
