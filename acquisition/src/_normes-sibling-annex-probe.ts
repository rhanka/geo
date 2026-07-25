// _normes-sibling-annex-probe — DÉCOUVERTE $0 de l'annexe-grille « PDF frère ».
//
// Leçon mesurée (memoire normes-grille-pdf-frere): le corps du règlement de
// zonage téléchargé sous work/zonage-norms/<slug>/grille.pdf ne contient AUCUNE
// grille (uniquement des renvois en prose « prévue à la grille des usages… »).
// La grille est un PDF DISTINCT publié sur LA MÊME page portail (annexe / cahier
// des grilles / annexe A|B|2).
//
// Ce probe, à $0 :
//   1) part d'une page portail (--page) OU du répertoire parent de --from-url,
//   2) extrait tous les liens .pdf de la page,
//   3) filtre/priorise ceux dont l'ancre ou l'URL évoque une grille/annexe,
//   4) confirme HTTP 200 + magic %PDF- et (option --out) télécharge.
//
// Anti-invention: n'imprime que des URLs réellement présentes dans le HTML.
//
// Usage:
//   npx tsx acquisition/src/_normes-sibling-annex-probe.ts --page <url> [--out work/zonage-norms/<slug>] [--all]
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const pageUrl = arg('page');
const outDir = arg('out');
// NB: `--all` seul est intercepté par npx ; on utilise `--every`.
const all = process.argv.includes('--every');
if (!pageUrl) {
  console.log('usage: _normes-sibling-annex-probe.ts --page <url> [--out dir] [--every]');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (compatible; sentropic-geo-acquisition/1.0)';
const GRILLE_HINT = /grille|annexe|usages?[-_ ]et[-_ ]normes|specification|spécification|cahier|zonage/i;

async function get(url: string): Promise<{ status: number; ct: string; buf: Buffer } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30_000);
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct: r.headers.get('content-type') ?? '', buf };
  } catch (e: any) {
    console.log(`ERR  ${url} (${String(e?.message ?? e).slice(0, 70)})`);
    return null;
  }
}

const res = await get(pageUrl);
if (!res || res.status !== 200) {
  console.log(`PAGE ${res?.status ?? 'ERR'} ${pageUrl}`);
  process.exit(0);
}
const html = res.buf.toString('utf8');
console.log(`PAGE 200 ${pageUrl} (${(res.buf.length / 1024).toFixed(0)}k)`);

// liens <a href="...pdf"> avec leur texte d'ancre
const links: Array<{ href: string; text: string }> = [];
const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
let m: RegExpExecArray | null;
while ((m = re.exec(html))) {
  const href = m[1];
  const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\.pdf(\?|#|$)/i.test(href) || /\/document|\/telecharger|\/download/i.test(href)) {
    links.push({ href: new URL(href, pageUrl).toString(), text });
  }
}
const seen = new Set<string>();
const uniq = links.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)));
const picked = all ? uniq : uniq.filter((l) => GRILLE_HINT.test(l.text) || GRILLE_HINT.test(l.href));
console.log(`LINKS pdf=${uniq.length} retenus=${picked.length}${all ? ' (--all)' : ' (filtre grille/annexe)'}`);

for (const l of picked.slice(0, 40)) {
  const r = await get(l.href);
  if (!r) continue;
  const isPdf = r.buf.subarray(0, 5).toString('latin1') === '%PDF-';
  const kb = (r.buf.length / 1024).toFixed(0);
  console.log(`${r.status}\t${isPdf ? 'PDF' : (r.ct.split(';')[0] || '?')}\t${kb}k\t${l.text.slice(0, 60)}\t${l.href}`);
  if (isPdf && outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const base = decodeURIComponent(l.href.split('?')[0].split('/').pop() ?? 'doc.pdf').replace(/[^\w.-]+/g, '-');
    const p = path.join(outDir, base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`);
    fs.writeFileSync(p, r.buf);
    console.log(`        → ${p}`);
  }
}
