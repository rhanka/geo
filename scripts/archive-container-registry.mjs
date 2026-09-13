#!/usr/bin/env node
// Preserve registry build artifacts as a private OCI layout before retirement.
// Reads source digests only; never runs images, publishes them or deletes sources.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [manifestPath, authPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !authPath || !outputPath) throw new Error('Usage: archive-container-registry.mjs manifest.json auth.json output-directory');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!/^[a-z0-9.-]+\/[a-z0-9/_-]+$/.test(manifest.registry)) throw new Error('Invalid source registry');
if (!Array.isArray(manifest.images) || !manifest.images.length) throw new Error('Empty image inventory');
const tasks = manifest.images.flatMap(image => {
  if (!/^[a-z0-9._-]+$/.test(image.name) || !Array.isArray(image.tags) || !image.tags.length) throw new Error('Invalid image inventory');
  return image.tags.map(tag => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(tag.name) || !/^sha256:[a-f0-9]{64}$/.test(tag.digest)) throw new Error('Invalid tag/digest');
    return { source: `${manifest.registry}/${image.name}@${tag.digest}`, reference: `${image.name}:${tag.name}`, digest: tag.digest };
  });
});
const output = resolve(outputPath);
mkdirSync(output, { recursive: true, mode: 0o700 });
const toolImage = 'quay.io/skopeo/stable@sha256:a585e4a3b8a045baa87c7f1b2f940d6d299ebede85ab3f2419d52d2264eefc93';
for (const [index, task] of tasks.entries()) {
  console.log(`Archiving ${index + 1}/${tasks.length}: ${task.reference} (${task.digest})`);
  execFileSync('docker', ['run', '--rm', '--network', 'host',
    '--mount', `type=bind,src=${resolve(authPath)},dst=/auth.json,readonly`,
    '--mount', `type=bind,src=${output},dst=/archive`,
    toolImage, 'copy', '--all', '--preserve-digests', '--retry-times', '2', '--src-authfile', '/auth.json',
    `docker://${task.source}`, `oci:/archive/layout:${task.reference}`], { stdio: 'inherit' });
}
writeFileSync(`${output}/source-inventory.json`, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(`${output}/receipt.json`, JSON.stringify({ at: new Date().toISOString(), toolImage, references: tasks.length, status: 'copied-preserving-digests' }, null, 2) + '\n');
console.log(`OCI archive ready: ${output}; upload and verify before any source retirement.`);
