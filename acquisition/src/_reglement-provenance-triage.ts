/**
 * _reglement-provenance-triage.ts — cible la lane PROVENANCE RÈGLEMENT (P0_1).
 *
 * Sort de work/coverage/zonage-enrichment.json toutes les munis `reglement=false`,
 * les trie, applique le SHARD (index%n==i), et pour chacune lit la grille de normes
 * servie sur S3 (qc-zonage-norms-<slug>.geojson) pour récupérer l'URL source déjà
 * minée (_source_url / reglement_url / source_url) et l'état courant du numéro.
 *
 * Lecture seule. Usage:
 *   npx tsx src/_reglement-provenance-triage.ts --shard 0 --n 2
 *   npx tsx src/_reglement-provenance-triage.ts --shard 0 --n 2 --slug <slug>  # 1 slug détaillé
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const NORMS_PREFIX = "normalized/qc-zonage-norms/";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const URL_FIELDS = ["reglement_url", "_source_url", "source_url", "reglement_source_url"];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const shard = Number(arg(argv, "shard") ?? "0");
  const n = Number(arg(argv, "n") ?? "2");
  const only = arg(argv, "slug");

  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as {
    perMuni: Array<{ slug: string; served: boolean; reglement: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    slugs: Record<string, { reglement_numero?: string | null }>;
  };

  const all = enrich.perMuni
    .filter((m) => m.reglement === false)
    .map((m) => m.slug)
    .sort();
  const mine = all.filter((_s, idx) => idx % n === shard);
  const targets = only ? mine.filter((s) => s === only) : mine;

  console.log(`reglement=false total=${all.length} shard=${shard}/${n} mine=${mine.length}`);
  const s3 = s3Client();
  let withUrl = 0;
  let inRegistryNum = 0;
  const actionable: Array<{ slug: string; url: string }> = [];
  for (const slug of targets) {
    const reg = registry.slugs[slug];
    const hasNum = !!(reg && reg.reglement_numero);
    if (hasNum) inRegistryNum++;
    const inRegistry = !!reg;
    const key = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
    let urls: Record<string, string> = {};
    let num: unknown = null;
    let pickUrl: string | null = null;
    if (await exists(s3, key)) {
      try {
        const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
        const p: Record<string, unknown> = fc.features?.[0]?.properties ?? {};
        num = p["reglement_numero"] ?? null;
        for (const f of URL_FIELDS) if (p[f]) urls[f] = String(p[f]);
        for (const f of URL_FIELDS) {
          const v = p[f];
          if (typeof v === "string" && /^https?:\/\//.test(v)) { pickUrl = v; break; }
        }
      } catch (e) {
        urls = { ERROR: String(e) };
      }
    } else {
      urls = { NO_NORMS_GRID: key };
    }
    const urlStr = Object.entries(urls).map(([k, v]) => `${k}=${v}`).join(" | ") || "(aucune URL)";
    if (Object.keys(urls).some((k) => URL_FIELDS.includes(k))) withUrl++;
    if (pickUrl && !hasNum) actionable.push({ slug, url: pickUrl });
    console.log(`\n### ${slug}  reg=${inRegistry ? (hasNum ? reg!.reglement_numero : "null-entry") : "-"} servedNum=${num ?? "-"}`);
    console.log(`    ${urlStr}`);
  }
  const outPath = resolve(ROOT, "acquisition", "src", `_reglement-shard${shard}-actionable.json`);
  writeFileSync(outPath, JSON.stringify(actionable, null, 2));
  // Gains gratuits: registre a un numéro mais enrichment dit reglement=false -> fold à refaire.
  const foldCandidates = targets.filter((s) => registry.slugs[s]?.reglement_numero);
  const foldPath = resolve(ROOT, "acquisition", "src", `_reglement-shard${shard}-foldcandidates.json`);
  writeFileSync(foldPath, JSON.stringify(foldCandidates, null, 2));
  console.log(`\nFOLD-CANDIDATES (registre a un numéro, enrichment=false) = ${foldCandidates.length}: ${foldCandidates.join(",")}`);
  console.log(`\nSUMMARY shard=${shard}/${n} targets=${targets.length} withServedUrl=${withUrl} alreadyRegistryNum=${inRegistryNum} actionable(httpUrl,noNum)=${actionable.length} -> ${outPath}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
