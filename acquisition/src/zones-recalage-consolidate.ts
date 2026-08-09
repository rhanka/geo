/**
 * Consolide les rapports par-slug du recalage PDF→zonage (shard) en un JSON + MD
 * de synthèse. Lit work/delegation-mass/zones-recalage-2/<slug>.json.
 *
 * Usage : npx tsx acquisition/src/zones-recalage-consolidate.ts \
 *           --in work/delegation-mass/zones-recalage-2 \
 *           --out work/delegation-mass/zones-recalage-2-20260709-S2
 *   → écrit <out>.json et <out>.md
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const inDir = resolve(arg("in", "work/delegation-mass/zones-recalage-2")!);
const outBase = resolve(arg("out", "work/delegation-mass/zones-recalage-2-consolidated")!);

type Row = Record<string, any> & { slug?: string };

const rows: Row[] = [];
if (existsSync(inDir)) {
  for (const f of readdirSync(inDir).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(inDir, f), "utf8"));
      rows.push({ slug: j.slug ?? f.replace(/\.json$/, ""), ...j });
    } catch (e) {
      rows.push({ slug: f.replace(/\.json$/, ""), parseError: String(e) });
    }
  }
}

const asStr = (v: any): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
const isNoInput = (r: Row): boolean => {
  const hay = `${asStr(r.classification)} ${asStr(r.failureReason)}`.toLowerCase();
  return r.deposited !== true && (hay.includes("no-input") || hay.includes("no-zonage-plan") || hay.includes("no-zoning-plan"));
};

const served = rows.filter((r) => r.deposited === true);
const noInput = rows.filter((r) => isNoInput(r));
const skipped = rows.filter((r) => r.deposited !== true && !isNoInput(r));

const summary = {
  generatedFor: "recalage-pdf-zones shard 2/4",
  total: rows.length,
  served: served.length,
  noInput: noInput.length,
  skippedWithEvidence: skipped.length,
  servedSlugs: served.map((r) => r.slug),
  rows: rows.map((r) => ({
    slug: r.slug,
    classification: r.classification ?? null,
    tierTried: r.tierTried ?? null,
    deposited: r.deposited ?? false,
    collectionKey: r.collectionKey ?? null,
    gate: r.gate ?? null,
    failureReason: r.failureReason ?? null,
    pdfUrl: r.pdfUrl ?? null,
  })),
};

writeFileSync(`${outBase}.json`, JSON.stringify(summary, null, 2));

const num = (v: any): string => (v == null || typeof v === "object" ? "-" : String(v));
const line = (r: Row): string => {
  const g = r.gate ?? {};
  const res = num(g.residualM);
  const hold = num(g.holdoutM);
  const codes = num(g.codesDistinct);
  const serv = num(g.servingCoveragePct);
  const verdict = r.deposited ? "SERVI" : isNoInput(r) ? "no-input" : "SKIP";
  const cls = asStr(r.classification).slice(0, 40) || "-";
  const reason = asStr(r.failureReason) || asStr(g.reason) || asStr(r.classification) || "";
  return `| ${r.slug} | ${verdict} | ${cls} | ${res} | ${hold} | ${codes} | ${serv} | ${reason.replace(/\n/g, " ").slice(0, 80)} |`;
};

const md = [
  `# Recalage PDF→zones — shard 2/4 (synthèse)`,
  ``,
  `Slugs traités : **${rows.length}** — servis: **${served.length}** · no-input: **${noInput.length}** · skip-avec-preuve: **${skipped.length}**`,
  ``,
  served.length
    ? `**Collections servies :** ${served.map((r) => `\`qc-zonage-${r.slug}\``).join(", ")}`
    : `**Aucune collection servie ce shard** (voir preuves d'échec ci-dessous).`,
  ``,
  `| slug | verdict | classe | résidu(m) | holdout(m) | codes | serving% | raison |`,
  `|---|---|---|---|---|---|---|---|`,
  ...rows.map(line),
  ``,
  `_Preuve = résidu/holdout/anisotropie mesurés ; anti-invention : aucun zone_code fabriqué._`,
  ``,
].join("\n");

writeFileSync(`${outBase}.md`, md);

console.log(JSON.stringify({ wrote: [`${outBase}.json`, `${outBase}.md`], ...summary }, null, 2));
