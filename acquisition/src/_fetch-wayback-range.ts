/**
 * _fetch-wayback-range — $0. Télécharge un fichier archivé sur web.archive.org en
 * plusieurs requêtes `Range` et réassemble, puis extrait le texte (`pdftotext -layout`).
 *
 * POURQUOI: mesuré 2026-07-19 (lane usage_dominant, shard 0/2), une lecture simple de
 * `web.archive.org/web/<ts>id_/<url>` TRONQUE à exactement 1 048 576 octets (1 MiB) —
 * reproduit via curl ET fetch, sandbox on/off. Le PDF arrive avec l'en-tête « %PDF- »
 * mais pdftotext meurt sur « Couldn't read xref table ». Ce n'est pas un plafond
 * général: 2,5 Mo passent sans peine depuis un hôte vivant. D'où la lecture par plages.
 *
 *   npx tsx acquisition/src/_fetch-wayback-range.ts --url "https://web.archive.org/web/<ts>id_/<url>" --name saint-simeon
 *   npx tsx acquisition/src/_fetch-wayback-range.ts --name saint-simeon --grep "dominant|vocation"
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRATCH =
  process.env.CLAUDE_SCRATCHPAD ??
  "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/0bb46f7a-d547-4039-965a-7b92261dd146/scratchpad";
const CHUNK = 1024 * 1024;

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function download(url: string, file: string): Promise<void> {
  const parts: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < 64; i++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Range: `bytes=${offset}-${offset + CHUNK - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      console.log(`  plage ${offset}: HTTP ${res.status} — arrêt`);
      break;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`  plage ${offset} -> ${buf.length}o (status ${res.status}, content-range=${res.headers.get("content-range") ?? "-"})`);
    if (!buf.length) break;
    parts.push(buf);
    offset += buf.length;
    if (buf.length < CHUNK) break;
  }
  const all = Buffer.concat(parts);
  writeFileSync(file, all);
  console.log(`# total=${all.length}o -> ${file}`);
}

async function main(): Promise<void> {
  const name = (arg("name") ?? "wayback").replace(/[^a-z0-9._-]/gi, "_");
  const file = resolve(SCRATCH, `${name}.pdf`);
  const url = arg("url");
  if (url && (!existsSync(file) || process.argv.includes("--force"))) await download(url, file);
  if (!existsSync(file)) throw new Error(`no file: passer --url la 1re fois (cache=${file})`);

  const txt = resolve(SCRATCH, `${name}.txt`);
  execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", file, txt], { stdio: "inherit" });
  const lines = readFileSync(txt, "utf8").split("\n");
  console.log(`# texte: ${lines.length} lignes`);

  const grepTerm = arg("grep");
  const range = arg("lines");
  if (range) {
    const [a, b] = range.split("-").map((n) => parseInt(n, 10));
    for (let i = a; i <= Math.min(b, lines.length); i++) console.log(`${String(i).padStart(6)}| ${lines[i - 1]}`);
    return;
  }
  if (grepTerm) {
    const re = new RegExp(grepTerm, "i");
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      hits++;
      console.log(`--- L${i + 1} ---`);
      for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 6); j++) console.log(lines[j]);
    }
    console.log(`[grep "${grepTerm}" hits=${hits}]`);
  }
}

await main();
