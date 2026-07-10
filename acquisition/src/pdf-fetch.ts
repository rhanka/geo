/**
 * pdf-fetch.ts — deterministic, idempotent PDF downloader for the recalage lanes.
 *
 * T1 (t1-build --pdf <url>) downloads internally, but T2 (t2-autogcp --auto-seed)
 * and multi-sheet require a LOCAL cached path. This writes a URL to a stable file
 * under work/pdf-cache/<slug>[-<tag>].pdf so the same slug re-fetches to the same
 * path (rejouable). Node/TS only, uses global fetch (no shell curl).
 *
 *   npx tsx acquisition/src/pdf-fetch.ts --url <url> --slug <slug> [--tag <t>] [--force]
 *   npx tsx acquisition/src/pdf-fetch.ts --url <url> --out work/pdf-cache/foo.pdf
 *
 * Prints the local path on the last stdout line (PDF=<path>). Exits 2 if the
 * fetched bytes are not a PDF (magic %PDF), so a bad/HTML response never poses as
 * a plan.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = arg('url');
  const slug = arg('slug');
  const tag = arg('tag');
  const force = process.argv.includes('--force');
  if (!url) throw new Error('required: --url <url>');
  const out = arg('out') ?? `work/pdf-cache/${slug}${tag ? `-${tag}` : ''}.pdf`;
  if (!slug && !arg('out')) throw new Error('required: --slug <slug> or --out <path>');
  const outPath = resolve(process.cwd(), out);

  if (existsSync(outPath) && !force) {
    const sz = statSync(outPath).size;
    console.error(`[pdf-fetch] cached (${sz} bytes): ${outPath}`);
    console.log(`PDF=${outPath}`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  console.error(`[pdf-fetch] GET ${url}`);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Accept: 'application/pdf,*/*',
    },
  });
  if (!res.ok) {
    console.error(`[pdf-fetch] HTTP ${res.status} ${res.statusText}`);
    process.exit(2);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 5).toString('latin1');
  if (!head.startsWith('%PDF')) {
    console.error(`[pdf-fetch] NOT a PDF (magic="${head.replace(/[^\x20-\x7e]/g, '.')}", ${buf.length} bytes, ct=${res.headers.get('content-type')})`);
    process.exit(2);
  }
  writeFileSync(outPath, buf);
  console.error(`[pdf-fetch] wrote ${buf.length} bytes → ${outPath}`);
  console.log(`PDF=${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
