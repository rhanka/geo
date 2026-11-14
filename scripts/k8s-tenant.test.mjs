import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_KEY, RefusedError, guardArgs, materializeKubeconfig, readEnvValue } from './k8s-tenant.mjs';

const SCRIPT = fileURLToPath(new URL('./k8s-tenant.mjs', import.meta.url));
const FAKE_KUBECONFIG = 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n';

test('injects geo-preprod when no namespace is given', () => {
  assert.deepEqual(guardArgs(['get', 'job']), ['get', 'job', '--namespace=geo-preprod']);
});

test('accepts geo-preprod in every flag spelling', () => {
  for (const args of [['-n', 'geo-preprod'], ['--namespace', 'geo-preprod'], ['--namespace=geo-preprod'], ['-n=geo-preprod'], ['-ngeo-preprod']]) {
    assert.deepEqual(guardArgs(['get', 'pods', ...args]), ['get', 'pods', ...args]);
  }
});

test('refuses other namespaces, all-namespaces and prod without --prod-ok', () => {
  for (const args of [
    ['get', 'pods', '-n', 'kube-system'],
    ['get', 'pods', '--namespace=default'],
    ['get', 'pods', '-A'],
    ['get', 'pods', '--all-namespaces'],
    ['get', 'pods', '-n', 'geo'],
    ['get', 'pods', '--prod-ok'],
    ['get', 'pods', '--prod-ok', '-n', 'kube-system'],
    ['get', 'pods', '-n', 'geo-preprod', '-n', 'geo', '--prod-ok'],
  ]) assert.throws(() => guardArgs(args), RefusedError, args.join(' '));
});

test('prod needs both --prod-ok and an explicit --namespace geo; --prod-ok is not passed on', () => {
  assert.deepEqual(guardArgs(['--prod-ok', '--namespace', 'geo', 'get', 'job']), ['--namespace', 'geo', 'get', 'job']);
});

test('refuses config, connection overrides and Secret contents', () => {
  for (const args of [
    ['config', 'view'],
    ['--kubeconfig', '/x', 'get', 'pods'],
    ['--context=x', 'get', 'pods'],
    ['--token', 't', 'get', 'pods'],
    ['-s', 'https://x', 'get', 'pods'],
    ['--as=system:admin', 'get', 'pods'],
    ['get', 'secret', 'geo-s3-credentials-preprod', '-o', 'yaml'],
    ['get', 'secrets', '-ojson'],
    ['get', 'secret/geo-s3-credentials-preprod', '--output=jsonpath={.data}'],
  ]) assert.throws(() => guardArgs(args), RefusedError, args.join(' '));
  assert.doesNotThrow(() => guardArgs(['get', 'secret']));
  assert.doesNotThrow(() => guardArgs(['get', 'networkpolicy', '-o', 'yaml']));
});

test('readEnvValue keeps only the requested key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'k8s-tenant-test-'));
  try {
    const file = join(dir, '.env');
    writeFileSync(file, `OTHER=secret-a\n# comment\nexport ${ENV_KEY}="YWJj"\nLAST=secret-b\n`);
    assert.equal(await readEnvValue(file), 'YWJj');
    assert.equal(await readEnvValue(file, 'MISSING'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('materializeKubeconfig writes a 0600 file and cleanup removes its dir', () => {
  const base = mkdtempSync(join(tmpdir(), 'k8s-tenant-test-'));
  try {
    const { path, cleanup } = materializeKubeconfig(Buffer.from(FAKE_KUBECONFIG).toString('base64'), base);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    cleanup();
    assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(base), []);
    assert.throws(() => materializeKubeconfig(Buffer.from('not a kubeconfig').toString('base64'), base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLI: refused invocation exits 64 without touching the env file; missing key exits 65 without printing env lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'k8s-tenant-test-'));
  try {
    const env = join(dir, '.env');
    writeFileSync(env, 'OTHER=do-not-print-me\n');
    const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, K8S_TENANT_ENV_FILE: env } });
    const refused = run(['get', 'pods', '-n', 'kube-system']);
    assert.equal(refused.status, 64);
    const missing = run(['get', 'pods']);
    assert.equal(missing.status, 65);
    assert.ok(!(missing.stdout + missing.stderr).includes('do-not-print-me'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
