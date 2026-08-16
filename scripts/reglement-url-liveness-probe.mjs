#!/usr/bin/env node
// SONDE DE LIVENESS des reglement_url — DOIT TOURNER SUR LE CLUSTER (egress propre).
// ⚠ JAMAIS en local : l'egress local est bloqué/faussé (403 UA, undici opaque, hôtes
// bloqués — cf. mémoire) → un run local donnerait des faux « morts ». À déployer via
// le pattern deploy/capture-job (Job k8s, --kubeconfig /tmp/ovh.kubeconfig), collecte
// la sortie sur S3 ou via le log du Job.
//
// Lit les reglement_url http de acquisition/config/reglement-provenance.json, fait un
// HEAD (repli GET Range 0-0) avec UA navigateur + suivi de redirections + timeout, et
// émet work/coverage/reglement-liveness-<date>.json { url: {alive:bool, status:int|null,
// final_url, error} }. Ce fichier alimente ensuite
// `reglement-revalidation.mjs --liveness=<file>` (url morte → verdict 'a-capturer').
//
// ANTI-INVENTION : alive/status RÉELS de la requête ; une url non sondée reste ABSENTE
// du fichier (le revalidateur la laisse 'non-testee') ; JAMAIS de mort/vivant deviné.
//
// Usage (sur cluster) : node scripts/reglement-url-liveness-probe.mjs [--concurrency=10] [--timeout-ms=15000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const opt = (n, d) => { const p = `--${n}=`; const v = ARGV.find((a) => a.startsWith(p)); return v ? v.slice(p.length) : d; };
const CONCURRENCY = Number(opt('concurrency', '10'));
const TIMEOUT_MS = Number(opt('timeout-ms', '15000'));
const AS_OF = '2026-08-10';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'acquisition/config/reglement-provenance.json'), 'utf8'));
const slugs = src.slugs && typeof src.slugs === 'object' ? src.slugs : {};
const urls = [...new Set(Object.values(slugs).map((e) => e?.reglement_url).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))];

async function probe(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const common = { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: '*/*' } };
  try {
    let r;
    try { r = await fetch(url, { method: 'HEAD', ...common }); }
    catch { r = null; }
    // Certains serveurs refusent HEAD → repli GET (Range pour limiter les octets).
    if (!r || r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: 'GET', ...common, headers: { ...common.headers, range: 'bytes=0-0' } });
    }
    clearTimeout(t);
    const status = r.status;
    const alive = status >= 200 && status < 400;
    return { alive, status, final_url: r.url !== url ? r.url : undefined, error: undefined };
  } catch (e) {
    clearTimeout(t);
    return { alive: false, status: null, error: String(e?.name || e).slice(0, 80) };
  }
}

async function run() {
  const out = {};
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      out[url] = await probe(url);
      if ((idx + 1) % 25 === 0) console.error(`… ${idx + 1}/${urls.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  const alive = Object.values(out).filter((v) => v.alive).length;
  const report = {
    contract: 'reglement-url-liveness/v1', as_of: AS_OF,
    ran_on: 'cluster-required (egress local bloqué)',
    total: urls.length, alive, dead: urls.length - alive,
    urls: out,
  };
  const rel = `work/coverage/reglement-liveness-${AS_OF.replaceAll('-', '')}.json`;
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(report, null, 2) + '\n');
  console.error(`écrit: ${rel} — ${alive}/${urls.length} vivantes`);
}
run();
