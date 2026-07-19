/**
 * $0 batch triage for the effet_densifiant (4a) lane. For each slug, reports
 * whether a served qc-zonage-<slug> collection exists, its served zone_code
 * count, the current reglement provenance already on the polygon, and whether
 * effet_densifiant was already folded. Feeds the AVANT/APRÈS direction guard
 * (SPEC_GEO_4A Stage 3): the served reglement/millesime is one side of the diff.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_effet-shard-triage.ts --slugs champlain,levis,rosemere
 */
import { pathToFileURL } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf(`--${key}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

interface FeatureLike {
  properties?: Record<string, unknown>;
}
interface GeoJsonLike {
  features?: FeatureLike[];
}

function pluck(features: FeatureLike[], prop: string): (string | number | null)[] {
  const vals = new Set<string | number | null>();
  for (const f of features) {
    const v = f.properties?.[prop];
    if (typeof v === "string" || typeof v === "number") vals.add(v);
    else if (v === null || v === undefined) vals.add(null);
  }
  return [...vals];
}

async function triageSlug(s3: ReturnType<typeof s3Client>, slug: string) {
  const keys = [
    `${PREFIX}qc-zonage-${slug}.geojson`,
    `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as GeoJsonLike;
    const features = fc.features ?? [];
    const codes = new Set<string>();
    for (const f of features) {
      const z = f.properties?.["zone_code"];
      if (typeof z === "string" && z.trim()) codes.add(z);
    }
    return {
      slug,
      served: true,
      key: key.includes("/qc-zonage-" + slug + "/") ? "subfolder" : "flat",
      features: features.length,
      zone_code_count: codes.size,
      reglement_numero: pluck(features, "reglement_numero"),
      reglement_millesime: pluck(features, "reglement_millesime"),
      reglement_url: pluck(features, "reglement_url").slice(0, 3),
      densite_avant_reglement: pluck(features, "densite_avant_reglement"),
      effet_densifiant: pluck(features, "effet_densifiant"),
    };
  }
  return { slug, served: false };
}

async function main(): Promise<void> {
  const slugs = (arg(process.argv.slice(2), "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("--slugs a,b,c required");
  const s3 = s3Client();
  const out: unknown[] = [];
  for (const slug of slugs) {
    try {
      out.push(await triageSlug(s3, slug));
    } catch (e) {
      out.push({ slug, error: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
