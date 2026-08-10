/**
 * audit-lots-enriched.ts — Audit des champs additifs des produits qc-lots.
 *
 * Deux modes (lecture seule, aucun dépôt) :
 *
 *   --mode postal   (défaut)
 *     Lit les sidecars `normalized/qc-lots/qc-lots-<slug>.stats.json` de tous les
 *     munis servis et rapporte la couverture code_postal (RTA/FSA) par muni :
 *     pct_with_code_postal, num_with_code_postal/num_lots. Trie ascendant pour
 *     faire remonter les munis à couverture nulle/basse (join spatial raté,
 *     centroïde hors polygone, RTA manquante). Rapporte aussi la complétude du
 *     dataset FSA (fsa_count vs fsa_expected) et l'index chargé.
 *
 *   --mode enriched [--slugs a,b] [--limit N]
 *     Lit les sidecars `qc-lots` dans l'ordre de service (sous-dossier puis
 *     clé plate) et rapporte, par muni, les normes pliées et les adresses.
 *     Les nulls restent des nulls structurels : aucune adresse n'est déduite.
 *
 *   --mode voie [--slugs a,b] [--limit N]
 *     Télécharge le XML du rôle MAMH de chaque muni (code_geo lu dans le sidecar
 *     stats.json, sinon résolu via l'index) et énumère les codes de générique de
 *     voie RL0101Ex RÉELS présents dans la source, avec leur fréquence et des
 *     exemples de noms de rue. Marque ceux qui NE sont PAS décodés par
 *     VOIE_GENERIC — c'est la base empirique (anti-invention) pour étendre la
 *     table de décodage avec les vrais codes observés (jamais devinés).
 *
 * Usage :
 *   tsx src/audit-lots-enriched.ts                         # couverture code_postal (servis)
 *   tsx src/audit-lots-enriched.ts --mode voie --limit 60  # codes RL0101Ex réels
 *   tsx src/audit-lots-enriched.ts --mode voie --slugs sainte-catherine
 */
import { XMLParser } from "fast-xml-parser";

import { fetchIndex, VOIE_GENERIC } from "./role-foncier.js";
import { FSA_KEY, loadFsaIndex } from "./lib/fsa-geocode.js";
import { exists, getJson, listSlugs, s3Client } from "./lib/s3.js";

const OUT_PREFIX = "normalized/qc-lots/";
const STATS_KEY = FSA_KEY.replace(/\.geojson$/, ".stats.json");
const ROLE_MILLESIME = 2026;
const ROLE_XML_URL = (code: string, m: number) =>
  `https://donneesouvertes.affmunqc.net/role/RL${code}_${m}.xml`;

interface Args {
  mode: "postal" | "voie" | "enriched";
  slugs: string[];
  limit: number;
}

function parseArgs(argv: string[]): Args {
  let mode: "postal" | "voie" | "enriched" = "postal";
  const slugs: string[] = [];
  let limit = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mode") {
      const value = String(argv[++i] ?? "postal");
      mode = value === "voie" || value === "enriched" ? value : "postal";
    }
    else if (a === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--limit") limit = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 60);
    else throw new Error(`unknown argument: ${a}`);
  }
  return { mode, slugs: [...new Set(slugs)], limit };
}

interface LotsStats {
  slug: string;
  num_lots: number;
  code_postal?: { num_with_code_postal: number; pct_with_code_postal: number; fsa_index_loaded: boolean };
  role?: { code_geo: string | null } | null;
  warnings?: string[];
}

interface EnrichedStats {
  slug: string;
  num_lots: number;
  num_with_norms?: number;
  role?: {
    code_geo?: string | null;
    num_with_adresse?: number;
    note?: string | null;
  } | null;
  warnings?: string[];
}

async function enumerateServedSlugs(s3: ReturnType<typeof s3Client>): Promise<string[]> {
  return (await listSlugs(s3, OUT_PREFIX, ".geojson", true))
    .filter((s) => s.startsWith("qc-lots-"))
    .map((s) => s.replace(/^qc-lots-/, ""))
    .sort();
}

async function readStats(s3: ReturnType<typeof s3Client>, slug: string): Promise<LotsStats | null> {
  try {
    return await getJson<LotsStats>(s3, `${OUT_PREFIX}qc-lots-${slug}.stats.json`);
  } catch {
    return null;
  }
}

/** geo-api serves the nested layout first when both layouts exist. */
async function readEnrichedStats(
  s3: ReturnType<typeof s3Client>,
  slug: string,
): Promise<{ key: string; stats: EnrichedStats } | null> {
  const keys = [
    `${OUT_PREFIX}qc-lots-${slug}/qc-lots-${slug}.stats.json`,
    `${OUT_PREFIX}qc-lots-${slug}.stats.json`,
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    return { key, stats: await getJson<EnrichedStats>(s3, key) };
  }
  return null;
}

async function runEnrichedAudit(args: Args): Promise<void> {
  const s3 = s3Client();
  let slugs = args.slugs.length ? args.slugs : await enumerateServedSlugs(s3);
  slugs = slugs.slice(0, args.limit);
  for (const slug of slugs) {
    const result = await readEnrichedStats(s3, slug);
    if (!result) {
      console.log(`SKIP ${slug} (sidecar qc-lots absent)`);
      continue;
    }
    const { stats } = result;
    const lots = Number.isFinite(stats.num_lots) ? stats.num_lots : 0;
    const folded = Number.isFinite(stats.num_with_norms) ? stats.num_with_norms! : 0;
    const addresses = Number.isFinite(stats.role?.num_with_adresse)
      ? stats.role!.num_with_adresse!
      : 0;
    const pct = (n: number): number => lots > 0 ? Math.round((10000 * n) / lots) / 100 : 0;
    console.log(
      `ENRICHED ${slug} key=${result.key} lots=${lots} ` +
      `folded_normes=${folded}/${lots}(${pct(folded)}%) ` +
      `adresse=${addresses}/${lots}(${pct(addresses)}%) ` +
      `adresse_null_structurel=${Math.max(0, lots - addresses)} ` +
      `code_geo=${stats.role?.code_geo ?? "null"}`,
    );
    if (stats.role?.note) console.log(`NOTE ${slug} ${stats.role.note}`);
    for (const warning of stats.warnings ?? []) console.log(`WARN ${slug} ${warning}`);
  }
}

async function runPostalAudit(): Promise<void> {
  const s3 = s3Client();

  // FSA dataset completeness.
  try {
    const fsaStats = await getJson<Record<string, unknown>>(s3, STATS_KEY);
    console.log(
      `FSA dataset: count=${fsaStats["fsa_count"]} expected=${fsaStats["fsa_expected"]} ` +
        `rejected=${fsaStats["fsa_rejected"]} (${STATS_KEY})`,
    );
  } catch {
    console.log(`FSA dataset stats absent (${STATS_KEY}) — lancer fsa-boundaries-prep.ts`);
  }
  try {
    const idx = await loadFsaIndex(s3);
    console.log(`FSA index loaded: ${idx.count} RTA polygons`);
  } catch (e) {
    console.log(`FSA index load FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  const slugs = await enumerateServedSlugs(s3);
  console.log(`\nSERVED munis: ${slugs.length}\n`);

  const rows: Array<{ slug: string; pct: number; n: number; lots: number; loaded: boolean; codeGeo: string | null }> = [];
  let missingStats = 0;
  for (const slug of slugs) {
    const st = await readStats(s3, slug);
    if (!st) {
      missingStats++;
      rows.push({ slug, pct: -1, n: 0, lots: 0, loaded: false, codeGeo: null });
      continue;
    }
    rows.push({
      slug,
      pct: st.code_postal?.pct_with_code_postal ?? -1,
      n: st.code_postal?.num_with_code_postal ?? 0,
      lots: st.num_lots ?? 0,
      loaded: st.code_postal?.fsa_index_loaded ?? false,
      codeGeo: st.role?.code_geo ?? null,
    });
  }

  rows.sort((a, b) => a.pct - b.pct);
  console.log("code_postal coverage per muni (ascending):");
  console.log("  pct%    n/lots            slug");
  for (const r of rows) {
    const pctStr = r.pct < 0 ? "  n/a " : `${r.pct.toFixed(1)}`.padStart(6);
    console.log(`  ${pctStr}  ${`${r.n}/${r.lots}`.padStart(15)}  ${r.slug}`);
  }

  const filled = rows.filter((r) => r.pct >= 0);
  const problem = filled.filter((r) => r.pct < 90);
  const zero = filled.filter((r) => r.pct === 0);
  const mean = filled.length ? filled.reduce((s, r) => s + r.pct, 0) / filled.length : 0;
  console.log(
    `\nSUMMARY: munis=${slugs.length} with_stats=${filled.length} missing_stats=${missingStats} ` +
      `mean_pct=${mean.toFixed(1)} below90=${problem.length} zero=${zero.length}`,
  );
  console.log(`PROBLEM (<90%): ${problem.map((r) => `${r.slug}=${r.pct}%`).join(", ") || "(none)"}`);
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

async function runVoieAudit(args: Args): Promise<void> {
  const s3 = s3Client();
  let slugs = args.slugs;
  if (slugs.length === 0) slugs = (await enumerateServedSlugs(s3)).slice(0, args.limit);
  else slugs = slugs.slice(0, args.limit);

  // Resolve code_geo per slug (sidecar first, then role index by name).
  const idx = await fetchIndex(ROLE_MILLESIME).catch(() => ({}) as Record<string, { code_geo: string; nom: string }>);
  const bySlugName = new Map<string, string>();
  for (const [k, v] of Object.entries(idx)) if (v && v.code_geo) bySlugName.set(k, v.code_geo);

  const globalCounts = new Map<string, number>();
  const examples = new Map<string, string[]>();
  let fetched = 0;
  for (const slug of slugs) {
    const st = await readStats(s3, slug);
    const code = st?.role?.code_geo ?? bySlugName.get(slug) ?? null;
    if (!code) {
      console.log(`SKIP ${slug} (no code_geo)`);
      continue;
    }
    let buf: Buffer;
    try {
      const res = await fetch(ROLE_XML_URL(code, ROLE_MILLESIME));
      if (!res.ok) {
        console.log(`SKIP ${slug} code=${code} HTTP ${res.status}`);
        continue;
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.log(`SKIP ${slug} code=${code} ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    fetched++;
    const root = xml.parse(buf.toString()) as Record<string, unknown>;
    const rl = (root["RL"] ?? root) as Record<string, unknown>;
    const units = asArray(rl["RLUEx"]) as Record<string, unknown>[];
    let localCodes = 0;
    for (const u of units) {
      const addr = u["RL0101"] as Record<string, unknown> | undefined;
      if (!addr) continue;
      for (const o of asArray(addr["RL0101x"]) as Record<string, unknown>[]) {
        const ex = o["RL0101Ex"];
        if (typeof ex !== "string" || !ex.trim()) continue;
        const codeUp = ex.trim().toUpperCase();
        globalCounts.set(codeUp, (globalCounts.get(codeUp) ?? 0) + 1);
        localCodes++;
        if (!(codeUp in VOIE_GENERIC)) {
          const name = String(o["RL0101Gx"] ?? "").trim();
          const civ = String(o["RL0101Ax"] ?? "").trim();
          const ex3 = examples.get(codeUp) ?? [];
          if (ex3.length < 4 && name) {
            const sample = `${civ ? civ + " " : ""}${codeUp} ${name} [${slug}]`;
            if (!ex3.includes(sample)) ex3.push(sample);
            examples.set(codeUp, ex3);
          }
        }
      }
    }
    console.log(`OK ${slug} code=${code} units=${units.length} addr_codes=${localCodes}`);
  }

  console.log(`\nfetched ${fetched}/${slugs.length} rôles`);
  const sorted = [...globalCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log("\nDISTINCT RL0101Ex codes (code count decoded?):");
  for (const [code, count] of sorted) {
    const decoded = VOIE_GENERIC[code];
    console.log(`  ${code}  ${String(count).padStart(8)}  ${decoded ? `-> ${decoded}` : "*** UNDECODED ***"}`);
  }
  console.log("\nUNDECODED codes with examples (candidates for VOIE_GENERIC — decode authoritatively, never guess):");
  for (const [code, count] of sorted) {
    if (code in VOIE_GENERIC) continue;
    console.log(`  ${code} (${count}):`);
    for (const ex of examples.get(code) ?? []) console.log(`      ${ex}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "enriched") await runEnrichedAudit(args);
  else if (args.mode === "voie") await runVoieAudit(args);
  else await runPostalAudit();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
