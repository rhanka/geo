/**
 * immo-lots-fold-lookup.ts — READ-ONLY per-slug lookup of the folded-normes rate.
 *
 * Reads the committed coverage report `work/coverage/immo-lots.report.json`
 * (produced by the lots materialization chain) and prints, for each requested
 * slug, the `folded-normes` percentage and count from its `perMuni` entry.
 *
 * Zero side effects: it does not touch S3, does not rewrite any shared coverage
 * or coherence file, and does not run the pipeline. Use it to answer
 * "lots_normes_pct" for a coherence PING-IMMO report without re-serving.
 *
 * Usage: npx tsx acquisition/src/immo-lots-fold-lookup.ts --slugs rosemere,champlain
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const REPORT = resolve(REPO, "work/coverage/immo-lots.report.json");

interface PerMuni {
  slug: string;
  numLots: number;
  normesStatus?: string;
  fieldPct?: Record<string, number>;
  fieldNum?: Record<string, number>;
}

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const csv = arg(process.argv.slice(2), "slugs") ?? arg(process.argv.slice(2), "slug");
  if (!csv) throw new Error("usage: --slugs <a,b>");
  const want = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { generatedAt?: string; perMuni?: PerMuni[] };
  const bySlug = new Map<string, PerMuni>();
  for (const m of report.perMuni ?? []) bySlug.set(m.slug, m);
  console.log("report generatedAt=" + (report.generatedAt ?? "?"));
  for (const slug of want) {
    const m = bySlug.get(slug);
    if (!m) {
      console.log(slug + " : ABSENT du report perMuni");
      continue;
    }
    const pct = m.fieldPct?.["folded-normes"];
    const num = m.fieldNum?.["folded-normes"];
    console.log(
      slug +
        " : numLots=" +
        m.numLots +
        " normesStatus=" +
        (m.normesStatus ?? "?") +
        " folded-normes=" +
        (pct ?? 0) +
        "% (" +
        (num ?? 0) +
        " lots)",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
