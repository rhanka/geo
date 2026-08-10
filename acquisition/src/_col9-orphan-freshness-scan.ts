/**
 * Sonde READ-ONLY : la liste col-9 orphan/candidate (matrice provenance-qualité
 * 2026-07-26) est-elle PÉRIMÉE ? La ré-acquisition zones re-stampe des preuves v2
 * dans l'objet servi SANS re-scan de la matrice → une ville « orphan » au 26-07
 * peut désormais porter une vraie preuve v2 (cas prouvé : boisbriand porte
 * `services3.arcgis.com/.../Plan_de_zonage/FeatureServer/32` + level=documented,
 * classée orphan par la matrice). CLAUDE.md : « le rapport mesure présence ET
 * provenance/qualité — sinon la ré-acquisition et le stampage sont invisibles ».
 *
 * Ce scan RE-MESURE l'état COURANT de chaque orphan/candidate et classe :
 *   - proof_present_stamped   : objet servi porte une vraie preuve v2 ET est déjà
 *                               stampé (zone_source_url réel) → matrice périmée,
 *                               reclassable documented/v2, AUCUN write requis.
 *   - proof_present_unstamped : preuve v2 présente mais stamp absent/incomplet →
 *                               restampable additif SANS risque (_restamp-served-from-proof).
 *   - no_proof                : orphan réel → campagne capture↔servi (lane zones, gated g-cond).
 *   - unavailable             : objet servi absent/illisible (noté, jamais deviné).
 *
 * HEAD/GET only, aucune écriture. Usage (racine dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_col9-orphan-freshness-scan.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, exists, objectHead, s3Client } from "./lib/s3.js";
import { isRealGeometryUrl } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MATRIX = resolve(ROOT, "work/coverage/zone-provenance-quality-matrix-20260726T130555Z-8c02991472f0e3a0.json");
const OUT = resolve(ROOT, "work/coverage/col9-orphan-freshness-scan-20260810.json");
const MAX_BYTES = 60 * 1024 * 1024;

interface Entry { city_slug: string; collection_key?: string; selected_layout?: string; quality_status: string; reason?: string }

/** Collecte récursive de toute entrée {city_slug, quality_status} ∈ {orphan, candidate}. */
function collect(node: unknown, out: Entry[]): void {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  // orphan/candidate toujours ; unknown SEULEMENT s'il a une collection servie
  // (col-8 LEVIER-3 : l'unique unknown avec jointure exacte — source_level non
  // uniforme ; les 238 autres unknown = no-served-collection, hors portée, écartés).
  const qs = o["quality_status"];
  const hasColl = typeof o["collection_key"] === "string" && (o["collection_key"] as string).length > 0;
  if (typeof o["city_slug"] === "string" && typeof qs === "string"
    && (qs === "orphan" || qs === "candidate" || (qs === "unknown" && hasColl))) {
    out.push({
      city_slug: o["city_slug"] as string,
      collection_key: typeof o["collection_key"] === "string" ? (o["collection_key"] as string) : undefined,
      selected_layout: typeof o["selected_layout"] === "string" ? (o["selected_layout"] as string) : undefined,
      quality_status: o["quality_status"] as string,
      reason: typeof o["reason"] === "string" ? (o["reason"] as string) : undefined,
    });
  }
  for (const v of Object.values(o)) collect(v, out);
}

interface ProofFC {
  type?: unknown;
  proof?: { geometry_source?: { url?: unknown } } | null;
  features?: Array<{ properties?: Record<string, unknown> | null }>;
}

function collectionUrl(fc: ProofFC): string | null {
  const c = fc.proof?.geometry_source?.url;
  if (isRealGeometryUrl(c)) return c as string;
  const f = fc.features?.[0]?.properties?.["proof"] as { geometry_source?: { url?: unknown } } | undefined;
  const fu = f?.geometry_source?.url;
  return isRealGeometryUrl(fu) ? (fu as string) : null;
}

function stampedUrl(fc: ProofFC): string | null {
  const p = fc.features?.[0]?.properties ?? {};
  const u = p["zone_source_url"];
  return typeof u === "string" && isRealGeometryUrl(u) ? u : null;
}

async function keysFor(s3: ReturnType<typeof s3Client>, slug: string, hint?: string): Promise<string[]> {
  const cands = hint ? [hint] : [];
  cands.push(`normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`, `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`);
  const keys: string[] = [];
  for (const k of cands) if (!keys.includes(k) && (await exists(s3, k))) keys.push(k);
  return keys;
}

async function main(): Promise<void> {
  if (!existsSync(MATRIX)) { process.stderr.write(`matrice absente: ${MATRIX}\n`); process.exit(2); }
  const seen = new Set<string>();
  const entries: Entry[] = [];
  const raw: Entry[] = [];
  collect(JSON.parse(readFileSync(MATRIX, "utf8")), raw);
  for (const e of raw) { if (seen.has(e.city_slug)) continue; seen.add(e.city_slug); entries.push(e); }

  const s3 = s3Client();
  const buckets: Record<string, { slug: string; quality_status: string; served_url: string | null; note?: string }[]> = {
    proof_present_stamped: [], proof_present_unstamped: [], no_proof: [], unavailable: [],
  };

  for (const e of entries) {
    const keys = await keysFor(s3, e.city_slug, e.collection_key);
    if (keys.length === 0) { buckets.unavailable.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: null, note: "qc-zonage non servi" }); continue; }
    const key = keys[0]!;
    try {
      const head = await objectHead(s3, key);
      if ((head.contentLength ?? 0) > MAX_BYTES) { buckets.unavailable.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: null, note: `objet > ${MAX_BYTES} o, non parsé` }); continue; }
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as ProofFC;
      const proof = collectionUrl(fc);
      const stamp = stampedUrl(fc);
      if (proof && stamp) buckets.proof_present_stamped.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: proof });
      else if (proof && !stamp) buckets.proof_present_unstamped.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: proof });
      else buckets.no_proof.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: null });
    } catch (err) {
      buckets.unavailable.push({ slug: e.city_slug, quality_status: e.quality_status, served_url: null, note: err instanceof Error ? err.message : String(err) });
    }
  }

  const summary = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  const artifact = {
    contract: "col9-orphan-freshness-scan/20260810",
    matrix_source: "work/coverage/zone-provenance-quality-matrix-20260726T130555Z-8c02991472f0e3a0.json (as_of 2026-07-26)",
    scanned_current_served_state: true,
    scope: "quality_status ∈ {orphan, candidate} ∪ {unknown AVEC collection servie} (col-8 LEVIER-3)",
    entries_scanned: entries.length,
    summary,
    interpretation: {
      proof_present_stamped: "matrice PÉRIMÉE — objet servi porte déjà une preuve v2 réelle + stamp; reclassable documented/v2, AUCUN write requis (re-mesure suffit).",
      proof_present_unstamped: "preuve v2 présente mais stamp incomplet — restampable additif SANS risque via _restamp-served-from-proof.ts.",
      no_proof: "orphan RÉEL — nécessite campagne capture↔servi (lane zones, gated g-cond). Hors rattrapage jointures.",
      unavailable: "objet servi absent/illisible/trop-grand — noté, jamais deviné (anti-invention).",
    },
    buckets,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8" });
  process.stdout.write(`entries=${entries.length} ${JSON.stringify(summary)}\nOUT ${OUT}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 2; });
