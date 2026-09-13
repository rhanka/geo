#!/usr/bin/env node
// Scan executable tracked sources, including generated-manifest builders.
// Historical reports, migration evidence and negative test fixtures stay intact.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const retiredHost = ['scw', 'cloud'].join('\\.');
const retiredPullSecret = ['geo', 'registry', 'pull'].join('-');
const retiredProvider = ['scale', 'way'].join('');
const forbidden = new RegExp(`${retiredHost}|\\b${retiredProvider}\\b|\\bSCW_[A-Z_]+\\b|${retiredPullSecret}|\\bscw\\s+[a-z][a-z0-9-]*\\b`, 'i');

export function registryViolations(path, source) {
  if (/(?:^|\/)(?:__tests__|fixtures)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(path)) return [];
  if (path === 'acquisition/config/capture-image.json') {
    const config = JSON.parse(source);
    return ['image', 'registry'].flatMap(key => forbidden.test(String(config[key] ?? '')) ? [`${path}:${key}: ${config[key]}`] : []);
  }
  if (!/\.(?:[cm]?[jt]s|svelte|html|ya?ml|sh)$|(?:^|\/)Dockerfile$|(?:^|\/)Makefile$/.test(path)) return [];
  return source.split('\n').flatMap((line, index) => {
    if (/^\s*(?:#|\/\/|\/\*|\*|<!--)/.test(line)) return [];
    return forbidden.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [];
  });
}

export function checkRegistryPolicy() {
  const files = execFileSync('git', ['ls-files', '-z', '--', '.github', 'acquisition/src', 'acquisition/scripts', 'acquisition/config/capture-image.json', 'deploy', 'packages', 'apps', 'scripts', 'docs/ops', 'Dockerfile', 'Makefile', 'docs/index.html'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  if (files.length === 0) throw new Error('No tracked sources found: run from the repository root');
  const violations = files.flatMap(path => registryViolations(path, readFileSync(path, 'utf8')));
  if (violations.length) {
    throw new Error(`Retired infrastructure references:\n${violations.join('\n')}`);
  }
  console.log(`Registry policy: ${files.length} tracked files inspected, no retired runtime reference.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) checkRegistryPolicy();
