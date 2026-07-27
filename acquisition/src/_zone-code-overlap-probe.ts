/**
 * _zone-code-overlap-probe.ts — vocabulaire verbatim avant tout fold de normes.
 *
 * Lit strictement (sans put/copy/delete) les objets déjà servis et expose le
 * `zone_code` de chaque layout. Quand les layouts plat et sous-dossier existent
 * tous les deux, geo-api sert le sous-dossier : c'est celui marqué `effective`.
 * Les valeurs ne sont ni trimées ni canonisées, afin que les espaces, la casse,
 * les zéros de tête et les séparateurs restent observables.
 *
 * Cette sonde ne décide pas qu'un code est l'équivalent sémantique d'un autre.
 * Une permutation de segments doit être corroborée par la grille/règlement
 * source avant de pouvoir devenir une règle de jointure dans la lib.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_zone-code-overlap-probe.ts --slugs amherst,amos
 */
import { getBytes, s3Client } from "./lib/s3.js";

const ZONAGE = "normalized/ca-qc-zonage/";
const NORMS = "normalized/qc-zonage-norms/";

interface FeatureLike { properties?: Record<string, unknown> }

interface Vocabulary {
  key: string;
  status: "readable" | "missing" | "read_error";
  effective?: boolean;
  polygones?: number;
  zone_code_verbatim?: unknown[];
  zone_code_non_string?: unknown[];
  error?: string;
}

function compareVerbatim(a: unknown, b: unknown): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

/** Keep the source value verbatim; string normalization here would hide the defect. */
function vocabulary(features: FeatureLike[]): Pick<Vocabulary, "polygones" | "zone_code_verbatim" | "zone_code_non_string"> {
  const strings = new Set<string>();
  const nonStrings = new Map<string, unknown>();
  for (const feature of features) {
    const value = feature.properties?.["zone_code"];
    if (typeof value === "string") strings.add(value);
    else if (value !== null && value !== undefined) nonStrings.set(JSON.stringify(value), value);
  }
  return {
    polygones: features.length,
    zone_code_verbatim: [...strings].sort(),
    zone_code_non_string: [...nonStrings.values()].sort(compareVerbatim),
  };
}

async function readVocabulary(s3: ReturnType<typeof s3Client>, key: string): Promise<Vocabulary> {
  try {
    const parsed = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: FeatureLike[] };
    if (!Array.isArray(parsed.features)) return { key, status: "read_error", error: "GeoJSON sans tableau features" };
    return { key, status: "readable", ...vocabulary(parsed.features) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
    const missing = details?.name === "NotFound" || details?.name === "NoSuchKey" || details?.$metadata?.httpStatusCode === 404;
    return { key, status: missing ? "missing" : "read_error", error: message };
  }
}

function exactOverlap(served: Vocabulary | undefined, norms: Vocabulary): string[] | undefined {
  if (served?.status !== "readable" || norms.status !== "readable") return undefined;
  const servedSet = new Set(served.zone_code_verbatim?.filter((v): v is string => typeof v === "string"));
  return norms.zone_code_verbatim?.filter((v): v is string => typeof v === "string" && servedSet.has(v));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--slugs");
  const slugs = (i >= 0 ? argv[i + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b,c");
  const s3 = s3Client();

  for (const slug of slugs) {
    const flatKey = `${ZONAGE}qc-zonage-${slug}.geojson`;
    const nestedKey = `${ZONAGE}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
    const normsKey = `${NORMS}qc-zonage-norms-${slug}.geojson`;
    const [flat, nested, norms] = await Promise.all([
      readVocabulary(s3, flatKey),
      readVocabulary(s3, nestedKey),
      readVocabulary(s3, normsKey),
    ]);
    // geo-api priority: nested layout wins only when it is an actual readable object.
    const served = nested.status === "readable"
      ? { ...nested, effective: true }
      : nested.status === "missing" && flat.status === "readable"
        ? { ...flat, effective: true }
        : undefined;
    console.log(JSON.stringify({
      slug,
      zonage_layouts: [flat, nested],
      zonage_effectif: served?.key ?? null,
      normes: norms,
      recoupement_exact_verbatim: exactOverlap(served, norms) ?? null,
    }));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
