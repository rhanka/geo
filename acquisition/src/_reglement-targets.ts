/**
 * _reglement-targets.ts — lane P0_1 provenance règlement (Steve/immo).
 *
 * Sort le GISEMENT: les villes dont le polygone ne porte PAS encore la provenance
 * (`reglement=false` dans work/coverage/zonage-enrichment.json) MAIS dont on connaît
 * déjà une URL source — donc le PDF du règlement est ouvrable SANS découverte à
 * l'aveugle.
 *
 * L'URL vient du MANIFEST (`registry/qc-zonage-norms/manifest.json`), qui fait
 * autorité; le `_source_url` du GeoJSON servi n'est qu'un REPLI. Les deux divergent:
 * mesuré 2026-07-17, le GeoJSON vaut souvent la chaîne littérale «non-disponible»
 * là où le manifest porte le vrai PDF (saint-malo, saint-jude, saint-martin…), ce
 * qui affamait le scan (62 cibles vues contre 74 réelles sur le shard 1/2).
 *
 * Lecture seule (aucun PUT). Anti-invention: passthrough verbatim des champs
 * déposés (`_reglement`, `_source_url`), jamais de dérivation depuis l'URL.
 *
 * Usage (npx tsx, from repo root):
 *   npx tsx acquisition/src/_reglement-targets.ts --shard 1/2 --out /tmp/targets.json
 *   npx tsx acquisition/src/_reglement-targets.ts --shard 1/2 --limit 20
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENRICH = resolve(ROOT, "work", "coverage", "zonage-enrichment.json");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const NORMS_PREFIX = "normalized/qc-zonage-norms/";
const MANIFEST_KEY = "registry/qc-zonage-norms/manifest.json";

interface PerMuni {
  slug: string;
  served: boolean;
  reglement: boolean;
}

interface Target {
  slug: string;
  index: number;
  mined_reglement: string | null;
  source_url: string | null;
  reglement_url: string | null;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
/**
 * URL réellement ouvrable. Le placeholder «non-disponible» est déposé tel quel par
 * les lanes de grille, parfois préfixé («https://non-disponible») — il passe donc
 * /^https?:/ tout en ne désignant aucun document. Le rejeter ici évite de compter
 * comme gisement des cibles qu'aucun fetch ne peut servir.
 */
const isUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\//.test(v) && !/^https?:\/\/non-disponible/i.test(v);

/** Map en concurrence bornée (S3 = I/O-bound, mais on reste sobre). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const shard = arg(argv, "shard") ?? "0/1";
  const [si, sn] = shard.split("/").map((s) => Number.parseInt(s, 10));
  const limit = Number.parseInt(arg(argv, "limit") ?? "0", 10);
  const out = arg(argv, "out");

  const enrich = JSON.parse(readFileSync(ENRICH, "utf8")) as { perMuni: PerMuni[] };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as { slugs: Record<string, unknown> };

  // Univers = villes servies SANS provenance règlement, triées (ordre stable = shard stable).
  const universe = enrich.perMuni
    .filter((m) => m.served && !m.reglement)
    .map((m) => m.slug)
    .sort();
  const mine = universe.filter((_, i) => i % sn! === si!);
  console.log(`univers=${universe.length} shard=${shard} mine=${mine.length}`);

  const s3 = s3Client();

  // Le manifest fait autorité pour l'URL source (mémoire norms-manifest-is-authority).
  const manifestUrl = new Map<string, string>();
  try {
    const mf = JSON.parse((await getBytes(s3, MANIFEST_KEY)).toString("utf8")) as {
      entries?: Array<{ slug?: string; source_url?: unknown }>;
    };
    for (const e of mf.entries ?? []) {
      if (typeof e.slug === "string" && isUrl(e.source_url)) manifestUrl.set(e.slug, e.source_url);
    }
  } catch (e) {
    console.log(`manifest illisible (${e instanceof Error ? e.message : String(e)}) -- repli _source_url du GeoJSON`);
  }

  const rows = await mapLimit(mine, 8, async (slug, i): Promise<Target | null> => {
    if (registry.slugs[slug]) return null; // déjà curé (registre = vérité durable)
    const fromManifest = manifestUrl.get(slug) ?? null;
    // La grille servie n'apporte que `_reglement`/`_source_url` (confort): son absence
    // à la clé plate ne doit PAS tuer une cible dont le manifest porte déjà l'URL,
    // sinon on s'interdit ~19 villes ouvrables du seul fait du layout S3.
    const key = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
    let props: Record<string, unknown> = {};
    if (await exists(s3, key)) {
      try {
        const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
        props = fc.features?.[0]?.properties ?? {};
      } catch {
        props = {};
      }
    } else if (!fromManifest) {
      return null; // ni grille servie ni URL au manifest => rien à ouvrir
    }
    const t: Target = {
      slug,
      index: i,
      mined_reglement: asStr(props["_reglement"]),
      // manifest d'abord, `_source_url` du GeoJSON en repli (souvent «non-disponible»).
      source_url: fromManifest ?? (isUrl(props["_source_url"]) ? props["_source_url"] : null),
      reglement_url: isUrl(props["reglement_url"]) ? props["reglement_url"] : null,
    };
    return t;
  });

  const targets = rows.filter((r): r is Target => r !== null && !!(r.source_url ?? r.reglement_url));
  const capped = limit > 0 ? targets.slice(0, limit) : targets;
  console.log(`cibles avec URL source=${targets.length}${limit > 0 ? ` (montrees=${capped.length})` : ""}`);
  for (const t of capped) {
    console.log(`${t.slug}\t_reglement=${t.mined_reglement ?? "-"}\turl=${t.source_url ?? t.reglement_url}`);
  }
  if (out) {
    writeFileSync(out, JSON.stringify({ shard, universe: universe.length, mine: mine.length, targets }, null, 2));
    console.log(`ecrit ${out}`);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
