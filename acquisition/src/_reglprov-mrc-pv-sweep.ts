/**
 * _reglprov-mrc-pv-sweep.ts — sonde READ-ONLY, $0, lane P0_1 (provenance règlement).
 *
 * POURQUOI (gisement neuf): plusieurs HOLD-NULL sont motivés « la MUNICIPALITÉ ne
 * diffuse aucun règlement d'urbanisme » — verdict mesuré et exact sur le site de la
 * MUNI. Mais la muni n'est pas le seul PUBLIEUR de son propre numéro de zonage: la
 * **MRC** doit délivrer un CERTIFICAT DE CONFORMITÉ à tout règlement d'urbanisme de
 * ses municipalités, et la résolution qui l'accorde NOMME le règlement verbatim
 * («... le règlement numéro 2XX de la Municipalité de Y modifiant son règlement de
 * zonage numéro Z ...»). Ce texte vit dans les PROCÈS-VERBAUX du conseil des maires.
 *
 * ⚠ Différence avec `_reglprov-pv-grep.ts`, qui ne le couvre PAS: celui-là balaye le
 * corpus PV de la MUNI, déjà acquis sur disque. Ici la source est un TIERS (la MRC),
 * en ligne, jamais acquis — et un seul balayage sert TOUTES les munis de la MRC.
 *
 * ⚠ Ne pas confondre avec le CENTRE DOCUMENTAIRE d'une MRC, qui ne publie que le
 * régional + les TNO ([[mrc-centre-documentaire-vs-portail-regroupement]]). Le PV du
 * conseil, lui, parle des munis membres.
 *
 * La sonde ne décide RIEN et n'écrit RIEN: elle imprime les lignes VERBATIM avec le
 * fichier et la PAGE, pour que l'opérateur applique lui-même l'owner-gate et écarte
 * les amendements ([[reglement-numero-url-trap]]).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-mrc-pv-sweep.ts --index <url-page-PV> [--index <url2> ...] \
 *       [--munis "Chazel,Roquemaure"] [--re "zonage"] [--max 60] [--ctx 1]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function args(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}
function arg(name: string, def?: string): string | undefined {
  return args(name)[0] ?? def;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

/** Toutes les URL .pdf du HTML BRUT (pas seulement les ancres), absolutisées. */
function pdfUrls(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/[^"'\s<>()]+\.pdf\b/gi)) {
    const raw = decode(m[0]);
    try {
      out.add(new URL(raw, base).href);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

async function download(url: string, dir: string): Promise<string | null> {
  const name = url.split("/").pop()!.replace(/[^\w.-]/g, "_");
  const path = join(dir, name);
  if (existsSync(path)) return path;
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    writeFileSync(path, buf);
    return path;
  } catch {
    return null;
  }
}

/** Texte natif page par page (pdftotext -layout). Vide => scan sans couche texte. */
function pagesOf(path: string): string[] {
  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return txt.split("\f");
}

async function main(): Promise<void> {
  const indexes = args("index");
  if (!indexes.length) {
    console.error(
      'usage: --index <url> [--index <url2>...] [--munis "A,B"] [--re "zonage"] [--max 60] [--ctx 1]',
    );
    process.exit(2);
  }
  const munis = (arg("munis") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const re = new RegExp(arg("re") ?? "zonage", "i");
  const max = Number(arg("max") ?? "60");
  const ctx = Number(arg("ctx") ?? "1");

  // 1) énumérer les PDF de tous les index
  const urls = new Set<string>();
  for (const idx of indexes) {
    try {
      const html = await fetchText(idx);
      const found = pdfUrls(html, idx);
      console.log(`# index ${idx} -> ${found.length} PDF`);
      for (const u of found) urls.add(u);
    } catch (e) {
      console.log(`# index ${idx} -> ERREUR ${(e as Error).message}`);
    }
  }
  const list = [...urls].slice(0, max);
  console.log(`# ${urls.size} PDF distincts, ${list.length} balayés (--max ${max})\n`);

  const dir = join(tmpdir(), "reglprov-mrc-pv");
  mkdirSync(dir, { recursive: true });

  let scanned = 0;
  let noText = 0;
  let hits = 0;
  for (const url of list) {
    const path = await download(url, dir);
    if (!path) {
      console.log(`## ${url}  -> NON TÉLÉCHARGEABLE (ou pas un PDF)`);
      continue;
    }
    const pages = pagesOf(path);
    const chars = pages.join("").trim().length;
    if (!chars) {
      // [[plein-texte-aveugle-sur-scan-find0]]: 0 hit sur un scan n'est PAS une absence.
      console.log(`## ${url}  -> NO-TEXT-LAYER (scan) — grep AVEUGLE, ne pas conclure`);
      noText++;
      continue;
    }
    scanned++;
    for (let p = 0; p < pages.length; p++) {
      const lines = pages[p].split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const window = lines.slice(Math.max(0, i - ctx), i + ctx + 1).join(" ");
        if (munis.length && !munis.some((m) => new RegExp(m, "i").test(window))) continue;
        hits++;
        console.log(`\n### ${url.split("/").pop()}  p${p + 1}`);
        for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) {
          console.log(`    ${lines[k].trim()}`);
        }
      }
    }
  }
  console.log(
    `\n# SUMMARY pdf=${list.length} avecTexte=${scanned} sansTexte=${noText} lignes=${hits}`,
  );
  if (noText) console.log(`# ⚠ ${noText} scans NON lus: leur silence ne prouve RIEN`);
}

void main();
