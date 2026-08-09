/**
 * zonage-republish-reattributed.ts — re-publie ADDITIVEMENT des grilles de
 * zonage ArcGIS **mono-municipalité** (rangées sous un id de *compte* ArcGIS,
 * ex `qc-zonage-rcornelis-vdw-arcgis`) en collections **canoniques par slug**
 * `qc-zonage-<slug>`, pour que le `StoreProvider` du geo-api les serve sous l'id
 * attendu par immo.
 *
 * CONTEXTE (task #92 part-2): contrairement à `disaggregate-zonage.ts` (qui SPLIT
 * des agrégats multi-muni), ces grilles couvrent UNE seule ville mais portent un
 * id de compte ArcGIS. Le geo-api liste tout `*.geojson` sous `normalized/` et
 * sert l'id = `meta.datasetId` (sinon le stem). On COPIE donc la source vers
 * `normalized/ca-qc-zonage/qc-zonage-<slug>/qc-zonage-<slug>.geojson` (+ un
 * `.meta.json` à `datasetId=qc-zonage-<slug>`).
 *
 * NON-DESTRUCTIF / ANTI-INVENTION (STRICT):
 *   - COPY server-side uniquement. ZÉRO suppression: la collection -arcgis
 *     source reste intacte et servie (fallback).
 *   - La paire (slug ⇐ collection -arcgis) doit être confirmée par la
 *     réattribution reverse-géocodée `exchange/geo-immo/grilles-reattribution.json`:
 *     `municipalite_reelle` doit canonicaliser EXACTEMENT vers `<slug>` ET
 *     `confiance` doit être "HAUTE". Sinon → SKIP (jamais deviné).
 *   - La source doit avoir des features à géométrie non-vide. Sinon → SKIP.
 *   - Si la cible `qc-zonage-<slug>` existe déjà → SKIP (no-clobber), sauf
 *     `--force`. On n'écrase JAMAIS un canonique pré-existant non issu de ce script.
 *
 * USAGE:
 *   tsx src/zonage-republish-reattributed.ts            # DRY-RUN (défaut, n'écrit rien)
 *   tsx src/zonage-republish-reattributed.ts --write     # RUN RÉEL (copie + meta en S3)
 */
import {
  s3Client,
  BUCKET,
  getBytes,
  exists,
  putBytes,
  copyObject,
} from "./lib/s3.js";

/** Mapping ratifié (HAUTE confiance, mono-muni). Extensible. */
const MAP: Array<{ slug: string; dir: string; name: string }> = [
  { slug: "westmount", dir: "ca-qc-zonage-rcornelis-vdw-arcgis", name: "Westmount" },
  { slug: "hampstead", dir: "ca-qc-zonage-gsavignac-bourdeau-arcgis", name: "Hampstead" },
  { slug: "cote-saint-luc", dir: "ca-qc-zonage-vthomas7-arcgis", name: "Côte-Saint-Luc" },
  { slug: "dorval", dir: "ca-qc-zonage-tidorval1-arcgis", name: "Dorval" },
  { slug: "chambly", dir: "ca-qc-zonage-jehanninnicolas-arcgis", name: "Chambly" },
  // longueuil: grille mono-muni Ville de Longueuil (1927 zones, champ `Zonage`
  // type "H34-327 (VLO)"; VLO=Ville de Longueuil). Réattribution HAUTE → Longueuil,
  // centroïde bbox à 1.2km du registre. Régression baseline: l'agrégat -arcgis
  // existait mais le slug canonique qc-zonage-longueuil n'était plus servi.
  { slug: "longueuil", dir: "ca-qc-zonage-longueuil-arcgis", name: "Longueuil" },
];

const PREFIX = "normalized/ca-qc-zonage/";

/** slug canonique: NFD, drop accents, lowercase, non-alnum→"-", trim "-". */
function canonSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface SourceMeta {
  datasetId?: string;
  title?: string;
  license?: unknown;
  attribution?: string;
  crs?: string;
  count?: number;
  sourceId?: string;
  [k: string]: unknown;
}

async function main() {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");
  const s3 = s3Client();

  const reatt: any[] =
    JSON.parse((await getBytes(s3, "exchange/geo-immo/grilles-reattribution.json")).toString("utf8"))
      .reattributions ?? [];

  let published = 0;
  const skipped: string[] = [];
  console.log(`[republish] mode=${write ? "WRITE" : "DRY-RUN"} targets=${MAP.length}`);

  for (const m of MAP) {
    const base = m.dir.replace(/^ca-/, ""); // qc-zonage-<account>-arcgis
    const srcGeojson = `${PREFIX}${m.dir}/${base}.geojson`;
    const srcMeta = `${PREFIX}${m.dir}/${base}.meta.json`;
    const dstDir = `${PREFIX}qc-zonage-${m.slug}`;
    const dstGeojson = `${dstDir}/qc-zonage-${m.slug}.geojson`;
    const dstMeta = `${dstDir}/qc-zonage-${m.slug}.meta.json`;

    // Guard 1: source exists
    if (!(await exists(s3, srcGeojson))) {
      skipped.push(`${m.slug}: source geojson absent (${srcGeojson})`);
      continue;
    }
    // Guard 2: reattribution confirms muni + HAUTE confiance.
    // collection_id peut être stocké soit comme la base source (`qc-zonage-…-arcgis`)
    // soit comme l'id canonique normalisé (`qc-zonage-…` sans le suffixe `-arcgis`).
    const baseNoArcgis = base.replace(/-arcgis$/, "");
    const re = reatt.find((r) => r.collection_id === base || r.collection_id === baseNoArcgis);
    if (!re) { skipped.push(`${m.slug}: pas d'entrée réattribution pour ${base}`); continue; }
    if (canonSlug(re.municipalite_reelle ?? "") !== m.slug) {
      skipped.push(`${m.slug}: réattribution muni="${re.municipalite_reelle}" ≠ slug (anti-invention)`);
      continue;
    }
    if (re.confiance !== "HAUTE") {
      skipped.push(`${m.slug}: confiance=${re.confiance} ≠ HAUTE (anti-invention)`);
      continue;
    }
    // Guard 3: geometry non-empty
    const gj = JSON.parse((await getBytes(s3, srcGeojson)).toString("utf8"));
    const feats: any[] = gj.features ?? [];
    const withGeom = feats.filter((f) => f.geometry && f.geometry.coordinates && f.geometry.coordinates.length).length;
    if (withGeom === 0) { skipped.push(`${m.slug}: 0 feature à géométrie`); continue; }
    // Guard 4: no-clobber
    if ((await exists(s3, dstGeojson)) && !force) {
      skipped.push(`${m.slug}: cible existe déjà (${dstGeojson}) — no-clobber`);
      continue;
    }

    const sm: SourceMeta = (await exists(s3, srcMeta))
      ? JSON.parse((await getBytes(s3, srcMeta)).toString("utf8"))
      : {};

    const outMeta = {
      sourceId: sm.sourceId ?? `ca-qc/zonage-${base}`,
      datasetId: `qc-zonage-${m.slug}`,
      title: `Zonage — ${m.name}`,
      method:
        "reattribution-republish: grille ArcGIS mono-municipalité republiée sous le slug canonique (copy server-side, source -arcgis préservée)",
      license: sm.license ?? { id: "unknown-municipal" },
      attribution: `© Ville de ${m.name}`,
      crs: sm.crs ?? "EPSG:4326",
      count: sm.count ?? feats.length,
      provenance: {
        republishedFrom: base,
        republishedFromKey: srcGeojson,
        reattributionConfidence: re.confiance,
        reattributionSource: "exchange/geo-immo/grilles-reattribution.json",
        republishedAt: new Date().toISOString(),
        agent: "zonage-serving-92",
        task: "#92 part-2 (Lot A)",
      },
    };

    console.log(
      `  ${write ? "PUBLISH" : "PLAN   "} qc-zonage-${m.slug.padEnd(16)} <= ${base} (feat=${feats.length} geom=${withGeom})`,
    );
    if (write) {
      await copyObject(s3, srcGeojson, dstGeojson);
      await putBytes(s3, dstMeta, JSON.stringify(outMeta, null, 2), "application/json");
    }
    published++;
  }

  console.log(`\n[republish] ${write ? "publiés" : "à publier"}=${published} skippés=${skipped.length}`);
  skipped.forEach((s) => console.log("  SKIP " + s));
}

main().catch((e) => { console.error(e); process.exit(1); });
