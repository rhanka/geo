/**
 * _zones-vnatif-inspect-saint-hyacinthe-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Résout la capture cluster run-stamp 20260810T130000Z de la couche ISOGEO/13
 * (arcgis.st-hyacinthe.ca … FeatureServer/13) — la MÊME couche dont le servi
 * saint-hyacinthe a été dérivé (zone_source_url du servi). Vérifie l'intégrité
 * octet-pour-octet (G2), énumère la source LIVE (count autoritaire), lit le servi
 * actuel, et calcule l'IDENTITÉ DE COUCHE + les dérivations candidates du zone_code
 * pour trancher la forme autoritaire à déposer. N'écrit RIEN.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-inspect-saint-hyacinthe-20260810.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LANE = "zones";
const RUN_STAMP = "20260810T130000Z";
const SLUG = "saint-hyacinthe";
const URL_CAP =
  "https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13/query?where=1%3D1&outFields=*&f=geojson";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function runIdsFromKeys(keys: string[]): string[] {
  const ids = new Set<string>();
  for (const k of keys) { const m = /^capture\/_runs\/(.+?)\/manifest\.jsonl$/.exec(k); if (m) ids.add(m[1]!); }
  return [...ids].sort();
}

interface RunData { run_id: string; ok: boolean; note: string; lines: CaptureManifestLine[] }
async function loadRuns(s3: ReturnType<typeof s3Client>, stamp: string): Promise<RunData[]> {
  const prefix = `capture/_runs/${LANE}-${stamp}-`;
  const keys = (await listObjectEntries(s3, prefix)).map((e) => e.key);
  const runs: RunData[] = [];
  for (const runId of runIdsFromKeys(keys)) {
    const rk = captureRunKeys(runId);
    try {
      const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, rk.header)).toString("utf8")));
      const ok = header.run_id === runId && header.finished_at !== null && header.exit_code === 0;
      const lines = parseManifestJsonl((await getBytes(s3, rk.manifest)).toString("utf8"));
      runs.push({ run_id: runId, ok, note: `finished=${String(header.finished_at)} exit=${String(header.exit_code)} lines=${lines.length}`, lines });
    } catch (e) { runs.push({ run_id: runId, ok: false, note: `ERR ${(e as Error).message}`, lines: [] }); }
  }
  return runs;
}
function findLine(runs: RunData[], url: string): { run_id: string; line: CaptureManifestLine } | null {
  for (const r of runs) {
    if (!r.ok) continue;
    const direct = r.lines.filter((l) => l.url === url);
    const matches = direct.length > 0 ? direct : r.lines.filter((l) => l.final_url === url);
    if (matches.length === 1) return { run_id: r.run_id, line: matches[0]! };
    if (matches.length > 1) throw new Error(`run ${r.run_id}: ${matches.length} lignes matchent`);
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 25_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-count-probe/1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
function layerBase(url: string): string { return url.replace(/\/query\?.*$/i, ""); }

interface FieldStat { field: string; nonnull_pct: number; distinct: number; maxlen: number; sample: string[] }
function fieldStats(feats: Array<{ properties?: Record<string, unknown> | null }>, field: string): FieldStat {
  const vals: string[] = []; let nonnull = 0; const distinct = new Set<string>(); let maxlen = 0;
  for (const f of feats) {
    const v = f.properties?.[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      nonnull++; const s = String(v).trim(); distinct.add(s); maxlen = Math.max(maxlen, s.length);
      if (vals.length < 12) vals.push(s);
    }
  }
  return { field, nonnull_pct: feats.length ? Math.round((nonnull / feats.length) * 1000) / 10 : 0, distinct: distinct.size, maxlen, sample: vals };
}

interface Feat { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }

// nearest-muni (anti-homonyme) — bbox centroid vs registry
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
interface MuniEntry { slug: string; lat: number; lon: number }
function loadRegistry(): MuniEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), lat: Number(m["lat"] ?? m["latitude"]), lon: Number(m["lon"] ?? m["lng"] ?? m["longitude"]) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}
function nearestMuni(feats: Feat[], registry: MuniEntry[]): { slug: string | null; km: number | null } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of feats) for (const [x, y] of positions(f.geometry?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return { slug: null, km: null };
  const clat = (miny + maxy) / 2, clon = (minx + maxx) / 2;
  let best: { slug: string; km: number } | null = null;
  for (const m of registry) { const km = haversineKm(m.lat, m.lon, clat, clon); if (best === null || km < best.km) best = { slug: m.slug, km }; }
  return { slug: best?.slug ?? null, km: best ? Math.round(best.km * 100) / 100 : null };
}

function overlap(a: Set<string>, b: Set<string>): { inter: number; a_only: number; b_only: number; a_into_b_pct: number } {
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return { inter, a_only: a.size - inter, b_only: b.size - inter, a_into_b_pct: a.size ? Math.round((inter / a.size) * 1000) / 10 : 0 };
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const out: Record<string, unknown> = { contract: "zones-vnatif-inspect-saint-hyacinthe/diagnostic", run_stamp: RUN_STAMP, slug: SLUG, url: URL_CAP };

  // ── Résoudre la capture ──
  const runs = await loadRuns(s3, RUN_STAMP);
  out.runs = runs.map((r) => ({ run_id: r.run_id, ok: r.ok, note: r.note }));
  const found = findLine(runs, URL_CAP);
  if (!found) { out.status = "NO_CAPTURE_LINE"; process.stdout.write(`${JSON.stringify(out, null, 1)}\n`); return; }
  const { run_id, line } = found;
  out.capture_run_id = run_id;
  out.http_status = line.http_status; out.sha256 = line.sha256; out.retrieved_at = line.retrieved_at; out.storage_key = line.storage_key;
  if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
    out.status = "LINE_NOT_DEPOSITABLE"; process.stdout.write(`${JSON.stringify(out, null, 1)}\n`); return;
  }

  // ── G2 byte-exact ──
  const bytes = await getBytes(s3, line.storage_key);
  const rehash = `sha256:${sha256Hex(bytes)}`;
  const casInName = /\/cas\/([a-f0-9]{64})\./.exec(line.storage_key)?.[1] ?? null;
  out.rehash_ok = rehash === line.sha256;
  out.cas_key_matches = casInName !== null && `sha256:${casInName}` === line.sha256;
  const receipt = captureReceiptFromManifest(line, captureRunKeys(run_id).manifest, 0);
  let rawVerified = false, rawReason: string | null = "reçu invalide";
  if (receipt) {
    const sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
    const v = verifyRawCapturePayload(receipt, bytes, sidecar); rawVerified = v.verified; rawReason = v.reason;
  }
  out.raw_capture_verified = rawVerified; out.raw_capture_reason = rawReason;

  // ── Parse geojson ──
  const gj = JSON.parse(bytes.toString("utf8")) as { type?: string; features?: Feat[]; exceededTransferLimit?: boolean };
  const feats = Array.isArray(gj.features) ? gj.features : [];
  out.is_featurecollection = gj.type === "FeatureCollection";
  out.feature_count = feats.length;
  out.exceeded_transfer_limit = gj.exceededTransferLimit === true;
  const geomTypes = new Set<string>();
  for (const f of feats) { const gt = f.geometry?.type; if (typeof gt === "string") geomTypes.add(gt); }
  out.geometry_types = [...geomTypes].sort();

  // ── Champs ──
  const allKeys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
  out.property_keys = [...allKeys].sort();
  const upper = new Map([...allKeys].map((k) => [k.toUpperCase(), k]));
  out.uev_fields_present = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
  out.grain_classified = (out.uev_fields_present as string[]).length > 0 ? "evaluation-unit" : "zone-polygon";
  const focus = ["NUM_ZONE", "GROUPE_USAGE_DOM", "ETIQUETTE", "GRILLE_URL", "NOM_ZONE", "REGLEMENT", "USAGE"].map((u) => upper.get(u)).filter((v): v is string => !!v);
  out.focus_field_stats = focus.map((f) => fieldStats(feats, f));

  // ── nearest muni ──
  out.nearest = nearestMuni(feats, loadRegistry());

  // ── Source enumeration (LIVE) ──
  const base = layerBase(URL_CAP);
  const countQuery = `${base}/query?where=1%3D1&returnCountOnly=true&f=json`;
  out.count_query = countQuery;
  try { const info = await fetchJson(`${base}?f=json`) as { name?: unknown }; if (typeof info.name === "string") out.source_layer_name = info.name; } catch (e) { out.source_layer_name_err = (e as Error).message; }
  try { const cnt = await fetchJson(countQuery) as { count?: unknown }; out.source_count = typeof cnt.count === "number" ? cnt.count : null; } catch (e) { out.source_count_err = (e as Error).message; }

  // ── Servi actuel ──
  const flat = `${S3_PREFIX}qc-zonage-${SLUG}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${SLUG}/qc-zonage-${SLUG}.geojson`;
  const servedKeys: string[] = [];
  if (await exists(s3, flat)) servedKeys.push(flat);
  if (await exists(s3, nested)) servedKeys.push(nested);
  out.served_keys = servedKeys;
  const servedCodesCanon = new Set<string>();
  const servedCodesRaw: string[] = [];
  const servedNumsCanon = new Set<string>();
  let servedFeatures = 0;
  const servedKeySet = new Set<string>();
  for (const k of servedKeys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> | null }> };
    const sf = Array.isArray(fc.features) ? fc.features : [];
    servedFeatures = Math.max(servedFeatures, sf.length);
    for (const f of sf) {
      const p = f.properties ?? {};
      for (const kk of Object.keys(p)) servedKeySet.add(kk);
      const zc = p["zone_code"];
      const c = canon(zc); if (c) { servedCodesCanon.add(c); if (servedCodesRaw.length < 20) servedCodesRaw.push(String(zc)); }
      const num = /^(\d+)/.exec(String(zc ?? ""))?.[1]; if (num) servedNumsCanon.add(num);
    }
  }
  out.served_features = servedFeatures;
  out.served_distinct_codes = servedCodesCanon.size;
  out.served_sample_codes = servedCodesRaw;
  out.served_property_keys = [...servedKeySet].sort();

  // ── Dérivations candidates du zone_code depuis la capture ──
  const numF = upper.get("NUM_ZONE");
  const groupeF = upper.get("GROUPE_USAGE_DOM");
  const etiqF = upper.get("ETIQUETTE");
  const grilleF = upper.get("GRILLE_URL");
  const firstLetter = (s: unknown): string => { const m = /[A-Za-z]/.exec(String(s ?? "")); return m ? m[0] : ""; };

  const capNums = new Set<string>();
  const dNumGroupeFull = new Set<string>();   // NUM_ZONE-GROUPE_USAGE_DOM (valeur courante entière)
  const dNumFirstLetter = new Set<string>();  // NUM_ZONE-firstLetter(GROUPE) — reproduit le servi historique
  const dEtiquette = new Set<string>();       // ETIQUETTE brut
  const dGrilleTail = new Set<string>();      // dernier segment de GRILLE_URL
  const sampleDeriv: Record<string, unknown>[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const num = numF ? String(p[numF] ?? "").trim() : "";
    const groupe = groupeF ? String(p[groupeF] ?? "").trim() : "";
    const etiq = etiqF ? String(p[etiqF] ?? "").trim() : "";
    const grille = grilleF ? String(p[grilleF] ?? "").trim() : "";
    const grilleTail = grille ? grille.replace(/\/+$/, "").split("/").pop() ?? "" : "";
    if (num) capNums.add(canon(num));
    if (num && groupe) dNumGroupeFull.add(canon(`${num}-${groupe}`));
    if (num && firstLetter(groupe)) dNumFirstLetter.add(canon(`${num}-${firstLetter(groupe)}`));
    if (etiq) dEtiquette.add(canon(etiq));
    if (grilleTail) dGrilleTail.add(canon(grilleTail));
    if (sampleDeriv.length < 15) sampleDeriv.push({ num, groupe, etiquette: etiq, grille_tail: grilleTail, first_letter: firstLetter(groupe) });
  }
  out.capture_sample_derivations = sampleDeriv;

  out.layer_identity = {
    same_service_layer_url: base,
    source_layer_name: out.source_layer_name ?? null,
    count_capture: feats.length,
    count_served: servedFeatures,
    count_source_live: out.source_count ?? null,
    num_zone_overlap_served_into_capture: overlap(servedNumsCanon, capNums),
    num_zone_overlap_capture_into_served: overlap(capNums, servedNumsCanon),
    served_distinct_nums: servedNumsCanon.size,
    capture_distinct_nums: capNums.size,
  };
  out.zone_code_derivations = {
    served_distinct: servedCodesCanon.size,
    d_num_groupe_full: { distinct: dNumGroupeFull.size, overlap_served_into_deriv: overlap(servedCodesCanon, dNumGroupeFull), overlap_deriv_into_served: overlap(dNumGroupeFull, servedCodesCanon) },
    d_num_first_letter: { distinct: dNumFirstLetter.size, overlap_served_into_deriv: overlap(servedCodesCanon, dNumFirstLetter), overlap_deriv_into_served: overlap(dNumFirstLetter, servedCodesCanon) },
    d_etiquette: { distinct: dEtiquette.size, overlap_served_into_deriv: overlap(servedCodesCanon, dEtiquette), overlap_deriv_into_served: overlap(dEtiquette, servedCodesCanon) },
    d_grille_tail: { distinct: dGrilleTail.size, overlap_served_into_deriv: overlap(servedCodesCanon, dGrilleTail), overlap_deriv_into_served: overlap(dGrilleTail, servedCodesCanon) },
  };

  out.status = "OK";
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
