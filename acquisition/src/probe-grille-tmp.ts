import { spawnSync } from 'node:child_process';
import { locateGrillePages } from '../../packages/qc-sources/src/sources/grille-page-locator.js';
import { isGrillePage, parseGrillePage } from '../../packages/qc-sources/src/sources/grille-specifications-parser.js';

const pdfPath = process.argv[2];
const r = spawnSync('pdftotext', ['-q', '-layout', '-enc', 'UTF-8', pdfPath, '-'], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
});
if (r.status !== 0) { console.error('pdftotext failed'); process.exit(1); }
const pages = (r.stdout ?? '').split('\f');
if (pages.length > 0 && pages[pages.length-1] === '') pages.pop();
console.error('Total pages:', pages.length);

// Check native
let nativeRows = 0, nativeGrillePages = 0;
for (const p of pages) {
  if (!isGrillePage(p).isGrille) continue;
  nativeGrillePages++;
  const res = parseGrillePage(p, { source_url: 'test', snapshot: '2026-06-23' });
  if (!res.rejected) nativeRows += res.zones.length;
}
console.error('Native grille pages:', nativeGrillePages, 'rows:', nativeRows);

// Locate grille pages
const loc = locateGrillePages(pages);
if (loc) {
  console.log(JSON.stringify({found: true, firstPage: loc.firstPage, lastPage: loc.lastPage, grillePageCount: loc.grillePageCount, layout: loc.layout, confidence: loc.confidence}));
} else {
  console.log(JSON.stringify({found: false}));
}
