#!/usr/bin/env node
// Delete only archived terminal/suspended Jobs, terminal Pods and zero-size ReplicaSets.
// Dry-run by default; every live UID/state is rechecked and DELETE uses preconditions.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [kubeconfig, archiveFile, verifiedArchiveSha256, mode] = process.argv.slice(2);
if (!kubeconfig || !archiveFile || !/^[a-f0-9]{64}$/.test(verifiedArchiveSha256 ?? '') || (mode && mode !== '--execute')) {
  throw new Error('Usage: delete-archived-k8s-history.mjs kubeconfig archived-plan.json verified-S3-sha256 [--execute]');
}
const bytes = readFileSync(archiveFile);
if (createHash('sha256').update(bytes).digest('hex') !== verifiedArchiveSha256) throw new Error('Archive receipt mismatch');
const plan = JSON.parse(bytes);
const target = JSON.parse(readFileSync(new URL('../acquisition/config/k8s-target.json', import.meta.url)));
const kubectl = (args, input) => execFileSync('kubectl', ['--kubeconfig', kubeconfig, ...args], { encoding: 'utf8', input });
const server = kubectl(['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}']);
if (server !== target.server) throw new Error('Wrong cluster');
const resources = { Job: ['batch/v1', 'jobs'], Pod: ['v1', 'pods'], ReplicaSet: ['apps/v1', 'replicasets'] };
const assertSafe = object => {
  if (!['geo', 'geo-preprod'].includes(object.metadata.namespace) || !resources[object.kind]) throw new Error('Out-of-scope resource');
  if (object.kind === 'Job' && ((object.status?.active ?? 0) > 0 || !(object.spec.suspend === true || object.status?.conditions?.some(c => ['Complete', 'Failed'].includes(c.type) && c.status === 'True')))) throw new Error('Job not inactive and terminal/suspended');
  if (object.kind === 'Pod' && !['Succeeded', 'Failed'].includes(object.status?.phase)) throw new Error('Pod not terminal');
  if (object.kind === 'ReplicaSet' && ((object.spec.replicas ?? 0) !== 0 || (object.status?.replicas ?? 0) !== 0)) throw new Error('ReplicaSet not empty');
};
if (!Array.isArray(plan.items) || !plan.items.length) throw new Error('Empty archive plan');
plan.items.forEach(assertSafe);
for (const expected of plan.items) {
  const { namespace, name, uid } = expected.metadata;
  const [version, resource] = resources[expected.kind];
  const raw = kubectl(['-n', namespace, 'get', resource, name, '--ignore-not-found', '-o', 'json']);
  if (!raw.trim()) { console.log(`Already absent: ${namespace}/${resource}/${name}`); continue; }
  const live = JSON.parse(raw);
  if (live.metadata.uid !== uid) throw new Error('Resource was replaced after archival');
  assertSafe(live);
  if (mode === '--execute') {
    const prefix = version === 'v1' ? '/api/v1' : `/apis/${version}`;
    kubectl(['delete', '--raw', `${prefix}/namespaces/${namespace}/${resource}/${name}`, '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background', preconditions: { uid, resourceVersion: live.metadata.resourceVersion } }));
  }
  console.log(`${mode === '--execute' ? 'Deleted' : 'Validated'}: ${namespace}/${resource}/${name}`);
}
