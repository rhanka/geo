/**
 * _zone-source-registry-merge.ts — merge des candidates du registre de SOURCING
 * (work/coverage/null-zone-sourcing-*.json) dans le registre AUTORITAIRE de
 * corrections (acquisition/config/zone-source-corrections.json), lu EN PRIORITE par
 * `fold-zone-source-to-zonage.ts` pour stamper zone_source_url + zone_source_level
 * sur la donnee servie qc-zonage-<slug>.
 *
 * POURQUOI: la lane de sourcing (diagnostic 0-S3) a trouve des sources geometriques
 * publiques REELLES (ArcGIS/AGOL/WFS/GeoJSON officiel) recoupant les codes servis
 * pour des collections aujourd'hui zone_source_url=null. Les porter au registre les
 * rend DURABLES (un fold --all ne les revert plus) et les expose additivement sur S3.
 *
 * ANTI-INVENTION / FAIL-SAFE:
 *   - N'ajoute QUE verdict === "candidate-real-source" avec une url http(s) reelle.
 *   - Niveau par defaut "candidate" (recoupement automatique, PAS revue humaine).
 *     Promotion "documented" UNIQUEMENT via --promote-documented <slugs> (ratification
 *     conducteur d'un exact-match re-telechargeable). Jamais "historical-verified" ici
 *     (aucun octet source historique conserve — ca reste le domaine d'une re-acquisition
 *     v2 via zones-arcgis-replace / zones-geocentralis-replace).
 *   - NE MODIFIE JAMAIS une entree existante du registre (les corrections humaines /
 *     durabilite gagnent toujours). N'AJOUTE que les slugs absents. Idempotent.
 *   - Preserve le wrapper {corrections:{...}} et toute autre cle top-level.
 *
 * Usage (npx tsx, depuis acquisition/):
 *   NODE_OPTIONS=--dns-result-order=ipv4first npx tsx src/_zone-source-registry-merge.ts --dry-run
 *   npx tsx src/_zone-source-registry-merge.ts --apply
 *   npx tsx src/_zone-source-registry-merge.ts --apply --promote-documented quebec,sherbrooke,shawinigan
 *   npx tsx src/_zone-source-registry-merge.ts --dry-run --sources work/coverage/null-zone-sourcing-20260724.json,work/coverage/null-zone-sourcing-20260724-part2.json
 *
 * N'ECRIT PAS S3. N'appelle PAS le fold. Apres --apply, lancer separement:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/fold-zone-source-to-zonage.ts --slugs <ajoutes> --dry-run   # puis sans --dry-run
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORRECTIONS_PATH = resolve(ROOT, "acquisition", "config", "zone-source-corrections.json");
const DEFAULT_SOURCES = [
  resolve(ROOT, "work", "coverage", "null-zone-sourcing-20260724.json"),
  resolve(ROOT, "work", "coverage", "null-zone-sourcing-20260724-part2.json"),
];

const HTTP_URL = /^https?:\/\//;
// Une URL a placeholder (ex. JMap `sessionId=<SESSION>`) est un TEMPLATE non resolvable,
// pas une source canonique directe: la stamper violerait l'anti-invention. On rejette
// tout `<`/`>`. Les endpoints ArcGIS FeatureServer/query, WFS CQL_FILTER et GeoJSON
// officiels n'en contiennent pas.
const TEMPLATE_URL = /[<>]/;
// Doit rester un sous-ensemble strict du vocabulaire accepte par
// fold-zone-source-to-zonage.ts (loadCorrections). "documented" seulement sur ratification.
const ALLOWED_MERGE_LEVELS = new Set(["candidate", "documented"]);

interface SourcingEntry {
  slug: string;
  verdict: string;
  url: string | null;
  type: string | null;
  features: number | null;
  codes_recoupes: string[];
  note?: string;
}

interface CorrectionEntry {
  zone_source_url: string;
  zone_source_level: string;
  [k: string]: unknown;
}

interface CorrectionsFile {
  corrections: Record<string, CorrectionEntry>;
  [k: string]: unknown;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function loadSourcing(paths: string[]): SourcingEntry[] {
  const out: SourcingEntry[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.warn(`sourcing: ${p} absent — ignore`);
      continue;
    }
    const raw = JSON.parse(readFileSync(p, "utf8")) as SourcingEntry[];
    if (!Array.isArray(raw)) {
      console.warn(`sourcing: ${p} n'est pas un tableau — ignore`);
      continue;
    }
    out.push(...raw);
    console.log(`sourcing: ${p} — ${raw.length} entrees`);
  }
  return out;
}

function loadCorrections(): CorrectionsFile {
  if (!existsSync(CORRECTIONS_PATH)) {
    console.warn(`corrections: ${CORRECTIONS_PATH} absent — creation d'un registre neuf`);
    return { corrections: {} };
  }
  const raw = JSON.parse(readFileSync(CORRECTIONS_PATH, "utf8")) as CorrectionsFile;
  if (!raw.corrections || typeof raw.corrections !== "object") raw.corrections = {};
  return raw;
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run") || !apply;
  const sources = (arg(argv, "sources") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => resolve(ROOT, s));
  const paths = sources.length > 0 ? sources : DEFAULT_SOURCES;
  const promote = new Set(
    (arg(argv, "promote-documented") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );

  const sourcing = loadSourcing(paths);
  const file = loadCorrections();
  const existing = file.corrections;

  const added: string[] = [];
  const skippedExisting: string[] = [];
  const skippedVerdict: string[] = [];
  const skippedNoUrl: string[] = [];
  const skippedTemplate: string[] = [];
  const promotedMissing: string[] = [];

  // Dedup: garder la meilleure candidate par slug (plus de codes recoupes gagne).
  const bySlug = new Map<string, SourcingEntry>();
  for (const e of sourcing) {
    if (e.verdict !== "candidate-real-source") { skippedVerdict.push(e.slug); continue; }
    if (typeof e.url !== "string" || !HTTP_URL.test(e.url)) { skippedNoUrl.push(e.slug); continue; }
    if (TEMPLATE_URL.test(e.url)) { skippedTemplate.push(e.slug); continue; }
    const prev = bySlug.get(e.slug);
    if (!prev || (e.codes_recoupes?.length ?? 0) > (prev.codes_recoupes?.length ?? 0)) bySlug.set(e.slug, e);
  }

  for (const [slug, e] of [...bySlug.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (slug in existing) { skippedExisting.push(slug); continue; }
    const level = promote.has(slug) ? "documented" : "candidate";
    if (!ALLOWED_MERGE_LEVELS.has(level)) continue; // defensif
    existing[slug] = {
      zone_source_url: e.url as string,
      zone_source_level: level,
      _provenance_source: "null-zone-sourcing-20260724",
      _source_type: e.type,
      _codes_recoupes: e.codes_recoupes ?? [],
      _features: e.features ?? null,
      _note: e.note ?? null,
    };
    added.push(`${slug} [${level}] ${e.type ?? "?"} <- ${e.url}`);
  }

  for (const slug of promote) {
    if (!(slug in existing)) promotedMissing.push(slug);
  }

  console.log("");
  console.log(`ADDED=${added.length} SKIPPED_EXISTING=${skippedExisting.length} ` +
    `SKIPPED_VERDICT=${skippedVerdict.length} SKIPPED_NO_URL=${skippedNoUrl.length} ` +
    `SKIPPED_TEMPLATE_URL=${skippedTemplate.length}`);
  if (skippedTemplate.length) console.log(`  ~ url-template (placeholder, non canonique) rejetes: ${skippedTemplate.sort().join(",")}`);
  for (const a of added) console.log(`  + ${a}`);
  if (skippedExisting.length) console.log(`  = existants preserves: ${skippedExisting.sort().join(",")}`);
  if (promotedMissing.length) {
    console.log(`  ! --promote-documented pour slug(s) NON candidate/absent(s): ${promotedMissing.sort().join(",")} (ignore)`);
  }

  if (dryRun) {
    console.log(`\nDRY-RUN — aucune ecriture. ${added.length} slug(s) seraient ajoutes a ${CORRECTIONS_PATH}`);
    console.log(`Pour appliquer: --apply  (puis fold-zone-source-to-zonage.ts --slugs ${added.map((a) => a.split(" ")[0]).join(",")} avec ipv4first)`);
    return;
  }

  writeFileSync(CORRECTIONS_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  console.log(`\nWROTE ${CORRECTIONS_PATH} — total corrections=${Object.keys(existing).length} (+${added.length})`);
  console.log(`SUIVANT: NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx src/fold-zone-source-to-zonage.ts --slugs ${added.map((a) => a.split(" ")[0]).join(",")} --dry-run`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try { main(); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
}
