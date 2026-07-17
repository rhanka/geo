// _normes-weblex-lane — DÉCOUVERTE $0 des règlements/grilles via (1) le
// répertoire MAMH déjà dans le repo et (2) l'API cachée du CMS WebLex.
//
// DEUX PRÉMISSES RÉFUTÉES QUI BLOQUAIENT LE SHARD (mesuré, 5 passes) :
//
//  1. « Les petites munis n'ont pas de site connu ⇒ le crawler (registry PV) ne
//     peut rien ⇒ cause #1 de stagnation. » FAUX : le repo embarque déjà
//     `packages/qc-sources/src/geo/qc-municipal-directory.json` (MAMH, CC-BY),
//     qui porte le `website` de 1076 munis /1106. Le site est connu ; personne
//     ne le lisait.
//
//  2. « Les listings municipaux sont JS-rendus ⇒ il faut Playwright/Chrome. »
//     FAUX pour le CMS WebLex (très répandu chez les petites munis QC) : le
//     widget `doc-list` charge sa liste depuis une API PUBLIQUE et anonyme, en
//     texte, sans JS :
//         https://apps.gestionweblex.ca/doc-list/assets/list.ashx?listid=<GUID>&culture=fr-CA
//     et chaque document se télécharge par un motif GÉNÉRIQUE (lu dans le
//     scripts.js officiel du widget, pas deviné) :
//         https://apps.gestionweblex.ca/doc-list/handlers/document.ashx?documentid=<GUID>
//     PROUVÉ sur `irlande` : HTTP 200, application/pdf, 4 989 276 o, 119 pages.
//
// Anti-invention : n'émet que des URLs présentes dans le HTML/l'API, et ne
// télécharge qu'après vérification du magic `%PDF-`. Aucun nom de fichier n'est
// extrapolé (cf. le piège des « 404 HTML de 301 ko déguisés en .pdf »).
//
// Usage:
//   npx tsx acquisition/src/_normes-weblex-lane.ts --slugs a,b,c [--download] [--every]
//   npx tsx acquisition/src/_normes-weblex-lane.ts --shard 1 --n 2 --slugs <csv>
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DOWNLOAD = process.argv.includes('--download');
const EVERY = process.argv.includes('--every');

const UA = 'Mozilla/5.0 (compatible; sentropic-geo-acquisition/1.0)';
const DIRECTORY = 'packages/qc-sources/src/geo/qc-municipal-directory.json';
const WEBLEX_LIST = 'https://apps.gestionweblex.ca/doc-list/assets/list.ashx?listid=';
const WEBLEX_DOC = 'https://apps.gestionweblex.ca/doc-list/handlers/document.ashx?documentid=';
// une grille utile porte des NORMES ; « usages » seul = matrice sans valeurs (motif lac-des-plages)
const GRILLE_HINT = /grille|annexe|sp[ée]cification|usages?\s*et\s*(des\s*)?normes|cahier/i;
const ZONAGE_HINT = /zonage/i;

async function get(url: string, timeoutMs = 25_000): Promise<{ status: number; ct: string; buf: Buffer } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct: r.headers.get('content-type') ?? '', buf };
  } catch {
    return null;
  }
}

type Doc = { id: string; name: string; type: string; size: number; group: string };

function parseDocs(js: string): Doc[] {
  const out: Doc[] = [];
  // les entrées sont poussées en JS littéral ; on lit les champs nommés, sans eval
  const re = /documents\.push\(\{([^}]*)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js))) {
    const body = m[1];
    const f = (k: string): string => {
      const mm = body.match(new RegExp(`'${k}':\\s*'((?:\\\\'|[^'])*)'`));
      return mm ? mm[1].replace(/\\'/g, "'") : '';
    };
    const sizeM = body.match(/'size':\s*(\d+)/);
    const id = f('id');
    if (id) out.push({ id, name: f('name'), type: f('type'), size: sizeM ? Number(sizeM[1]) : 0, group: f('group') });
  }
  return out;
}

function listIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /list\.ashx\?listid=([0-9a-f-]{36})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) ids.add(m[1]);
  return [...ids];
}

function innerLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.host !== new URL(base).host) continue;
      if (/reglement|règlement|urbanis|permis|document|zonage/i.test(u.pathname)) out.add(u.toString());
    } catch { /* href non parsable : ignoré */ }
  }
  return [...out];
}

const dir = JSON.parse(fs.readFileSync(DIRECTORY, 'utf8'));
const slugs = arg('slugs').split(',').map((s) => s.trim()).filter(Boolean);
if (!slugs.length) {
  console.log('usage: _normes-weblex-lane.ts --slugs a,b,c [--download] [--every]');
  process.exit(1);
}

let withSite = 0;
let weblex = 0;
let hits = 0;

for (const slug of slugs) {
  const e = dir.entries?.[slug];
  const site: string = e?.website ?? '';
  if (!site) { console.log(`${slug}\tNO-WEBSITE (absent du répertoire MAMH)`); continue; }
  withSite++;

  const home = await get(site);
  if (!home || home.status !== 200) { console.log(`${slug}\tSITE-${home?.status ?? 'ERR'}\t${site}`); continue; }
  const html = home.buf.toString('utf8');

  // 1) listid sur la home, sinon sur les pages internes règlement/urbanisme
  let ids = listIds(html);
  const pages = ids.length ? [] : innerLinks(html, site).slice(0, 8);
  for (const p of pages) {
    const r = await get(p);
    if (!r || r.status !== 200) continue;
    const found = listIds(r.buf.toString('utf8'));
    if (found.length) ids = [...new Set([...ids, ...found])];
  }

  if (!ids.length) {
    // Repli GÉNÉRIQUE (mesuré: WebLex ne couvre que ~1/12 des sites MAMH) :
    // balayer les liens PDF des pages urbanisme/règlements du site MAMH.
    const cand = innerLinks(html, site).slice(0, 10);
    const pdfs = new Map<string, string>(); // href -> ancre
    for (const p of [site, ...cand]) {
      const r = await get(p);
      if (!r || r.status !== 200) continue;
      const h = r.buf.toString('utf8');
      const re2 = /<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let mm: RegExpExecArray | null;
      while ((mm = re2.exec(h))) {
        try { pdfs.set(new URL(mm[1], p).toString(), mm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
        catch { /* href non parsable */ }
      }
    }
    const g = [...pdfs].filter(([href, text]) => GRILLE_HINT.test(text) || GRILLE_HINT.test(href));
    console.log(`${slug}\tSITE-MAMH pdf=${pdfs.size} grille/annexe=${g.length}\t${site}`);
    for (const [href, text] of g.slice(0, 12)) {
      console.log(`    🔎 ${text.slice(0, 60)}  ${href}`);
      hits++;
      if (DOWNLOAD) {
        const r = await get(href, 60_000);
        if (!r || r.status !== 200 || r.buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
          console.log(`        ✗ HTTP ${r?.status ?? 'ERR'} / pas un PDF`);
          continue;
        }
        const outDir = path.join('work/zonage-norms', slug);
        fs.mkdirSync(outDir, { recursive: true });
        const base = `mamh-${decodeURIComponent(href.split('?')[0].split('/').pop() ?? 'doc.pdf').replace(/[^\w.-]+/g, '-').toLowerCase()}`;
        const p2 = path.join(outDir, base.endsWith('.pdf') ? base : `${base}.pdf`);
        fs.writeFileSync(p2, r.buf);
        console.log(`        → ${p2} (${(r.buf.length / 1024).toFixed(0)}k)`);
      }
    }
    continue;
  }
  weblex++;

  const docs: Doc[] = [];
  for (const id of ids) {
    const r = await get(`${WEBLEX_LIST}${id}&culture=fr-CA`);
    if (r && r.status === 200) docs.push(...parseDocs(r.buf.toString('utf8')));
  }
  const picked = EVERY ? docs : docs.filter((d) => GRILLE_HINT.test(d.name) || ZONAGE_HINT.test(d.name));
  console.log(`${slug}\tWEBLEX lists=${ids.length} docs=${docs.length} retenus=${picked.length}\t${site}`);

  for (const d of picked) {
    const isGrille = GRILLE_HINT.test(d.name);
    console.log(`    ${isGrille ? '🔎' : '  '} ${d.name}  [${d.group}] ${(d.size / 1024).toFixed(0)}k  ${WEBLEX_DOC}${d.id}`);
    if (isGrille) hits++;
    if (DOWNLOAD && isGrille) {
      const r = await get(`${WEBLEX_DOC}${d.id}`, 60_000);
      if (!r || r.status !== 200) { console.log(`        ✗ HTTP ${r?.status ?? 'ERR'}`); continue; }
      if (r.buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.log(`        ✗ pas un PDF (${r.ct})`); continue; }
      const outDir = path.join('work/zonage-norms', slug);
      fs.mkdirSync(outDir, { recursive: true });
      const base = `weblex-${d.name.replace(/[^\w]+/g, '-').toLowerCase().slice(0, 60)}.pdf`;
      const p = path.join(outDir, base);
      fs.writeFileSync(p, r.buf);
      console.log(`        → ${p} (${(r.buf.length / 1024).toFixed(0)}k)`);
    }
  }
}

console.log(`\n# bilan: ${slugs.length} slugs · site MAMH=${withSite} · WebLex=${weblex} · docs grille/annexe=${hits}`);
