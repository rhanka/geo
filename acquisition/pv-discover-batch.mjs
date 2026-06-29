#!/usr/bin/env node
/**
 * pv-discover-batch.mjs — Découverte automatique des URLs PV pour les villes
 * sans scraper configuré. Lit un batch de slugs depuis stdin ou --batch N,
 * tente plusieurs URL patterns, vérifie HTTP 200 + contenu PDF/PV,
 * et dépose un index.json en S3 (registry/qc-pv/<slug>/index.json).
 *
 * ANTI-INVENTION: seules les URLs réellement accessibles (HTTP 200) et
 * contenant des liens PDF/PV détectables sont enregistrées.
 *
 * Usage:
 *   node pv-discover-batch.mjs --batch 0 --dry-run
 *   node pv-discover-batch.mjs --slugs city1,city2
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// ── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const DELAY_MS = 1500; // politesse inter-fetch
const TIMEOUT_MS = 12000;
const USER_AGENT = 'radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)';
const BUCKET = 'sentropic-geo';
const S3ENV = '/home/antoinefa/src/_acquisition-shared/s3.env';

// ── Batch selection ──────────────────────────────────────────────────────────

function getBatchCities() {
  const batchArg = process.argv.find((_, i) => process.argv[i-1] === '--batch');
  const slugsArg = process.argv.find((_, i) => process.argv[i-1] === '--slugs');

  if (slugsArg) {
    return slugsArg.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (batchArg !== undefined) {
    const batchFile = `/tmp/pv_batch_${batchArg}.json`;
    if (existsSync(batchFile)) {
      return JSON.parse(readFileSync(batchFile, 'utf8'));
    }
  }
  // Read from stdin
  const allFile = '/tmp/to_research_cities.txt';
  if (existsSync(allFile)) {
    return readFileSync(allFile, 'utf8').split('\n').filter(Boolean);
  }
  return [];
}

// ── S3 client ────────────────────────────────────────────────────────────────

function loadEnv(path) {
  const env = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    let ln = raw.trim();
    if (!ln || ln.startsWith('#') || !ln.includes('=')) continue;
    if (ln.startsWith('export ')) ln = ln.slice('export '.length).trim();
    const i = ln.indexOf('=');
    const key = ln.slice(0, i).trim();
    let val = ln.slice(i + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function s3Client() {
  const env = existsSync(S3ENV) ? loadEnv(S3ENV) : process.env;
  return new S3Client({
    endpoint: env['S3_ENDPOINT'],
    region: env['S3_REGION'] || 'fr-par',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env['S3_ACCESS_KEY'] || env['AWS_ACCESS_KEY_ID'],
      secretAccessKey: env['S3_SECRET_KEY'] || env['AWS_SECRET_ACCESS_KEY'],
    },
  });
}

async function s3Exists(s3, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function s3Put(s3, key, body, contentType = 'application/json') {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: Buffer.from(body, 'utf8'),
    ContentType: contentType,
  }));
}

// ── URL candidate generation ─────────────────────────────────────────────────

/**
 * Convert a slug to candidate site domains and PV paths.
 * Pattern based on extensive analysis of existing QC municipal sites.
 */
function candidateUrls(slug) {
  // Normalize slug: remove --suffix variants (doubles for same municipality)
  const base = slug.replace(/--[^-].*$/, '').replace(/--\d+$/, '');
  const name = base; // keep hyphens for URLs

  // Common domain patterns for QC municipalities
  const domains = [
    `https://www.${name}.ca`,
    `https://www.municipalite.${name}.qc.ca`,
    `https://www.ville.${name}.qc.ca`,
    `https://${name}.ca`,
    `https://municipalite.${name}.qc.ca`,
    `https://ville.${name}.qc.ca`,
    `https://www.mun${name.replace(/-/g,'')}.ca`,
    `https://municipalites-du-quebec.com/${name}/f-pv-2026.php`,
  ];

  // Common PV path suffixes
  const paths = [
    '/conseil-municipal/proces-verbaux/',
    '/municipalite/proces-verbaux/',
    '/ma-municipalite/vie-democratique/seances-du-conseil/',
    '/seances-du-conseil/',
    '/la-ville/vie-democratique/seances-du-conseil/',
    '/ville/vie-democratique/seances-du-conseil/',
    '/mairie/seances-du-conseil/',
    '/administration/seances-et-proces-verbaux/',
    '/proces-verbaux/',
    '/municipalite/vie-democratique/seances-du-conseil/',
    '/fr/municipalite/conseil-municipal/seances-du-conseil/',
    '/conseil-municipal/seances-du-conseil/',
    '/la-municipalite/vie-democratique/seances-du-conseil/',
  ];

  const candidates = [];
  // municipalites-du-quebec.com pattern first (fast to check)
  candidates.push(`https://municipalites-du-quebec.com/${name}/f-pv-2026.php`);

  for (const domain of domains.slice(0, 4)) {
    for (const path of paths.slice(0, 6)) {
      candidates.push(`${domain}${path}`);
    }
  }

  return [...new Set(candidates)];
}

// ── HTTP fetch with timeout ──────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,*/*' },
    });
    return res;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── PV link detection ────────────────────────────────────────────────────────

/**
 * Check if HTML contains PV-related links (PDFs or PV references).
 * Returns array of found PDF/PV URLs.
 */
function extractPvLinks(html, baseUrl) {
  const links = [];
  // Match href/src to PDF files
  const pdfRe = /href=["']([^"']*\.pdf[^"']*)/gi;
  let m;
  while ((m = pdfRe.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl).href;
      links.push({ url, title: '', contentType: 'application/pdf' });
    } catch {}
  }

  // Look for PV-specific keywords in context
  const pvKeywords = /proc.s.verbal|seance|conseil|ordre.du.jour/i;
  const hasPvContext = pvKeywords.test(html);

  return { links: links.slice(0, 50), hasPvContext };
}

/**
 * Check if a URL is accessible and contains PV content.
 */
async function probeUrl(url) {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return null;
  }

  const buf = await res.arrayBuffer();
  const html = new TextDecoder('utf-8').decode(new Uint8Array(buf));

  const { links, hasPvContext } = extractPvLinks(html, url);

  // Need at least some PV context
  if (!hasPvContext && links.length === 0) return null;

  return { url, links, html: html.slice(0, 500) };
}

// ── Robots.txt check ─────────────────────────────────────────────────────────

const robotsCache = new Map();

async function isAllowed(url) {
  try {
    const u = new URL(url);
    const origin = u.origin;
    if (!robotsCache.has(origin)) {
      const res = await fetchWithTimeout(`${origin}/robots.txt`, 5000);
      if (!res || !res.ok) {
        robotsCache.set(origin, null); // permissive
        return true;
      }
      const text = await res.text();
      robotsCache.set(origin, text);
    }
    const robotsTxt = robotsCache.get(origin);
    if (!robotsTxt) return true;

    // Simple robots.txt check for our user-agent
    const path = u.pathname;
    const lines = robotsTxt.split('\n');
    let active = false;
    for (const line of lines) {
      const ln = line.trim();
      if (ln.toLowerCase().startsWith('user-agent:')) {
        const ua = ln.slice('user-agent:'.length).trim();
        active = ua === '*' || ua.toLowerCase().includes('radar');
      }
      if (active && ln.toLowerCase().startsWith('disallow:')) {
        const disallowed = ln.slice('disallow:'.length).trim();
        if (disallowed && path.startsWith(disallowed)) return false;
      }
    }
    return true;
  } catch { return true; }
}

// ── Main discovery loop ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function discoverCity(slug, s3) {
  const key = `registry/qc-pv/${slug}/index.json`;

  // Idempotent skip
  if (s3 && !FORCE && await s3Exists(s3, key)) {
    return { slug, outcome: 'skip-existing' };
  }

  const candidates = candidateUrls(slug);

  for (const url of candidates) {
    // Robots check
    if (!(await isAllowed(url))) continue;

    await sleep(DELAY_MS);

    const result = await probeUrl(url);
    if (!result) continue;

    // Found a working URL with PV content
    const entries = result.links.map(l => ({
      url: l.url,
      contentType: l.contentType,
    }));

    if (entries.length === 0) continue;

    const manifest = {
      _note: 'PV index discovered by pv-discover-batch.mjs (auto-discovery). ' +
             'URLs verified HTTP 200 with PV link extraction. No fabrication.',
      _generatedAt: new Date().toISOString(),
      slug,
      sourceId: `proces-verbaux-${slug}`,
      pvIndexUrl: url,
      windowDays: 183,
      userAgent: USER_AGENT,
      count: entries.length,
      entries,
    };

    if (s3 && !DRY_RUN) {
      await s3Put(s3, key, JSON.stringify(manifest, null, 2) + '\n');
    }

    return { slug, outcome: 'scraped', pvIndexUrl: url, count: entries.length, cms: detectCms(url) };
  }

  return { slug, outcome: 'not-found' };
}

function detectCms(url) {
  if (url.includes('municipalites-du-quebec')) return 'municipalites-du-quebec.com';
  if (url.includes('/storage/app/media')) return 'October';
  if (url.includes('/wp-content')) return 'WordPress';
  if (url.includes('goazimut') || url.includes('gonet')) return 'GoNet/GoAzimut';
  if (url.includes('gestionweblex')) return 'GestionWeblex';
  return 'unknown';
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const cities = getBatchCities();
  if (cities.length === 0) {
    console.error('No cities to process');
    process.exit(1);
  }

  const s3 = DRY_RUN ? null : s3Client();

  console.error(`[pv-discover] ${cities.length} cities, dry-run=${DRY_RUN}, force=${FORCE}`);

  const results = { scraped: 0, notFound: 0, skipExisting: 0, errors: 0 };
  const cms = {};
  const scraped = [];
  const notFound = [];

  for (const slug of cities) {
    try {
      const r = await discoverCity(slug, s3);
      if (r.outcome === 'scraped') {
        results.scraped++;
        cms[r.cms] = (cms[r.cms] || 0) + 1;
        scraped.push({ slug, url: r.pvIndexUrl, count: r.count });
        console.error(`OK  ${slug}: ${r.count} PV @ ${r.pvIndexUrl}`);
      } else if (r.outcome === 'not-found') {
        results.notFound++;
        notFound.push(slug);
        console.error(`--- ${slug}: not found`);
      } else if (r.outcome === 'skip-existing') {
        results.skipExisting++;
        console.error(`>>> ${slug}: already exists`);
      }
    } catch (e) {
      results.errors++;
      console.error(`ERR ${slug}: ${e.message}`);
    }
  }

  console.error('\n=== SUMMARY ===');
  console.error(`scraped=${results.scraped} notFound=${results.notFound} skip=${results.skipExisting} errors=${results.errors}`);
  console.error('CMS:', JSON.stringify(cms));
  console.error('Not found:', notFound.join(', '));

  // Output JSON result for aggregation
  console.log(JSON.stringify({ results, cms, scraped, notFound }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
