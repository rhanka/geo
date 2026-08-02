/**
 * Sonde one-off : épure un worklist de capture zones des clés non reconnues par
 * parseCaptureWorklist (notamment `expected_sha256`, ajouté par erreur par le
 * générateur v2-masse). Le launcher k8s-capture-run.ts n'accepte que
 * {slug, source, urls}. Réémet la forme stricte.
 *
 * Usage : npx tsx acquisition/src/_zones-worklist-strip-sha.ts --in=<src.json> --out=<dst.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

function opt(name: string): string | null {
  const p = `--${name}=`;
  const a = process.argv.slice(2).find((x) => x.startsWith(p));
  return a === undefined ? null : a.slice(p.length);
}

const inPath = opt("in");
const outPath = opt("out");
if (!inPath || !outPath) throw new Error("--in and --out required");

const raw = JSON.parse(readFileSync(inPath, "utf8")) as unknown;
if (!Array.isArray(raw)) throw new Error("worklist is not an array");

const stripped = raw.map((entry) => {
  if (entry === null || typeof entry !== "object") throw new Error("invalid entry");
  const e = entry as Record<string, unknown>;
  if (typeof e.slug !== "string" || !Array.isArray(e.urls)) {
    throw new Error(`entry missing slug/urls: ${JSON.stringify(e).slice(0, 120)}`);
  }
  const out: Record<string, unknown> = { slug: e.slug, urls: e.urls };
  if (typeof e.source === "string") out.source = e.source;
  return out;
});

writeFileSync(outPath, `${JSON.stringify(stripped, null, 2)}\n`);
process.stdout.write(`stripped ${stripped.length} entries -> ${outPath}\n`);
