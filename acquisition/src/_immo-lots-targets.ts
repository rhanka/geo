/**
 * _immo-lots-targets.ts -- pick target munis from work/coverage/immo-lots.json.
 *
 * Reads the audit output (authoritative S3 measure) and prints the slugs whose
 * given field is below 100%, so a lane can re-run the right enrichment on the
 * right cities instead of re-grinding the whole served set.
 *
 * Usage:
 *   tsx src/_immo-lots-targets.ts --field adresse --shard 0/1 --limit 10
 *   tsx src/_immo-lots-targets.ts --field folded-normes --with-normes
 */
import { readFile } from "node:fs/promises";

interface PerMuni {
  slug: string;
  numLots: number;
  normesStatus?: string;
  fieldPct: Record<string, number>;
  fieldNum: Record<string, number>;
}

interface Audit {
  generatedAt: string;
  perMuni: PerMuni[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] ?? fallback) : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const field = arg("field", "adresse");
  const limit = parseInt(arg("limit", "0"), 10) || 0;
  const [si, st] = arg("shard", "0/1").split("/").map((v) => parseInt(v, 10));
  const audit = JSON.parse(
    await readFile("work/coverage/immo-lots.json", "utf8"),
  ) as Audit;

  const all = audit.perMuni.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  const minLots = parseInt(arg("min-lots", "1"), 10) || 1;
  let rows = all.filter((m) => (m.fieldPct[field] ?? 0) < 100 && m.numLots >= minLots);
  if (has("zero-only")) rows = rows.filter((m) => (m.fieldPct[field] ?? 0) === 0);
  if (has("with-normes")) rows = rows.filter((m) => m.normesStatus === "served" || m.normesStatus === "deposited");

  const shard = rows.filter((_, i) => i % st! === si!);
  const picked = limit > 0 ? shard.slice(0, limit) : shard;

  console.log(`audit=${audit.generatedAt} field=${field} below100=${rows.length} shard=${si}/${st} -> ${shard.length}`);
  const byStatus = new Map<string, number>();
  for (const m of shard) byStatus.set(m.normesStatus ?? "-", (byStatus.get(m.normesStatus ?? "-") ?? 0) + 1);
  console.log(`normesStatus: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const m of picked) {
    console.log(`${m.slug}\t${field}=${m.fieldPct[field] ?? 0}%\tlots=${m.numLots}\tnormes=${m.normesStatus ?? "-"}`);
  }
  console.log(`SLUGS ${picked.map((m) => m.slug).join(",")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
