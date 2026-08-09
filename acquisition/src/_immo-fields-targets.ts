/**
 * _immo-fields-targets.ts -- read work/coverage/immo-lots.json (written by
 * immo-lots-audit.ts) and print, per field, the villes whose coverage is < 100%,
 * so a shard worker knows its worklist. Read-only over the audit artifact.
 *
 * Usage:
 *   tsx src/_immo-fields-targets.ts [field] [limit]
 *   field in {adresse, folded-normes, surface_m2, code_postal, in_tod, all}
 */
import { readFileSync } from "node:fs";

type PerMuni = {
  slug: string;
  numLots: number;
  normesStatus?: string;
  fieldPct: Record<string, number>;
  fieldNum: Record<string, number>;
};

const FIELDS = ["surface_m2", "code_postal", "adresse", "folded-normes", "in_tod"];

const audit = JSON.parse(readFileSync("work/coverage/immo-lots.json", "utf8"));
const per: PerMuni[] = audit.perMuni ?? [];

const wantField = process.argv[2] ?? "all";
const limit = Number(process.argv[3] ?? "60");

function summary() {
  const totalMuni = per.length;
  for (const f of FIELDS) {
    const full = per.filter((m) => (m.fieldPct?.[f] ?? 0) >= 100).length;
    const below = per.filter((m) => (m.fieldPct?.[f] ?? 0) < 100).length;
    console.log(`${f.padEnd(14)} ${full}/${totalMuni} villes=100%  résidu=${below}`);
  }
  console.log("");
}

function listField(f: string) {
  const rows = per
    .filter((m) => (m.fieldPct?.[f] ?? 0) < 100)
    .sort((a, b) => (a.fieldPct[f] ?? 0) - (b.fieldPct[f] ?? 0));
  console.log(`=== ${f}: ${rows.length} villes < 100% ===`);
  for (const m of rows.slice(0, limit)) {
    const pct = (m.fieldPct?.[f] ?? 0).toFixed(1);
    const num = m.fieldNum?.[f] ?? 0;
    console.log(
      `${m.slug.padEnd(30)} ${pct.padStart(6)}%  ${num}/${m.numLots}  normes=${m.normesStatus ?? "?"}`,
    );
  }
}

function listPartial(f: string) {
  // villes où le champ est déjà PARTIELLEMENT rempli (1..99%): fold prouvé,
  // fort candidat "stale serving" -> re-run lots-enriched peut compléter.
  const rows = per
    .filter((m) => {
      const p = m.fieldPct?.[f] ?? 0;
      return p > 0 && p < 100 && (m.numLots ?? 0) > 0;
    })
    .sort((a, b) => (b.fieldPct[f] ?? 0) - (a.fieldPct[f] ?? 0));
  console.log(`=== ${f}: ${rows.length} villes PARTIELLES (1-99%), tri desc ===`);
  for (const m of rows.slice(0, limit)) {
    const pct = (m.fieldPct?.[f] ?? 0).toFixed(1);
    const num = m.fieldNum?.[f] ?? 0;
    console.log(
      `${m.slug.padEnd(30)} ${pct.padStart(6)}%  ${num}/${m.numLots}  normes=${m.normesStatus ?? "?"}`,
    );
  }
}

function showSlugs(csv: string) {
  const want = new Set(csv.split(",").filter(Boolean));
  for (const m of per.filter((x) => want.has(x.slug))) {
    const parts = FIELDS.map((f) => `${f}=${(m.fieldPct?.[f] ?? 0).toFixed(2)}%(${m.fieldNum?.[f] ?? 0}/${m.numLots})`);
    console.log(`${m.slug}  normes=${m.normesStatus ?? "?"}  ${parts.join("  ")}`);
  }
}

summary();
if (wantField.startsWith("slug:")) {
  showSlugs(wantField.slice("slug:".length));
} else if (wantField === "all") {
  for (const f of ["surface_m2", "code_postal"]) listField(f);
} else if (wantField.startsWith("partial:")) {
  listPartial(wantField.slice("partial:".length));
} else {
  listField(wantField);
}
