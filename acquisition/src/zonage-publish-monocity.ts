/**
 * zonage-publish-monocity.ts — publie une grille ArcGIS MONO-VILLE (1 compte =
 * 1 municipalité) sous le slug canonique `qc-zonage-<slug>` EN NORMALISANT le
 * champ code-zone canonique (`zone_code` + `name`).
 *
 * Différence vs zonage-republish-reattributed.ts: ce dernier fait un copy
 * server-side BRUT → `name`="feature-N", PAS de `zone_code` (immo ne peut pas
 * lire la grille). Ici on lit, on AJOUTE `zone_code` (verbatim depuis le champ
 * réglementaire VÉRIFIÉ), on remplace `name`, on conserve tout le reste, et on
 * pose une provenance. La source -arcgis est préservée (jamais supprimée).
 *
 * ANTI-INVENTION (STRICTE):
 *   - Le champ code est FOURNI explicitement par ville (vérifié zinspect: valeurs
 *     = codes réglementaires courts type H-350 / C-303 / H-9509). Jamais deviné.
 *   - GATE SPATIAL: le centroïde du bbox des features doit être ≤ --spatial-km
 *     (déf 25) du centroïde registre (municipalities.qc.json) du slug. Sinon
 *     REJET (mauvaise attribution) — on ne sert pas une grille mal attribuée.
 *   - `zone_code` = valeur du champ trim()ée VERBATIM. Vide/null → absent.
 *   - NO-CLOBBER: si la cible canonique existe déjà ET n'est pas une sortie de
 *     ce script / disaggregated → SKIP (log conflit) sauf --force.
 *
 * USAGE:
 *   npx tsx src/zonage-publish-monocity.ts            # DRY-RUN
 *   npx tsx src/zonage-publish-monocity.ts --write    # écrit S3
 *   options: --only <slug,...> --spatial-km <n> --force
 *
 * TS-only. Aucun secret loggé.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { s3Client, getBytes, putBytes, exists, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNI_REGISTRY = resolve(REPO, "packages/qc-sources/src/geo/municipalities.qc.json");
const PREFIX = "normalized/ca-qc-zonage/";

/**
 * Cibles mono-ville VÉRIFIÉES (zinspect: champ = grille réglementaire).
 * `strip` (optionnel): regex retirée de la valeur AVANT de poser zone_code —
 * UNIQUEMENT pour enlever un suffixe municipal CONSTANT (ex " (VLO)" = Ville de
 * Longueuil, présent sur 100% des features) qui n'est pas le code réglementaire.
 * Normalisation documentée, jamais une reconstruction de code.
 */
const TARGETS: Array<{ slug: string; dir: string; field: string; name: string; strip?: RegExp }> = [
  { slug: "rimouski", dir: "ca-qc-zonage-rimouski-arcgis", field: "NO_ZONAGE", name: "Rimouski" },
  { slug: "shawinigan", dir: "ca-qc-zonage-shawinigan-arcgis", field: "zone_", name: "Shawinigan" },
  // NB longueuil: la grille EST servie (collection qc-zonage-longueuil, 2085 feats)
  // sous le champ `Zonage`="H34-327 (VLO)" mais zone_code=None. Le fichier servi
  // n'est PAS sous normalized/ca-qc-zonage/qc-zonage-longueuil/ (id-derivation
  // geo-api non localisée) → écrire ici créerait une COLLISION d'id. Laissé tel
  // quel (non flaggé par immo). À normaliser une fois le fichier servi localisé.
  // { slug: "longueuil", dir: "ca-qc-zonage-longueuil-arcgis", field: "Zonage", name: "Longueuil", strip: /\s*\([A-Z]{2,5}\)\s*$/ },
];

interface MuniEntry { slug: string; lat: number; lon: number }
interface GF { type: string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }
interface GJ { type: string; features: GF[]; [k: string]: unknown }

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Centroïde grossier (moyenne des positions) d'une géométrie GeoJSON. */
function accumCoords(coords: unknown, acc: { sx: number; sy: number; n: number }): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    acc.sx += coords[0]; acc.sy += coords[1]; acc.n++; return;
  }
  for (const c of coords) accumCoords(c, acc);
}

async function findGeojsonKey(s3: ReturnType<typeof s3Client>, dir: string): Promise<string> {
  const base = dir.replace(/^ca-/, "");
  return `${PREFIX}${dir}/${base}.geojson`;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const force = args.includes("--force");
  const km = (() => { const i = args.indexOf("--spatial-km"); return i >= 0 ? Number(args[i + 1]) : 25; })();
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(",")) : null;

  const registry = JSON.parse(readFileSync(MUNI_REGISTRY, "utf8")) as MuniEntry[];
  const bySlug = new Map(registry.map((m) => [m.slug, m]));
  const s3 = s3Client();

  const targets = TARGETS.filter((t) => !only || only.has(t.slug));
  console.log(`[monocity] mode=${write ? "WRITE" : "DRY-RUN"} cibles=${targets.length} spatial=${km}km`);

  for (const t of targets) {
    const reg = bySlug.get(t.slug);
    if (!reg) { console.log(`  SKIP ${t.slug}: absent du registre`); continue; }
    const srcKey = await findGeojsonKey(s3, t.dir);
    let gj: GJ;
    try { gj = JSON.parse((await getBytes(s3, srcKey)).toString("utf8")) as GJ; }
    catch { console.log(`  SKIP ${t.slug}: source illisible ${srcKey}`); continue; }
    const feats = gj.features ?? [];

    // gate spatial
    const acc = { sx: 0, sy: 0, n: 0 };
    for (const f of feats) if (f.geometry) accumCoords(f.geometry.coordinates, acc);
    if (acc.n === 0) { console.log(`  SKIP ${t.slug}: aucune coordonnée`); continue; }
    const cent: [number, number] = [acc.sx / acc.n, acc.sy / acc.n];
    const dist = haversineKm(cent, [reg.lon, reg.lat]);

    // champ code (strip suffixe municipal constant si défini)
    const clean = (raw: unknown): string | undefined => {
      if (raw === null || raw === undefined || raw === "") return undefined;
      let s = String(raw).trim();
      if (t.strip) s = s.replace(t.strip, "").trim();
      return s.length ? s : undefined;
    };
    let withField = 0; const sample: string[] = [];
    for (const f of feats) {
      const c = clean(f.properties?.[t.field]);
      if (c === undefined) continue;
      withField++;
      if (sample.length < 8) sample.push(c);
    }
    const cover = feats.length ? ((withField / feats.length) * 100).toFixed(0) : "0";
    console.log(`  ${t.slug}: feats=${feats.length} field=${t.field} cover=${cover}% dist=${dist.toFixed(1)}km sample=${JSON.stringify(sample)}`);

    if (dist > km) { console.log(`    !! REJET: bbox centroïde à ${dist.toFixed(1)}km > ${km}km du registre — mauvaise attribution`); continue; }
    if (withField / Math.max(feats.length, 1) < 0.5) { console.log(`    !! champ '${t.field}' < 50% — SKIP (anti-invention)`); continue; }

    // build canonical
    const outFeats = feats.map((f, i) => {
      const code = clean(f.properties?.[t.field]);
      return {
        type: "Feature" as const,
        properties: { ...f.properties, name: code ?? String(i), zone_code: code, source: t.dir, confidence: `monocity-publish-from:${t.dir}` },
        geometry: f.geometry,
      };
    });
    const out: GJ = { type: "FeatureCollection", features: outFeats };

    const dstDir = `qc-zonage-${t.slug}`;
    const dstGeojson = `${PREFIX}${dstDir}/${dstDir}.geojson`;
    const dstMeta = `${PREFIX}${dstDir}/${dstDir}.meta.json`;

    // no-clobber: si la cible existe et n'est pas une sortie monocity/disaggregated → conflit
    if (await exists(s3, dstGeojson) && !force) {
      try {
        const cur = JSON.parse((await getBytes(s3, dstGeojson)).toString("utf8")) as GJ;
        const c0 = String(cur.features?.[0]?.properties?.["confidence"] ?? "");
        if (!c0.startsWith("monocity-publish-from:") && !c0.startsWith("disaggregated-from:")) {
          console.log(`    !! CONFLIT: ${dstGeojson} existe (confidence='${c0}') — SKIP (utilise --force)`);
          continue;
        }
      } catch { /* illisible → laisse passer l'overwrite contrôlé */ }
    }

    if (write) {
      await putBytes(s3, dstGeojson, Buffer.from(JSON.stringify(out)), "application/geo+json");
      const meta = {
        sourceId: t.dir, datasetId: dstDir, title: `Zonage — ${t.name}`,
        provenance: "monocity-publish: grille ArcGIS mono-municipalité republiée sous le slug canonique avec zone_code normalisé (source -arcgis préservée)",
        attribution: `© Ville de ${t.name}`, zoneField: t.field, features: outFeats.length,
      };
      await putBytes(s3, dstMeta, Buffer.from(JSON.stringify(meta, null, 2)), "application/json");
      console.log(`    -> écrit ${dstGeojson} (+meta)`);
    } else {
      console.log(`    (dry-run) écrirait ${dstGeojson} (${outFeats.length} feats)`);
    }
  }
  console.log(`[monocity] terminé.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
