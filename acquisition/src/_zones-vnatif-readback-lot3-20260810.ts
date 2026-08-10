/**
 * _zones-vnatif-readback-lot3-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Readback indépendant APRÈS la passe de dépôt lot3. Pour chaque ville du
 * manifeste lot3, RE-LIT l'objet servi (S3, layout plat + sous-dossier) et
 * PROUVE l'état post-dépôt :
 *   - feature_count + zone_source_level + zone_source_url servis courants ;
 *   - la preuve v2 servie porte-t-elle le sha256 de la CAPTURE lot3 ? (attendu
 *     NON si le gate a tenu — S3 intact ; OUI si un dépôt a réellement atterri) ;
 *   - un backup `normalized/ca-qc-zonage/_replaced/qc-zonage-<slug>__*` existe-t-il
 *     (créé UNIQUEMENT lors d'un remplacement effectif) ?
 *
 * N'écrit RIEN sur S3.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-readback-lot3-20260810.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const MANIFEST = "work/coverage/zones-vecteur-natif-manifest-lot3-20260810.json";

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: AWS_MAX_ATTEMPTS=10");
}

interface ManifestCity { slug: string; source_url: string; sha256: string; retrieved_at: string }

function shaBare(s: string | null | undefined): string | null {
  return typeof s === "string" ? s.replace(/^sha256:/, "") : null;
}

// Collecte tous les sha256 portés par les blocs proof (collection + features).
function proofShas(fc: unknown): Set<string> {
  const out = new Set<string>();
  const rec = fc as { proof?: { geometry_source?: { sha256?: string } }; features?: Array<{ properties?: { proof?: { geometry_source?: { sha256?: string } } } | null }> };
  const cs = shaBare(rec.proof?.geometry_source?.sha256);
  if (cs) out.add(cs);
  for (const f of rec.features ?? []) {
    const fs = shaBare(f.properties?.proof?.geometry_source?.sha256);
    if (fs) out.add(fs);
  }
  return out;
}

async function readObj(s3: ReturnType<typeof s3Client>, key: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> | null }> };
  const feats = Array.isArray(fc.features) ? fc.features : [];
  const levels = new Set<string>();
  const urls = new Set<string | null>();
  for (const f of feats) {
    const p = f.properties ?? {};
    levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
    urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
  }
  return {
    key,
    feature_count: feats.length,
    zone_source_levels: [...levels].sort(),
    zone_source_urls: [...urls],
    proof_shas: [...proofShas(fc)],
  };
}

async function main(): Promise<void> {
  requireS3();
  const manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), "utf8")) as { cities: ManifestCity[] };
  const s3 = s3Client();
  const report: Record<string, unknown>[] = [];
  for (const c of manifest.cities) {
    const flat = `${S3_PREFIX}qc-zonage-${c.slug}.geojson`;
    const nested = `${S3_PREFIX}qc-zonage-${c.slug}/qc-zonage-${c.slug}.geojson`;
    const objs = (await Promise.all([readObj(s3, flat), readObj(s3, nested)])).filter((v): v is Record<string, unknown> => v !== null);
    const captureSha = shaBare(c.sha256)!;
    const carriesCaptureSha = objs.some((o) => (o.proof_shas as string[]).includes(captureSha));
    // Backups _replaced/ pour ce slug (créés uniquement lors d'un remplacement).
    const replacedPrefix = `${S3_PREFIX}_replaced/qc-zonage-${c.slug}__`;
    const replaced = (await listObjectEntries(s3, replacedPrefix)).map((e) => e.key);
    report.push({
      slug: c.slug,
      capture_sha256: c.sha256,
      served_objects: objs,
      served_carries_capture_sha256: carriesCaptureSha,
      replaced_backups: replaced,
      verdict: carriesCaptureSha
        ? "DEPLOYED (served carries lot3 capture v2 proof)"
        : "INTACT (served does NOT carry lot3 capture sha — no deposit landed)",
    });
  }
  process.stdout.write(`${JSON.stringify({ contract: "zones-vnatif-readback/diagnostic", report }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
