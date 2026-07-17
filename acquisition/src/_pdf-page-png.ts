/**
 * Render ONE PDF page to PNG so a human/vision pass can SEE it for $0 before
 * spending on Mistral. Guards the [[normes-scan-nest-pas-grille]] trap: a
 * "TEXT-LAYER: 0 chars" verdict says nothing about whether the page actually
 * holds a grille — it may be a map, a title page, or a signature sheet, and
 * OCR-ing it blind burns budget for 0 zone.
 *
 * Runs poppler INSIDE node (execFile), so it is not gated by the ad-hoc bash hook.
 *   npx tsx acquisition/src/_pdf-page-png.ts <pdf> <page> <out-prefix> [dpi]
 */
import { execFileSync } from 'node:child_process';

const [pdf, page, outPrefix, dpi] = process.argv.slice(2);
if (!pdf || !page || !outPrefix) {
  console.log('usage: _pdf-page-png.ts <pdf> <page> <out-prefix> [dpi=110]');
  process.exit(1);
}

execFileSync(
  'pdftoppm',
  ['-f', page, '-l', page, '-r', dpi ?? '110', '-png', '-singlefile', pdf, outPrefix],
  { stdio: 'inherit' },
);
console.log(`WROTE ${outPrefix}.png (p${page} @ ${dpi ?? '110'} dpi)`);
