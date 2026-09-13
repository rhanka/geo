import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryViolations } from './check-registry-policy.mjs';

test('rejects retired registry, CLI and pull credentials in executable sources', () => {
  for (const [path, source] of [
    ['deploy/job.yaml', '  image: rg.fr-par.scw.cloud/sentropic-geo/geo-capture:old'],
    ['acquisition/src/launcher.ts', 'const imagePullSecret = "geo-registry-pull";'],
    ['.github/workflows/publish.yml', '  password: ${{ secrets.SCW_SECRET_KEY }}'],
    ['scripts/run.sh', 'scw jobs definition start old'],
    ['docs/index.html', 'const url = "https://s3.fr-par.scw.cloud/bucket/tiles";'],
  ]) assert.equal(registryViolations(path, source).length, 1, path);
});

test('preserves historical comments and negative tests without allowing adjacent runtime references', () => {
  assert.deepEqual(registryViolations('acquisition/src/image.test.ts', '"rg.fr-par.scw.cloud/test"'), []);
  assert.deepEqual(registryViolations('deploy/job.yaml', '# previous image: rg.fr-par.scw.cloud/old'), []);
  assert.equal(registryViolations('deploy/job.yaml', '# retired registry\nimage: rg.fr-par.scw.cloud/old').length, 1);
});

test('accepts public GHCR images and provider-neutral optional pull secrets', () => {
  assert.deepEqual(registryViolations('deploy/job.yaml', 'image: ghcr.io/rhanka/geo-capture@sha256:' + 'a'.repeat(64)), []);
  assert.deepEqual(registryViolations('acquisition/src/launcher.ts', 'const secret = process.env.S3DAG_PULL_SECRET ?? "";'), []);
});

test('CLI scans the tracked capture image configuration and rejects a retired default', () => {
  const directory = mkdtempSync(join(tmpdir(), 'geo-registry-policy-'));
  try {
    mkdirSync(join(directory, 'acquisition/config'), { recursive: true });
    const config = join(directory, 'acquisition/config/capture-image.json');
    writeFileSync(config, JSON.stringify({ image: 'rg.fr-par.scw.cloud/geo/capture:old' }));
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    execFileSync('git', ['add', '--', 'acquisition/config/capture-image.json'], { cwd: directory });
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./check-registry-policy.mjs', import.meta.url))], { cwd: directory, encoding: 'utf8' });
    const rejected = run();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /acquisition\/config\/capture-image\.json:1:/);
    writeFileSync(config, JSON.stringify({ image: 'ghcr.io/rhanka/geo-capture@sha256:' + 'a'.repeat(64) }));
    assert.equal(run().status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
