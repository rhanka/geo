/**
 * Convertit un rapport de classification d'octets PV
 * (`pv-capture-octets-classification/v1`, produit par
 * `capture-octets-classification --lane=pv`) en fichier de VERDICT que
 * `pv-couverture-municipale` fold (glob `pv-lecture-visuelle-*.json`).
 *
 * Chaque ligne classée `PV_LISIBLE_PROPRIETAIRE_CONFIRME` (propriétaire imprimé
 * confirmé par extraction de texte natif, en amont dans le classifieur) devient
 * un document `outcome=INDEXED, owner_status=CONFIRMED`. La confirmation
 * propriétaire↔municipalité est faite par le classifieur ; ici on la
 * TRANSCRIT sans la refaire, et on n'invente jamais un INDEXED : seules les
 * lignes déjà confirmées sont émises.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-octets-to-verdict.ts \
 *     --report=work/coverage/pv-capture-octets-<UTC>.json \
 *     --out=work/coverage/pv-lecture-visuelle-<nom>-<UTC>.json \
 *     [--note="…"]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CONFIRMED_CLASS = "PV_LISIBLE_PROPRIETAIRE_CONFIRME";

export interface OctetLine {
  readonly slug?: unknown;
  readonly storage_key?: unknown;
  readonly classification?: unknown;
  readonly owner_verbatim?: unknown;
}

export interface VerdictDocument {
  readonly storage_key: string;
  readonly outcome: "INDEXED";
  readonly slug: string;
  readonly owner_status: "CONFIRMED";
  readonly printed_owner: string;
}

/**
 * Émet un document INDEXED par ligne confirmée. Une ligne sans slug,
 * sans storage_key durable ou sans propriétaire imprimé n'est PAS émise
 * (anti-invention) : la couverture n'est portée que par une preuve complète.
 * Déduplique par storage_key (projection CAS).
 */
export function verdictDocumentsFromOctets(lines: readonly OctetLine[]): VerdictDocument[] {
  const bySeen = new Set<string>();
  const documents: VerdictDocument[] = [];
  for (const line of lines) {
    if (line.classification !== CONFIRMED_CLASS) continue;
    const slug = typeof line.slug === "string" ? line.slug.trim() : "";
    const storageKey = typeof line.storage_key === "string" ? line.storage_key.trim() : "";
    const printedOwner = typeof line.owner_verbatim === "string" ? line.owner_verbatim.trim() : "";
    if (!slug || !storageKey || !printedOwner) continue;
    if (bySeen.has(storageKey)) continue;
    bySeen.add(storageKey);
    documents.push({ storage_key: storageKey, outcome: "INDEXED", slug, owner_status: "CONFIRMED", printed_owner: printedOwner });
  }
  return documents.sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key),
  );
}

function value(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return resolved;
}

function main(): void {
  const reportArg = value("report");
  const outArg = value("out");
  if (!reportArg) throw new Error("--report=work/coverage/pv-capture-octets-<UTC>.json est requis");
  if (!outArg) throw new Error("--out=work/coverage/pv-lecture-visuelle-<nom>-<UTC>.json est requis");
  const reportPath = insideRepo(reportArg, "report");
  const outPath = insideRepo(outArg, "out");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { contract?: unknown; generated_at?: unknown; lines?: unknown };
  if (report.contract !== "pv-capture-octets-classification/v1") {
    throw new Error(`--report n'est pas un rapport pv-capture-octets-classification/v1: ${String(report.contract)}`);
  }
  const lines = Array.isArray(report.lines) ? (report.lines as OctetLine[]) : [];
  const documents = verdictDocumentsFromOctets(lines);
  if (documents.length === 0) throw new Error("aucune ligne PV_LISIBLE_PROPRIETAIRE_CONFIRME: rien à indexer");
  const note =
    value("note") ??
    `Verdicts issus de la classification scriptée des octets captés (source=pv-index) : ` +
      `capture-octets-classification --lane=pv, classe ${CONFIRMED_CLASS} = propriétaire imprimé ` +
      `confirmé par extraction de texte natif. printed_owner = propriétaire imprimé verbatim ` +
      `(rapport voisin ${reportArg}). Aucune lecture à l'œil : transcription du verdict natif.`;
  const generatedAt = typeof report.generated_at === "string" ? report.generated_at : null;
  const body = { generated_at: generatedAt, note, documents };
  if (existsSync(outPath)) throw new Error(`refus d'écraser le verdict: ${outArg}`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const bySlug = new Map<string, number>();
  for (const document of documents) bySlug.set(document.slug, (bySlug.get(document.slug) ?? 0) + 1);
  process.stdout.write(
    `${JSON.stringify({ out: outArg, documents: documents.length, slugs: Object.fromEntries([...bySlug].sort()) }, null, 2)}\n`,
  );
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
