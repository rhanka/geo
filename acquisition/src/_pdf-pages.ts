// Helper: pdfinfo summary (pages, size per page) without shell pdfinfo.
// Usage: npx tsx acquisition/src/_pdf-pages.ts <pdf> [<pdf> ...]
import { execFileSync } from 'node:child_process';

for (const pdf of process.argv.slice(2)) {
  try {
    const out = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    const pages = (out.match(/Pages:\s*(\d+)/) ?? [])[1];
    const size = (out.match(/Page size:\s*([^\n]+)/) ?? [])[1];
    const rot = (out.match(/Page rot:\s*(\d+)/) ?? [])[1];
    console.log(`${pdf}\n   pages=${pages} size=${size} rot=${rot ?? 0}`);
  } catch (e) {
    console.log(`${pdf}\n   ERREUR: ${(e as Error).message.slice(0, 120)}`);
  }
}
