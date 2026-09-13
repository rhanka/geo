import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('CI credential bootstrap refuses a different cluster before minting or publishing credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-bootstrap-target-'));
  try {
    writeFileSync(join(dir, 'kubectl'), `#!/bin/sh
case "$*" in
  *'get serviceaccount'*) exit 0 ;;
  *'cluster.server'*) echo https://retired.invalid ;;
  *'certificate-authority-data'*) echo Zml4dHVyZQ== ;;
  *) touch "$TEST_MUTATION_MARKER"; exit 42 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\ntouch "$TEST_MUTATION_MARKER"\nexit 42\n', { mode: 0o755 });
    const marker = join(dir, 'mutation');
    const result = spawnSync('bash', [fileURLToPath(new URL('../docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh', import.meta.url))], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_MUTATION_MARKER: marker } });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /aucun token généré/);
    assert.equal(existsSync(marker), false, 'must not create tokens or call GitHub');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
