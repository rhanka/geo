// _normes-wayback-cdx-lane — DÉCOUVERTE $0 par l'INDEX CDX d'Internet Archive.
//
// POURQUOI (mesuré sur le shard 1/2, 5 passes de stagnation) :
//   Les 3 murs répétés de la découverte sont :
//     (a) « listing JS-rendu, Playwright indisponible » — WebFetch ne voit que le menu ;
//     (b) « le crawler ne connaît que la registry PV » — les petites munis sont absentes ;
//     (c) « l'URL indexée par le websearch rend 404 » — le doc a bougé.
//   L'index CDX de Wayback les traverse tous les trois : il énumère TOUTES les URLs
//   jamais archivées d'un domaine, en TEXTE, sans JS, sans crawl, à $0 :
//       http://web.archive.org/cdx/search/cdx?url=<domaine>*&fl=original,timestamp,statuscode
//   Le domaine vient du répertoire MAMH déjà embarqué (1076 sites /1106) — donc (b)
//   tombe aussi : le site est TOUJOURS connu, il n'a jamais fallu le crawler.
//
// PROUVÉ sur `macamic` : site vivant SANS aucun lien vers son zonage (probe des
//   pages Urbanisme + Règlements = 0 PDF de zonage) et URL websearch en 404 ⇒
//   verdict « épuisé » sur 5 passes. Le CDX rend
//   `…/documents/articles/grilles-des-specifications_revisee---annotee-2022-.pdf`,
//   que le site LIVE sert en HTTP 200 (4,4 Mo, 121 pages = 121 zones SIG) :
//   « GRILLE DES SPÉCIFICATIONS », normes verbatim. Le doc était en ligne, juste
//   plus lié nulle part.
//
// ANTI-INVENTION (le piège des « 404 HTML de 301 ko déguisés en .pdf ») : aucune URL
//   n'est extrapolée. On n'émet que des URLs RÉELLEMENT présentes dans l'index, et
//   `--verify` re-teste chacune en LIVE d'abord (le live prime sur l'archive : c'est
//   la source officielle), puis en archive `id_` seulement si le live est mort.
//   Rien n'est retenu sans magic `%PDF-`.
//
// Usage:
//   npx tsx acquisition/src/_normes-wayback-cdx-lane.ts --slugs a,b,c [--verify] [--download]
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const VERIFY = process.argv.includes('--verify');
const DOWNLOAD = process.argv.includes('--download');

const UA = 'Mozilla/5.0 (compatible; sentropic-geo-acquisition/1.0)';
const DIRECTORY = 'packages/qc-sources/src/geo/qc-municipal-directory.json';
const CDX = 'http://web.archive.org/cdx/search/cdx';
// « grille/spécifications/annexe » = la grille ; « zonage » seul = souvent le corps.
const GRILLE_HINT = /grille|sp[eé]cification|usages?[-_%20 ]*et[-_%20 ]*(des[-_%20 ]*)?normes|annexe/i;
const ZONAGE_HINT = /zonage/i;

async function get(url: string, timeoutMs = 45_000): Promise<{ status: number; ct: string; buf: Buffer } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    return { status: r.status, ct: r.headers.get('content-type') ?? '', buf: Buffer.from(await r.arrayBuffer()) };
  } catch {
    return null;
  }
}

// certaines URLs archivées portent des %XX invalides (accents mal encodés) :
// decodeURIComponent y jette URIError et tuerait tout le balayage.
function safeDecode(u: string): string {
  try { return decodeURIComponent(u); } catch { return u; }
}

const dir = JSON.parse(fs.readFileSync(DIRECTORY, 'utf8'));
const slugs = arg('slugs').split(',').map((s) => s.trim()).filter(Boolean);
if (!slugs.length) {
  console.log('usage: _normes-wayback-cdx-lane.ts --slugs a,b,c [--verify] [--download]');
  process.exit(1);
}

let totalHits = 0;
for (const slug of slugs) {
  const site: string = dir.entries?.[slug]?.website ?? '';
  if (!site) { console.log(`${slug}\tNO-WEBSITE (absent MAMH)`); continue; }
  // ⚠️ PIÈGE `corpus-slug-owner-mismatch` : plusieurs munis ont pour site MAMH un
  // AGRÉGATEUR multi-munis (`municipalites-du-quebec.ca/<slug>`). Interroger le
  // seul HÔTE y rendrait les documents de TOUTES les munis hébergées — on
  // attribuerait la grille de martinville à sainte-genevieve-de-berthier, avec
  // des données justes sous une provenance fausse (aucun gate ne le voit).
  // On conserve donc le CHEMIN quand il y en a un : le préfixe CDX reste borné
  // à la muni.
  let scope: string;
  try {
    const u = new URL(site);
    const p = u.pathname.replace(/\/+$/, '');
    scope = u.host.replace(/^www\./, '') + p;
  } catch { console.log(`${slug}\tBAD-URL ${site}`); continue; }
  const host = scope;

  const q = `${CDX}?url=${encodeURIComponent(scope)}*&output=text&fl=original,timestamp,statuscode&collapse=urlkey&filter=statuscode:200&limit=3000`;
  const r = await get(q, 60_000);
  if (!r || r.status !== 200) { console.log(`${slug}\tCDX-${r?.status ?? 'ERR'}\t${host}`); continue; }

  const rows = r.buf.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const c = l.split(/\s+/); return { url: c[0], ts: c[1] }; })
    .filter((x) => /\.pdf$/i.test(x.url));

  const grille = rows.filter((x) => GRILLE_HINT.test(safeDecode(x.url)));
  const zonage = rows.filter((x) => !GRILLE_HINT.test(safeDecode(x.url)) && ZONAGE_HINT.test(safeDecode(x.url)));
  console.log(`${slug}\tCDX pdf=${rows.length} grille/annexe=${grille.length} zonage=${zonage.length}\t${host}`);

  for (const x of [...grille, ...zonage].slice(0, 12)) {
    const tag = GRILLE_HINT.test(safeDecode(x.url)) ? '🔎' : '  ';
    console.log(`    ${tag} ${x.url}`);
    if (!VERIFY && !DOWNLOAD) continue;

    // LIVE d'abord : la source officielle prime sur l'archive.
    let got = await get(x.url);
    let via = 'LIVE';
    if (!got || got.status !== 200 || got.buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      const wb = `http://web.archive.org/web/${x.ts}id_/${x.url}`;
      got = await get(wb, 90_000);
      via = 'WAYBACK';
    }
    const ok = got && got.status === 200 && got.buf.subarray(0, 5).toString('latin1') === '%PDF-';
    console.log(`        ${ok ? '✓' : '✗'} ${via} HTTP ${got?.status ?? 'ERR'} ${(Number(got?.buf.length ?? 0) / 1024).toFixed(0)}k${ok ? '' : ' (pas un PDF)'}`);
    if (!ok || !DOWNLOAD || !got) continue;
    totalHits++;
    const outDir = path.join('work/zonage-norms', slug);
    fs.mkdirSync(outDir, { recursive: true });
    const base = `cdx-${safeDecode(x.url.split('/').pop() ?? 'doc.pdf').replace(/[^\w.-]+/g, '-').toLowerCase()}`;
    const p = path.join(outDir, base.endsWith('.pdf') ? base : `${base}.pdf`);
    fs.writeFileSync(p, got.buf);
    console.log(`        → ${p}`);
  }
}
console.log(`\n# bilan: ${slugs.length} slugs · PDF grille récupérés=${totalHits}`);
