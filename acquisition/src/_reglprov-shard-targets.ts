/**
 * _reglprov-shard-targets.ts — triage lane PROVENANCE RÈGLEMENT (P0_1 immo).
 *
 * Univers = work/coverage/zonage-enrichment.json (per-muni). On garde les slugs
 * `reglement:false` (pas encore de numéro folded), on trie, on applique le shard
 * (--shard i --of n => garde idx%n==i), et pour CHAQUE slug on va lire côté S3 la
 * grille servie `qc-zonage-norms-<slug>.geojson` afin de récupérer VERBATIM son
 * URL source (`_source_url` / `reglement_url` / `source_url`) et un éventuel
 * `reglement_numero` déjà présent côté norms (foldable tel quel).
 *
 * Sortie: une ligne par slug avec numero?/url. Lecture seule, aucun dépôt.
 *
 * Usage (depuis acquisition/):
 *   npx tsx src/_reglprov-shard-targets.ts --shard 1 --of 2
 *   npx tsx src/_reglprov-shard-targets.ts --shard 1 --of 2 --json
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { s3Client, getBytes, exists } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const NORMS_PREFIX = "normalized/qc-zonage-norms/";

const URL_KEYS = ["reglement_url", "_source_url", "source_url", "sourceUrl", "url"];

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const shard = Number(arg(argv, "shard") ?? "0");
  const of = Number(arg(argv, "of") ?? "1");
  const asJson = argv.includes("--json");

  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: Array<{ slug: string; served: boolean; reglement: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as { slugs: Record<string, Record<string, unknown>> };

  const targets = enrich.perMuni
    .filter((m) => m.reglement === false)
    .map((m) => m.slug)
    .sort();
  const mine = targets.filter((_, idx) => idx % of === shard);

  const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
  const isHttp = (u: unknown): u is string =>
    typeof u === "string" && /^https?:\/\//.test(u) && !/non-disponible/.test(u);

  const s3 = s3Client();
  const rows: Array<Record<string, unknown>> = [];
  for (const slug of mine) {
    // 1) NORMS grid: source url + eventual numero
    let normsNum: unknown = null;
    let normsUrl: string | null = null;
    const nkey = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
    if (await exists(s3, nkey)) {
      try {
        const fc = JSON.parse((await getBytes(s3, nkey)).toString("utf8"));
        const p: Record<string, unknown> = fc.features?.[0]?.properties ?? {};
        normsNum = p["reglement_numero"] ?? null;
        for (const uk of URL_KEYS) { const v = p[uk]; if (typeof v === "string" && v.trim()) { normsUrl = v.trim(); break; } }
      } catch { /* ignore */ }
    }
    // 2) POLYGON collection: existence only (HEAD) — full download too heavy.
    //    Whether it already carries the numero is decided by the fold dry-run.
    let polyExists = false;
    for (const k of [`${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`, `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]) {
      if (await exists(s3, k)) { polyExists = true; break; }
    }
    // 3) Registry
    const reg = registry.slugs[slug];
    const regNum = reg && reg["reglement_numero"] ? reg["reglement_numero"] : null;
    const regUrl = reg && isHttp(reg["reglement_url"]) ? (reg["reglement_url"] as string) : null;

    const bestNum = regNum ?? normsNum ?? null;
    const bestUrl = regUrl ?? (isHttp(normsUrl) ? normsUrl : null);

    let cat: string;
    if (!polyExists) cat = "NO-POLY";
    else if (bestNum) cat = "FOLDABLE";
    else if (bestUrl) cat = "EXTRACT";
    else cat = "DEAD";

    rows.push({ slug, cat, bestNum, bestUrl, polyExists, normsNum, regNum, regInReg: !!reg });
  }

  if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }
  const order = ["EXTRACT", "FOLDABLE", "NO-POLY", "DEAD"];
  rows.sort((a, b) => order.indexOf(a["cat"] as string) - order.indexOf(b["cat"] as string) || String(a["slug"]).localeCompare(String(b["slug"])));
  console.log(`shard ${shard}/${of} — ${mine.length}/${targets.length} slugs reglement=false (enrichment stale — polygone = vérité)`);
  for (const r of rows) {
    console.log(`${r["cat"]}\t${r["slug"]}\tnum=${r["bestNum"] ?? "-"}\turl=${r["bestUrl"] ?? "-"}`);
  }
  const cnt = (c: string) => rows.filter((r) => r["cat"] === c).length;
  console.log(`\nRÉSUMÉ: EXTRACT=${cnt("EXTRACT")} FOLDABLE=${cnt("FOLDABLE")} NO-POLY=${cnt("NO-POLY")} DEAD=${cnt("DEAD")}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
