/**
 * norms-ondisk-owner-gate — READ-ONLY, $0 (1 GET S3 par slug, ZÉRO LLM).
 *
 * POURQUOI. Le gisement « un PDF grille est déjà sur disque » est massivement
 * CONTAMINÉ : le crawler/le websearch attachent régulièrement au dossier d'un slug
 * le règlement d'une AUTRE municipalité (homonyme ou simple collision de nom de
 * fichier). Exemples mesurés sur ce shard : `sainte-francoise--les-basques` ET
 * `saint-francois-de-la-riviere-du-sud` portent tous deux le règlement #2010-116 de
 * SAINT-FRANÇOIS-XAVIER-DE-BROMPTON ; `sainte-genevieve-de-berthier` porte un
 * règlement 1200 de 1990 pages / 210 codes alors que son SIG n'a que 30 zones.
 *
 * Un overlap SIG > 0 NE SUFFIT PAS à écarter ces cas : les codes bas et génériques
 * (`H-1`, `I-3`, `C-2`) collisionnent par hasard entre deux munis quelconques. Il
 * faut donc DEUX signaux supplémentaires, tous deux gratuits :
 *   1. NOMME-T-IL SA MUNI ? le document doit contenir le toponyme du slug.
 *   2. ORDRE DE GRANDEUR : le nombre de codes du PDF doit rester compatible avec le
 *      nombre de zones du SIG (un PDF 7× plus riche que le SIG décrit une AUTRE ville).
 *
 * Verdicts : OK (nomme la muni) · SUSPECT-ANON (ne se nomme pas) ·
 *            REJECT-SCALE (codes PDF ≫ zones SIG) · REJECT-OTHER-MUNI (nomme une
 *            AUTRE muni et pas la sienne) · NO-SIG · NO-PDF.
 *
 * Usage:
 *   npx tsx acquisition/src/norms-ondisk-owner-gate.ts --slugs a,b,c
 *   npx tsx acquisition/src/norms-ondisk-owner-gate.ts --shard 0 --shards 1
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { s3Client, getBytes } from "./lib/s3.js";
import { resolveGridKey, sigZoneCodesFromGeojson, canonZone } from "./lib/zonage-norms.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const REPO = resolve(process.cwd());
const NORMS = join(REPO, "work", "zonage-norms");

/** Same PDF preference order as norms-shard-ondisk-triage (annexe-grille > grille > règlement). */
function pickPdf(dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const score = (f: string): number => {
    const l = f.toLowerCase();
    if (l.startsWith("annexe-grille")) return 100;
    if (l.includes("grille-web")) return 95;
    if (l === "grille.pdf") return 90;
    if (l.includes("grille")) return 80;
    if (l.includes("zonage") || l.includes("reglement")) return 50;
    return 10;
  };
  files.sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return statSync(join(dir, b)).size - statSync(join(dir, a)).size;
  });
  return join(dir, files[0]!);
}

function pdftotext(pdf: string): string {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
  });
  return r.stdout ?? "";
}

/** Slug → toponym regex: accent/hyphen/apostrophe-insensitive, keeps the DISTINCTIVE tokens. */
const STOP = new Set([
  "saint", "sainte", "st", "ste", "de", "des", "du", "la", "le", "les", "l", "d", "sur", "aux", "au", "et",
  // legal-status words that decorate a title block without naming a place
  "municipalite", "municipalité", "ville", "paroisse", "village", "canton", "cantons", "unies", "regionale",
]);
function distinctiveTokens(slug: string): string[] {
  const base = slug.split("--")[0]!; // drop the disambiguation suffix (…--les-etchemins)
  return base.split("-").filter((t) => t.length >= 4 && !STOP.has(t));
}
/** Every distinctive token of the slug, INCLUDING the disambiguation suffix. */
function allTokens(slug: string): string[] {
  return slug.split(/-+/).filter((t) => t.length >= 4 && !STOP.has(t));
}
/** Distinctive tokens of a free-text title block, accent-folded for comparison. */
function titleTokens(title: string): string[] {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}
function loosen(tok: string): string {
  // one regex char-class per letter family so `felicien` matches `Félicien`
  const fam: Record<string, string> = {
    a: "aàâä", c: "cç", e: "eéèêë", i: "iîï", o: "oôö", u: "uùûü", y: "yÿ",
  };
  return tok
    .split("")
    .map((ch) => (fam[ch] ? `[${fam[ch]}${fam[ch].toUpperCase()}]` : ch))
    .join("[\\s\\u2010-\\u2015'’-]*");
}

const ZONE_CODE = /\b[A-Z]{1,4}-?\d{1,3}\b/g;

async function main(): Promise<void> {
  const slugsArg = arg("slugs");
  const shard = arg("shard") !== undefined ? Number(arg("shard")) : undefined;
  const shards = Number(arg("shards", "1"));

  let slugs: string[];
  if (slugsArg) {
    slugs = slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (shard !== undefined) {
    const matrix = JSON.parse(readFileSync(join(REPO, "work/coverage/coverage-matrix.json"), "utf8"));
    const all: string[] = [];
    for (const [slug, layers] of Object.entries<any>(matrix.cities ?? {})) {
      if (layers?.zones?.status === "done" && layers?.normes?.status !== "done") all.push(slug);
    }
    all.sort((a, b) => a.localeCompare(b));
    slugs = all.filter((_, i) => i % shards === shard);
  } else {
    console.error("need --slugs or --shard");
    process.exit(1);
  }

  const s3 = s3Client();
  const buckets: Record<string, string[]> = {
    OK: [], "SUSPECT-ANON": [], "REJECT-SCALE": [], "REJECT-OTHER-MUNI": [], "NO-SIG": [], "NO-PDF": [],
  };

  for (const slug of slugs) {
    const dir = join(NORMS, slug);
    const pdf = existsSync(dir) ? pickPdf(dir) : null;
    if (!pdf) {
      console.log(`${slug}\tNO-PDF`);
      buckets["NO-PDF"]!.push(slug);
      continue;
    }
    let sig = new Set<string>();
    try {
      const key = await resolveGridKey(s3, slug);
      if (key) sig = sigZoneCodesFromGeojson((await getBytes(s3, key)).toString("utf8"));
    } catch {
      /* leave empty */
    }
    const text = pdftotext(pdf);
    const codes = new Set<string>();
    for (const m of text.matchAll(ZONE_CODE)) codes.add(canonZone(m[0]));
    const overlap = [...codes].filter((c) => sig.has(c)).length;

    // 1. does the document name ITS OWN muni? A single token is NOT enough: `francois`
    //    matches "SAINT-FRANÇOIS-XAVIER-DE-BROMPTON" and `leonard` matches
    //    "SAINT-LÉONARD-DE-PORTNEUF". Require EVERY distinctive token of the slug.
    const toks = distinctiveTokens(slug);
    const named = toks.length > 0 && toks.every((t) => new RegExp(loosen(t), "i").test(text));

    // 2. the title block is the document's SELF-DECLARATION of ownership. If it names a
    //    muni that does not carry every distinctive token of the slug, the document
    //    belongs to ANOTHER municipality — whatever the SIG overlap says.
    const head = text.slice(0, 3000);
    const otherM = head.match(/(?:MUNICIPALIT[ÉE]|VILLE)\s+DE\s+([A-ZÉÈÀÂÎÔÛÇ‐-―'’\- ]{4,60})/i);
    const other = otherM?.[1]?.replace(/\s+/g, " ").trim();
    const titleMatches =
      other !== undefined && toks.length > 0 && toks.every((t) => new RegExp(loosen(t), "i").test(other));
    // 3. FOREIGN TOKEN: a title block carrying a place-token the slug does not have at all
    //    names a DIFFERENT muni — this is what separates `saint-damase--les-maskoutains`
    //    from the "SAINT-DAMASE-DE-L'ISLET" by-law that was filed under it.
    const mine = new Set(allTokens(slug).map((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "")));
    const foreign =
      other === undefined ? [] : titleTokens(other).filter((t) => !mine.has(t));

    const base = `${slug}\tsig=${sig.size} pdfCodes=${codes.size} overlap=${overlap} named=${named}` +
      `${other ? ` titleMuni="${other}"` : ""}${foreign.length ? ` foreign=[${foreign.join(",")}]` : ""}` +
      `\t${pdf.replace(REPO + "/", "")}`;

    let verdict: string;
    if (other !== undefined && (!titleMatches || foreign.length > 0)) verdict = "REJECT-OTHER-MUNI";
    else if (sig.size === 0) verdict = "NO-SIG";
    else if (!named && codes.size > Math.max(30, sig.size * 4)) verdict = "REJECT-SCALE";
    else if (!named) verdict = "SUSPECT-ANON";
    else verdict = "OK";
    buckets[verdict]!.push(slug);
    console.log(`${verdict}\t${base}`);
  }

  console.log(`\n=== OWNER GATE (n=${slugs.length}) ===`);
  for (const k of ["OK", "SUSPECT-ANON", "REJECT-SCALE", "REJECT-OTHER-MUNI", "NO-SIG", "NO-PDF"]) {
    console.log(`${k} (${buckets[k]!.length}): ${buckets[k]!.join(", ")}`);
  }
}

void main();
