/**
 * Materialize the named missed ground-truth events after a read-only recall
 * run. This is reporting only: it never feeds detection and reads immo solely
 * as the scoring-side ground truth.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface ImmoEvent {
  readonly node_id: string;
  readonly city_slug: string;
  readonly kind: string;
  readonly label: string;
  readonly source_url: string;
}

interface RecallMiss {
  readonly immo: { readonly source_fields: { readonly event_id: unknown } } | null;
}

interface RecallMatched {
  readonly immo: { readonly natural_key: {
    readonly muni: string | null;
    readonly source_url_norm: string | null;
    readonly date_iso: string | null;
    readonly type: string | null;
  } } | null;
}

interface RecallReport {
  readonly aggregate: { readonly matched: number; readonly missed: number; readonly recall: number | null };
  readonly cities: readonly { readonly partition: { readonly missed: readonly RecallMiss[]; readonly matched: readonly RecallMatched[] } }[];
}

interface SourceObservation {
  readonly url: string;
  readonly state: "text-layer" | "scan-sans-couche-texte" | "read-error";
  readonly reason: string | null;
}

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readPath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`) && !resolve(path).startsWith("/")) throw new Error(`chemin hors dépôt: ${path}`);
  return resolve(path).startsWith("/") ? resolve(path) : absolute;
}

function readNdjson(path: string): unknown[] {
  return readFileSync(readPath(path), "utf8").split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function immoEvents(path: string): Map<string, ImmoEvent> {
  const events = new Map<string, ImmoEvent>();
  for (const item of readNdjson(path)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.node_type !== "DesignationEvent") continue;
    const fields = ["node_id", "city_slug", "kind", "label", "source_url"] as const;
    if (fields.some((field) => typeof row[field] !== "string" || !row[field]?.trim())) continue;
    events.set(row.node_id as string, {
      node_id: row.node_id as string,
      city_slug: row.city_slug as string,
      kind: row.kind as string,
      label: row.label as string,
      source_url: row.source_url as string,
    });
  }
  return events;
}

function reason(event: ImmoEvent, observations: ReadonlyMap<string, SourceObservation>): string {
  const observation = observations.get(event.source_url);
  if (observation?.state === "read-error") return `document inaccessible (${observation.reason ?? "erreur de lecture"})`;
  if (observation?.state === "scan-sans-couche-texte") return "document scan sans couche texte";
  if (observation === undefined) return "document absent de l’inventaire de dry-run";
  return "clé de scoring non alignée : taxonomie immo et taxonomie neutre geo différentes (crosswalk absent)";
}

function scoringKey(event: ImmoEvent): string {
  return JSON.stringify([event.city_slug.toLowerCase(), new URL(event.source_url).toString(), event.kind.toLowerCase()]);
}

function matchedKey(match: RecallMatched): string | null {
  const key = match.immo?.natural_key;
  if (!key?.muni || !key.source_url_norm || !key.date_iso || !key.type) return null;
  return JSON.stringify([key.muni, key.source_url_norm, key.type]);
}

function main(): void {
  const recallPath = argumentValue("--recall");
  const immoPath = argumentValue("--immo-events");
  const observationsPath = argumentValue("--observations");
  const outPath = argumentValue("--out");
  if (!recallPath || !immoPath || !observationsPath || !outPath) throw new Error("--recall --immo-events --observations --out requis");
  const output = readPath(outPath);
  if (existsSync(output)) throw new Error(`refus d'écraser l'artefact: ${outPath}`);
  const report = JSON.parse(readFileSync(readPath(recallPath), "utf8")) as RecallReport;
  const sourceMap = new Map(
    (JSON.parse(readFileSync(readPath(observationsPath), "utf8")) as SourceObservation[])
      .map((observation) => [observation.url, observation]),
  );
  const byId = immoEvents(immoPath);
  const matched = new Set(report.cities.flatMap((city) => city.partition.matched)
    .map(matchedKey)
    .filter((key): key is string => key !== null));
  const misses = [...byId.values()]
    .filter((event) => !matched.has(scoringKey(event)))
    .sort((left, right) => left.city_slug.localeCompare(right.city_slug) || left.node_id.localeCompare(right.node_id));
  const lines = [
    "# qc-zoning-events — événements immo manqués (dry-run PV v10)",
    "",
    `Recall : **${String(report.aggregate.matched)}/85** (${report.aggregate.recall === null ? "n/a" : `${(report.aggregate.recall * 100).toFixed(2)} %`}); ${String(report.aggregate.missed)} événements immo restent hors match.`,
    "",
    "Les raisons ci-dessous sont le constat de scoring. Elles ne sont jamais une entrée du détecteur geo.",
    "",
    ...misses.map((event) => `- **${event.city_slug}** — \`${event.node_id}\` — ${event.label}\n  - ${reason(event, sourceMap)}`),
    "",
  ];
  writeFileSync(output, lines.join("\n"), { flag: "wx" });
}

main();
