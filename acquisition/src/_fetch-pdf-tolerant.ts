/**
 * Tolerant PDF fetcher — for muni hosts that emit NON-CONFORMING HTTP headers.
 *
 * WHY: several municipal servers (ville.dunham.qc.ca, lacdesplages.com, ...) send
 * headers that violate RFC 7230 ("Missing expected CR after header value"). Node's
 * default (llhttp strict) and the WebFetch infra both hard-fail on them, so the
 * PDF looks "undownloadable" even though it is published and 200-OK. Node exposes
 * `insecureHTTPParser: true` (lenient llhttp) exactly for these legacy servers.
 * This is a DOWNLOAD-PATH concession only: it never relaxes TLS verification.
 *
 * Usage:
 *   npx tsx acquisition/src/_fetch-pdf-tolerant.ts --url <url> --out <path>
 *   npx tsx acquisition/src/_fetch-pdf-tolerant.ts --url <url> --links [--filter <regex>]
 */
import { createWriteStream } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const url = arg('url');
const out = arg('out');
const linksMode = process.argv.includes('--links');
const rawMode = process.argv.includes('--raw');
if (!url || (!out && !linksMode && !rawMode && !process.argv.includes('--find'))) {
  console.log('usage: _fetch-pdf-tolerant.ts --url <url> --out <path>');
  console.log('       _fetch-pdf-tolerant.ts --url <url> --links [--filter <regex>]');
  process.exit(1);
}

const MAX_REDIRECTS = 6;

function fetchOnce(target: string, redirectsLeft: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const u = new URL(target);
    const getter = u.protocol === 'http:' ? httpGet : httpsGet;
    const req = getter(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        // Non-ASCII paths (e.g. "Grilles-des-spécifications.pdf") must be encoded.
        path: encodeURI(decodeURI(u.pathname)) + u.search,
        // The whole point: lenient header parsing for legacy muni servers.
        insecureHTTPParser: true,
        headers: {
          // --ua googlebot: SPA portals fronted by prerender.io serve the RENDERED
          // DOM to crawler UAs, which is how we read a JS-built document list
          // without a browser.
          'user-agent':
            arg('ua') === 'googlebot'
              ? 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
              : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
          accept: 'application/pdf,*/*',
        },
      },
      (res) => {
        const code = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (code >= 300 && code < 400 && loc) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error(`too many redirects at ${target}`));
            return;
          }
          const next = new URL(loc, target).toString();
          console.log(`  ${code} -> ${next}`);
          resolve(fetchOnce(next, redirectsLeft - 1));
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`HTTP ${code} for ${target}`));
          return;
        }
        console.log(`  200 content-type=${res.headers['content-type'] ?? '?'}`);
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout 60s')));
  });
}

console.log(`GET ${url}`);
let body: Buffer;
try {
  body = await fetchOnce(url, MAX_REDIRECTS);
} catch (e) {
  console.log(`FAIL: ${(e as Error).message}`);
  process.exit(2);
}

const findRe = arg('find');
if (findRe) {
  // Scan a fetched asset (e.g. an Angular main.js bundle) for endpoint strings.
  const text = body.toString('utf8');
  const re = new RegExp(findRe, 'gi');
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) seen.add(m[0]);
  for (const s of [...seen].slice(0, Number(arg('max', '60')))) console.log(`  HIT ${s}`);
  console.log(`\n# ${seen.size} distinct match(es) of /${findRe}/i in ${text.length} chars`);
  process.exit(0);
}

if (process.argv.includes('--raw')) {
  console.log(body.toString('utf8').slice(0, Number(arg('max', '6000'))));
  process.exit(0);
}

if (linksMode) {
  // Raw-HTML link harvest. NOTE: this sees only server-rendered markup; a JS-built
  // accordion yields few/no links here and that is NOT proof the doc is unpublished.
  const html = body.toString('utf8');
  const filter = arg('filter');
  const re = filter ? new RegExp(filter, 'i') : null;
  const hrefs = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      hrefs.add(new URL(m[1], url).toString());
    } catch {
      /* skip unparseable href */
    }
  }
  const all = [...hrefs];
  const shown = all.filter((h) => (re ? re.test(h) : /\.pdf(\?|$)/i.test(h)));
  for (const h of shown) console.log(`  LINK ${h}`);
  console.log(`\n# ${shown.length} matching / ${all.length} total links (html ${html.length} chars)`);
  process.exit(0);
}

await mkdir(dirname(out!), { recursive: true });
const ws = createWriteStream(out!);
ws.end(body);
await new Promise<void>((r) => ws.on('finish', () => r()));
const size = (await stat(out!)).size;
// Magic-byte check: an HTML error page saved as .pdf is the classic false success.
const head = (await readFile(out!)).subarray(0, 5).toString('latin1');
if (head !== '%PDF-') {
  await unlink(out!);
  console.log(`size=${(size / 1024).toFixed(0)}KB magic=${JSON.stringify(head)}`);
  console.log('VERDICT: NOT-A-PDF (removed) — server served HTML/error, not the document');
  process.exit(3);
}
console.log(`WROTE ${out} size=${(size / 1024).toFixed(0)}KB`);
console.log('VERDICT: PDF-OK');
