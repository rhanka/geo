/**
 * zonage-decontaminate-parcels-run.ts — remove NON-ZONING features from a served
 * zonage collection (normalized/ca-qc-zonage/qc-zonage-<slug>.geojson) that a
 * contour-auto GeoPDF/ESRI extraction wrongly emitted as "zones".
 *
 * MOTIVATION (sutton, rhanka/geo immo-coherence): the served sutton layer is a
 * `geopdf-esri` `contour-auto` extraction that fused the real zoning polygons
 * (kind A/C/H, codes A-10/C-03/H-05… matching the deposited grille) with ~200
 * CADASTRAL PARCELS mislabeled as zones (kind=P, codes P-694…P-1527 with
 * cadastral sub-lot suffixes like -33/-113, ~1 lot each). Those parcel "zones"
 * exist in NO norms grille, drag zone↔grille recouvrement to ~7% and flip the
 * immo coherence gate to millesime-mismatch / real_zoning=false.
 *
 * ANTI-INVENTION (STRICT):
 *   - Only REMOVES features whose EXISTING `kind` property is in --kinds. Never
 *     adds, edits or reconstructs a zone_code. The removal criterion is the
 *     feature's own `kind` attribute, NOT "does it match the grille" — so this is
 *     a decontamination of the extraction, not metric-gaming.
 *   - Refuses to run if the filter would leave 0 features (never nukes a layer;
 *     use zones-purge.ts for a full purge).
 *   - Non-destructive: server-side copies the pristine original to
 *     `<key>.bak-parcel-decontam` (once, never overwriting an existing backup)
 *     before the PUT. Idempotent.
 *
 * USAGE:
 *   npx tsx src/zonage-decontaminate-parcels-run.ts --slug sutton --dry-run
 *   npx tsx src/zonage-decontaminate-parcels-run.ts --slug sutton --kinds P
 *   npx tsx src/zonage-decontaminate-parcels-run.ts --slug sutton   # default kinds=P
 *
 * Prints no secret. After a real run, chain focus-zone-pipeline.ts --slug <slug>.
 */
import { getBytes, putBytes, copyObject, exists, s3Client, BUCKET } from "./lib/s3.js";
import { resolveGridKey } from "./lib/zonage-norms.js";

interface Feature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: unknown;
}
interface FeatureCollection {
  type?: string;
  features?: Feature[];
  crs?: unknown;
  metadata?: unknown;
  properties?: unknown;
  [k: string]: unknown;
}

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = arg(argv, "slug");
  if (!slug) {
    console.error("usage: zonage-decontaminate-parcels-run.ts --slug <slug> [--kinds P] [--dry-run]");
    process.exit(2);
    return;
  }
  const removeKinds = new Set(
    (arg(argv, "kinds") ?? "P").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const dryRun = argv.includes("--dry-run");

  const s3 = s3Client();
  const key = await resolveGridKey(s3, slug);
  if (!key) {
    console.error(`${slug}: NO served zonage geojson on S3`);
    process.exit(1);
    return;
  }

  const raw = (await getBytes(s3, key)).toString("utf8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const feats = fc.features ?? [];

  // Per-kind evidence (count / distinct zone_code / summed n_lots / sample codes).
  interface Stat { count: number; codes: Set<string>; lots: number; sample: string[] }
  const byKind = new Map<string, Stat>();
  for (const f of feats) {
    const props = f.properties ?? {};
    const kind = String(props["kind"] ?? "(none)");
    const code = String(props["zone_code"] ?? "").trim();
    let st = byKind.get(kind);
    if (!st) { st = { count: 0, codes: new Set(), lots: 0, sample: [] }; byKind.set(kind, st); }
    st.count += 1;
    if (code) st.codes.add(code);
    st.lots += num(props["n_lots"]);
    if (st.sample.length < 6 && code && !st.sample.includes(code)) st.sample.push(code);
  }

  console.log(`slug=${slug} key=${key} features=${feats.length}`);
  console.log("KIND                count  distinctCodes  n_lots  sample");
  for (const [kind, st] of [...byKind.entries()].sort()) {
    const mark = removeKinds.has(kind) ? " <REMOVE" : "";
    console.log(
      `  ${kind.padEnd(16)} ${String(st.count).padStart(5)}  ${String(st.codes.size).padStart(13)}  ${String(st.lots).padStart(6)}  ${st.sample.join(",")}${mark}`,
    );
  }

  const kept = feats.filter((f) => !removeKinds.has(String((f.properties ?? {})["kind"] ?? "(none)")));
  const removed = feats.length - kept.length;
  console.log(`\nremoveKinds=[${[...removeKinds].join(",")}] removed=${removed} kept=${kept.length}`);

  if (kept.length === 0) {
    console.error("REFUS: le filtre supprimerait TOUTES les features — utilise zones-purge.ts pour un purge complet.");
    process.exit(1);
    return;
  }
  if (removed === 0) {
    console.log("Aucune feature à retirer (kinds absents). No-op.");
    return;
  }

  if (dryRun) {
    console.log("DRY-RUN — aucune écriture S3.");
    return;
  }

  // Non-destructive backup of the pristine original (once).
  const backupKey = `${key}.bak-parcel-decontam`;
  if (await exists(s3, backupKey, BUCKET)) {
    console.log(`backup déjà présent, conservé: ${backupKey}`);
  } else {
    await copyObject(s3, key, backupKey);
    console.log(`backup écrit: ${backupKey}`);
  }

  const out: FeatureCollection = { ...fc, features: kept };
  const meta = (typeof out.metadata === "object" && out.metadata ? { ...(out.metadata as Record<string, unknown>) } : {}) as Record<string, unknown>;
  meta["decontaminated_parcels"] = { removed_kinds: [...removeKinds], removed_features: removed, kept_features: kept.length };
  out.metadata = meta;

  await putBytes(s3, key, JSON.stringify(out), "application/geo+json", BUCKET);
  console.log(`DONE — réécrit ${key} features ${feats.length} -> ${kept.length}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
