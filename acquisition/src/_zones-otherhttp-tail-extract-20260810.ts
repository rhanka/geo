// Diagnostic sonde (read-only): extract the "other-http" / small-host tail of the
// v2-upgrade upgradable_list — every upgradable muni whose host is NOT one of the
// four DONE platform veins nor goAzimut (dead). Also locates cohort + deposit-recipe
// files so the deposit run can replicate the proven recipe.
// Run: npx tsx acquisition/src/_zones-otherhttp-tail-extract-20260810.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const scoping = JSON.parse(
  readFileSync(join(ROOT, 'work/coverage/zones-v2-upgrade-scoping-20260810.json'), 'utf8'),
);

const DONE_HOSTS = new Set([
  'geoserver.geocentralis.com',
  'gis.altusquebec.com',
  'geo.victoriaville.ca',
  'services.arcgis.com',
  'services6.arcgis.com',
  'services8.arcgis.com',
  'services9.arcgis.com',
]);
const DEAD_HOSTS = new Set(['www.goazimut.com']);

const list: any[] = scoping.upgradable_list ?? [];
const tail = list.filter(
  (e) => !DONE_HOSTS.has(e.url_host) && !DEAD_HOSTS.has(e.url_host),
);

// group by host
const byHost: Record<string, any[]> = {};
for (const e of tail) (byHost[e.url_host] ??= []).push(e);

console.log('=== SMALL-HOST / OTHER-HTTP TAIL (non-done-vein, non-goazimut) ===');
console.log('tail_total=', tail.length);
for (const host of Object.keys(byHost).sort()) {
  console.log(`\n--- HOST ${host} (${byHost[host].length}) ---`);
  for (const e of byHost[host]) {
    console.log(
      JSON.stringify({
        slug: e.slug,
        level: e.level,
        endpoint_class: e.endpoint_class,
        in_campaign_set: e.in_campaign_set,
        url: e.zone_source_url,
      }),
    );
  }
}

// locate cohort + recipe + record files
const cov = join(ROOT, 'work/coverage');
const covFiles = existsSync(cov) ? readdirSync(cov) : [];
console.log('\n=== work/coverage matches (cohort/refold/167/vnatif-deposit-record/otherhttp) ===');
for (const f of covFiles.sort())
  if (/refold|cohort|167|vnatif-deposit-record|otherhttp/i.test(f)) console.log(' ', f);

const acq = join(ROOT, 'acquisition/src');
const acqFiles = existsSync(acq) ? readdirSync(acq) : [];
console.log('\n=== acquisition/src deposit-recipe scripts (_zones-vnatif-deposit*) ===');
for (const f of acqFiles.sort())
  if (/_zones-vnatif-deposit/i.test(f)) console.log(' ', f);
console.log('\n=== acquisition/src other candidate recipe scripts (replace / restamp / capture) ===');
for (const f of acqFiles.sort())
  if (/zones-.*(replace|restamp|capture)/i.test(f)) console.log(' ', f);
