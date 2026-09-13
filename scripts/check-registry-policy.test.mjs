import test from 'node:test';
import assert from 'node:assert/strict';
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
