/**
 * reglement-url-served-audit.ts — READ-ONLY census of the SERVED règlement URL.
 *
 * The WP3 provenance surface immo consumes is the norms grille
 * `normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson`, where
 * publish-reglement-provenance.ts stamps `reglement_url` on every feature. This
 * runner reads (never writes) each grille and reports, per slug, whether the
 * grille is served and whether its features carry an http `reglement_url`. It is
 * the authoritative "URL servie" signal for the reglement-url-coverage KPI —
 * measured on the SAME surface the fold writes, not the geometry collection.
 *
 * Analysis only (getBytes/exists, no putBytes): a local agent may run it.
 *
 * Usage (npx tsx, from repo root):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/reglement-url-served-audit.ts --cohort
 *   npx tsx acquisition/src/reglement-url-served-audit.ts --slugs alma,sutton
 */
import { setDefaultResultOrder } from "node:dns";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { servedKeys } from "./publish-reglement-provenance.js";

// Bake in the S3-run invariants (CLAUDE.md §Opérationnel): happy-eyeballs picks
// IPv6 first and an AggregateError [ETIMEDOUT] is that bug, not a network
// outage. Forcing ipv4first + generous retries makes this runner reproducible
// without a fragile shell env prefix.
setDefaultResultOrder("ipv4first");
process.env.AWS_MAX_ATTEMPTS ??= "10";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    // Require a DOTTED hostname: a real reglement source is a public domain
    // (has a TLD). Sentinels like `https://non-disponible` parse as valid URLs
    // but their single-label host has no dot — reject them (anti-invention:
    // never fold/count a placeholder as a real served URL).
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export interface ServedUrlObservation {
  slug: string;
  grille_served: boolean;
  layouts_served: string[];
  features: number;
  features_with_reglement_url: number;
  features_with_http_reglement_url: number;
  first_http_reglement_url: string | null;
  // Raw provenance already on the grille that publish --generalize would MINE
  // (reglement_url <- _source_url) — a pure verbatim fold, no capture.
  features_with_http_source_url: number;
  first_http_source_url: string | null;
}

/** Read the served norms grille(s) for a slug and observe reglement_url + the
 *  mineable _source_url. Read-only. */
export async function observeServedUrl(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<ServedUrlObservation> {
  const layoutsServed: string[] = [];
  let features = 0;
  let withUrl = 0;
  let withHttp = 0;
  let firstHttp: string | null = null;
  let withSourceHttp = 0;
  let firstSourceHttp: string | null = null;
  for (const key of servedKeys(slug)) {
    if (!(await exists(s3, key))) continue;
    layoutsServed.push(key);
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
    for (const f of feats) {
      features++;
      const value = f.properties?.["reglement_url"];
      if (typeof value === "string" && value.length > 0) {
        withUrl++;
        if (isHttpUrl(value)) {
          withHttp++;
          if (firstHttp === null) firstHttp = value;
        }
      }
      const rawSource = f.properties?.["_source_url"];
      if (isHttpUrl(rawSource)) {
        withSourceHttp++;
        if (firstSourceHttp === null) firstSourceHttp = rawSource;
      }
    }
  }
  return {
    slug,
    grille_served: layoutsServed.length > 0,
    layouts_served: layoutsServed,
    features,
    features_with_reglement_url: withUrl,
    features_with_http_reglement_url: withHttp,
    first_http_reglement_url: firstHttp,
    features_with_http_source_url: withSourceHttp,
    first_http_source_url: firstSourceHttp,
  };
}

// Verified 1:1 radar→geo alias whitelist, byte-identical to
// scripts/generate-completion-regdens.mjs / generate-reglement-url-coverage.mjs.
const PALIER_SLUG_ALIASES: Record<string, string> = {
  "saint-isidore-roussillon": "saint-isidore--roussillon",
  "saint-damase-les-maskoutains": "saint-damase--les-maskoutains",
  "hemmingford-les-jardins-de-napierville": "hemmingford--les-jardins-de-napierville",
  "saint-louis-de-gonzague-beauharnois-salaberry": "saint-louis-de-gonzague--beauharnois-salaberry",
  "hemmingford-les-jardins-de-napierville-2": "hemmingford--les-jardins-de-napierville--2",
  "saint-sebastien-le-haut-richelieu": "saint-sebastien--le-haut-richelieu",
  "sainte-sabine-brome-missisquoi": "sainte-sabine--brome-missisquoi",
};

function cohortGeoSlugs(): string[] {
  const catalog = JSON.parse(readFileSync(
    resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json"), "utf8")) as Array<{ slug: string }>;
  const catalogSlugs = new Set(catalog.map((c) => c.slug));
  const cohort = JSON.parse(readFileSync(
    resolve(ROOT, "work/coverage/palier-cohort-167.json"), "utf8")) as { cities: Array<{ slug: string }> };
  const geo: string[] = [];
  for (const { slug } of cohort.cities) {
    if (catalogSlugs.has(slug)) { geo.push(slug); continue; }
    const alias = PALIER_SLUG_ALIASES[slug];
    if (alias && catalogSlugs.has(alias)) { geo.push(alias); continue; }
    // A cohort slug with no catalogue match is reported by the KPI as unmatched;
    // it has no served grille to audit, so it is simply skipped here.
  }
  return [...new Set(geo)].sort();
}

// Full universe: every catalogue slug (1106). `--all` audits all of them.
function allCatalogueSlugs(): string[] {
  const catalog = JSON.parse(readFileSync(
    resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json"), "utf8")) as Array<{ slug: string }>;
  return [...new Set(catalog.map((c) => c.slug))].sort();
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slugsArg = arg(argv, "slugs");
  const cohortMode = argv.includes("--cohort");
  const allMode = argv.includes("--all");
  const slugs = allMode
    ? allCatalogueSlugs()
    : cohortMode
      ? cohortGeoSlugs()
      : (slugsArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --all, --cohort or --slugs <a,b>");
    process.exit(2);
  }
  const s3 = s3Client();
  const observations: ServedUrlObservation[] = [];
  let served = 0, withHttp = 0, mineable = 0, i = 0;
  for (const slug of slugs) {
    i++;
    const obs = await observeServedUrl(s3, slug);
    observations.push(obs);
    if (obs.grille_served) served++;
    if (obs.features_with_http_reglement_url > 0) withHttp++;
    // Fold candidate: grille served, no served reglement_url yet, but a mineable http _source_url.
    if (obs.features_with_http_reglement_url === 0 && obs.features_with_http_source_url > 0) mineable++;
    if (i % 25 === 0) console.log(`  ...${i}/${slugs.length}`);
  }
  const asOf = stamp();
  const scope = allMode ? "all1106" : cohortMode ? "palier167" : "slugs";
  const out = `work/coverage/reglement-url-served-audit-${scope}-${asOf}.json`;
  const report = {
    contract: "reglement-url-served-audit/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    served_prefix: "normalized/qc-zonage-norms/",
    scope,
    slugs_audited: slugs.length,
    grille_served_total: served,
    features_with_http_reglement_url_total: withHttp,
    mineable_source_fold_candidates_total: mineable,
    slugs: observations,
  };
  writeFileSync(resolve(ROOT, out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: out,
    slugs_audited: slugs.length,
    grille_served_total: served,
    served_url_total: withHttp,
    mineable_source_fold_candidates: mineable,
  }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
