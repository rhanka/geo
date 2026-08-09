/**
 * _am-align-probe.ts — $0 diagnostic for the affectation-MATRIX grille family.
 *
 * Prints, for the header band and each norm row of a `pdftotext -layout` page, the
 * CHARACTER COLUMN of every token, so a mis-binding can be read off directly
 * (are the value columns aligned with the number columns, and within what drift?).
 *
 * Usage: npx tsx acquisition/src/_am-align-probe.ts --pdf <path> [--page 1]
 */
import { spawnSync } from "node:child_process";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("--pdf <path> required");
const page = Number(arg("page") ?? "1");

const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
});
if (r.status !== 0) throw new Error(`pdftotext failed: ${r.stderr?.slice(0, 200)}`);
const text = (r.stdout ?? "").split("\f")[page - 1] ?? "";
const lines = text.split(/\r?\n/);

function toks(line: string): { t: string; start: number }[] {
  const out: { t: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push({ t: m[0], start: m.index });
  return out;
}

// Number rows = the contiguous run 1,2,3,… ; norm rows = anything matching a norm label.
for (let i = 0; i < lines.length; i++) {
  const line = lines[i] ?? "";
  const run: { t: string; start: number }[] = [];
  for (const tk of toks(line)) {
    if (!/^\d{1,3}$/.test(tk.t)) continue;
    if (Number(tk.t) === run.length + 1) run.push(tk);
    else if (run.length) break;
  }
  const isNorm = /MARGE|HAUTEUR|SUPERFICIE|IMPLANTATION|FRONTAGE/i.test(line);
  if (run.length >= 5) {
    console.log(`\n=== L${i} NUMBER RUN (${run.length}) ===`);
    console.log(run.map((t) => `${t.t}@${t.start}`).join(" "));
    const next = lines[i + 1] ?? "";
    console.log(`--- L${i + 1} NEXT: ${toks(next).slice(0, 45).map((t) => `${t.t}@${t.start}`).join(" ")}`);
  }
  if (isNorm) {
    console.log(`\n=== L${i} NORM ROW ===`);
    console.log(toks(line).map((t) => `${t.t}@${t.start}`).join(" "));
  }
}
