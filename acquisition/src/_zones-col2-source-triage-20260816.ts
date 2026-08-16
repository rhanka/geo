/**
 * _zones-col2-source-triage-20260816.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Généralise la sonde mirabel (_zones-vnatif-inspect-mirabel-20260810.ts) sur les
 * 4 villes de la traîne col-2 [amherst, beaupre, boischatel, mille-isles].
 * Lit le servi flat + nested sur S3 et rapporte, par clé servie :
 *   feature_count, geometry_types, distinct zone_code + échantillon,
 *   zone_source_url / zone_source_level / geometry_grain distributions,
 *   featureHasV2Proof count, collection-level proof, property_keys,
 *   ET la BBOX géométrique (min/max lon/lat sur toutes les coordonnées).
 * N'ÉCRIT RIEN. Le bloc SOURCE_BASE / dérivation mirabel-spécifique est retiré.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-col2-source-triage-20260816.ts
 */
import { exists, getBytes, s3Client } from "./lib/s3.js";
import { featureHasV2Proof } from "./lib/zonage-proof.js";

const SLUGS = ["amherst", "beaupre", "boischatel", "mille-isles"] as const;
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI", "MAT18", "SUITE"] as const;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Feat { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }

interface BBox { minLon: number; minLat: number; maxLon: number; maxLat: number; coord_pairs: number }

/** Walk a GeoJSON coordinates tree and fold every [lon, lat] leaf into the bbox.
 *  Leaves are recognised as a 2+ number array whose first two members are finite. */
function foldCoords(node: unknown, bbox: BBox): void {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
    const lon = node[0] as number;
    const lat = node[1] as number;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      if (lon < bbox.minLon) bbox.minLon = lon;
      if (lat < bbox.minLat) bbox.minLat = lat;
      if (lon > bbox.maxLon) bbox.maxLon = lon;
      if (lat > bbox.maxLat) bbox.maxLat = lat;
      bbox.coord_pairs++;
    }
    return;
  }
  for (const child of node) foldCoords(child, bbox);
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const report: Record<string, unknown> = {
    contract: "zones-col2-source-triage/diagnostic",
    generated_at_utc: new Date().toISOString(),
    slugs: SLUGS,
  };

  for (const slug of SLUGS) {
    const out: Record<string, unknown> = { slug };
    const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
    const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
    const servedKeys: string[] = [];
    if (await exists(s3, flat)) servedKeys.push(flat);
    if (await exists(s3, nested)) servedKeys.push(nested);
    out.served_keys = servedKeys;
    out.layout = servedKeys.length === 0 ? "NONE"
      : servedKeys.includes(flat) && servedKeys.includes(nested) ? "BOTH (geo-api serves NESTED)"
        : servedKeys.includes(nested) ? "NESTED-only"
          : "FLAT-only";

    for (const k of servedKeys) {
      const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as {
        type?: string;
        features?: Feat[];
        proof?: unknown;
      };
      const feats = Array.isArray(fc.features) ? fc.features : [];
      const codesCanon = new Set<string>();
      const codesRaw: string[] = [];
      const keySet = new Set<string>();
      const srcUrl = new Map<string, number>();
      const srcLevel = new Map<string, number>();
      const grainVals = new Map<string, number>();
      let v2 = 0;
      let emptyCode = 0;
      const geomTypes = new Set<string>();
      const sampleProps: Record<string, unknown>[] = [];
      const bbox: BBox = {
        minLon: Number.POSITIVE_INFINITY, minLat: Number.POSITIVE_INFINITY,
        maxLon: Number.NEGATIVE_INFINITY, maxLat: Number.NEGATIVE_INFINITY, coord_pairs: 0,
      };
      for (const f of feats) {
        const p = f.properties ?? {};
        for (const kk of Object.keys(p)) keySet.add(kk);
        const zc = p["zone_code"];
        const c = canon(zc);
        if (c) { codesCanon.add(c); if (codesRaw.length < 30) codesRaw.push(String(zc)); }
        else emptyCode++;
        const u = String(p["zone_source_url"] ?? "∅null"); srcUrl.set(u, (srcUrl.get(u) ?? 0) + 1);
        const lv = String(p["zone_source_level"] ?? "∅absent"); srcLevel.set(lv, (srcLevel.get(lv) ?? 0) + 1);
        const gr = String(p["geometry_grain"] ?? "∅absent"); grainVals.set(gr, (grainVals.get(gr) ?? 0) + 1);
        if (featureHasV2Proof({ properties: p })) v2++;
        const gt = f.geometry?.type; if (typeof gt === "string") geomTypes.add(gt);
        if (f.geometry?.coordinates !== undefined) foldCoords(f.geometry.coordinates, bbox);
        if (sampleProps.length < 4) sampleProps.push(p);
      }
      const upper = new Map([...keySet].map((kk) => [kk.toUpperCase(), kk]));
      out[`served[${k}]`] = {
        feature_count: feats.length,
        geometry_types: [...geomTypes].sort(),
        distinct_zone_code_canon: codesCanon.size,
        empty_zone_code_features: emptyCode,
        sample_zone_codes: codesRaw,
        property_keys: [...keySet].sort(),
        uev_fields_present: UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!),
        zone_source_url_distribution: [...srcUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        zone_source_level_distribution: [...srcLevel.entries()].sort((a, b) => b[1] - a[1]),
        geometry_grain_distribution: [...grainVals.entries()].sort((a, b) => b[1] - a[1]),
        features_with_v2_proof: v2,
        collection_level_proof: fc.proof ?? null,
        bbox: bbox.coord_pairs > 0
          ? { min_lon: bbox.minLon, min_lat: bbox.minLat, max_lon: bbox.maxLon, max_lat: bbox.maxLat, coord_pairs: bbox.coord_pairs }
          : null,
        sample_full_properties: sampleProps,
      };
    }
    out.status = servedKeys.length ? "OK" : "NO_SERVED_OBJECT";
    report[slug] = out;
  }

  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
