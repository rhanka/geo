#!/usr/bin/env node
// Archive COPY-ONLY, non-destructive, des historiques in-worktree des lanes de rôle
// (worktrees directement sous <REPO>/.lanes/) AVANT d'abandonner la séparation physique
// des lanes (ADR-0033). Ne supprime RIEN. Idempotent.
//
// Contexte : ADR-0033 consolide les rôles (5 rôles logiques = branches `lane/<role>` + RACI),
// la séparation PHYSIQUE `.lanes/<role>` (un worktree persistant par rôle) est abandonnée.
// Les vrais transcripts (Claude/codex/agy) vivent dans des stores de session EXTERNES au
// worktree -> non menacés par un retrait de dossier. Ce script sauve seulement le petit
// résidu IN-worktree (logs h2a, état d'agent codex/agy/claude) et dresse un manifeste complet
// (branche, HEAD, dirty, contenu) de chaque worktree sous .lanes/ pour un retrait informé.
//
// Il saute délibérément les worktrees imbriqués (.h2a/tmp, .h2a/worktrees) et toute
// métadonnée .git, et n'archive que des dossiers d'état < 20 Mo.
//
//   node scripts/lanes-archive.mjs [REPO=cwd] [ARCHIVE_DIR=<repo>-lanes-archive]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.argv[2] || process.cwd();
const ARCHIVE = process.argv[3] || path.join(path.dirname(REPO), `${path.basename(REPO)}-lanes-archive`);
const LANES_DIR = path.join(REPO, '.lanes');

const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || REPO, encoding: 'utf8' });

// Worktrees dont le dossier est directement sous <REPO>/.lanes/
const porcelain = git(['worktree', 'list', '--porcelain']);
const lanes = [];
let cur = {};
for (const line of porcelain.split('\n')) {
  if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
  else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
  else if (line.startsWith('HEAD ')) cur.head = line.slice(5, 17);
  else if (line === 'detached') cur.branch = '(detached)';
  else if (line === '') { if (cur.path && path.dirname(cur.path) === LANES_DIR) lanes.push(cur); cur = {}; }
}

const dirSize = (p) => {
  let n = 0;
  try { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const fp = path.join(p, e.name);
    if (e.isDirectory()) n += dirSize(fp);
    else { try { n += fs.statSync(fp).size; } catch {} }
  } } catch {}
  return n;
};
const noGit = (s) => path.basename(s) !== '.git';

fs.mkdirSync(ARCHIVE, { recursive: true });
const manifest = [];
for (const lane of lanes) {
  const name = path.basename(lane.path);
  const rec = { name, branch: lane.branch, head: lane.head, path: lane.path, dirty: 'unknown', archived: [], top_dirs: [] };
  try { rec.dirty = git(['status', '--porcelain'], lane.path).trim().length > 0; } catch {}
  try { for (const e of fs.readdirSync(lane.path, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    if (e.isDirectory()) rec.top_dirs.push(`${e.name}/ (~${(dirSize(path.join(lane.path, e.name)) / 1e6).toFixed(1)}MB)`);
  } } catch {}
  // Logs de session h2a (saute les .git imbriqués)
  const runs = path.join(lane.path, '.h2a', 'runs');
  if (fs.existsSync(runs)) {
    fs.cpSync(runs, path.join(ARCHIVE, name, 'h2a-runs'), { recursive: true, filter: noGit });
    rec.archived.push(`.h2a/runs (~${(dirSize(runs) / 1e6).toFixed(1)}MB)`);
  }
  const h2a = path.join(lane.path, '.h2a');
  if (fs.existsSync(h2a)) {
    for (const f of fs.readdirSync(h2a)) {
      const fp = path.join(h2a, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (st.isFile() && st.size < 50 * 1024 * 1024) {
        const dest = path.join(ARCHIVE, name, 'h2a', f);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(fp, dest);
        rec.archived.push(`.h2a/${f}`);
      }
    }
  }
  // État d'agent in-worktree (codex/agy/claude/agents), < 20 Mo
  for (const d of ['.codex', '.agents', '.gemini', '.agy', '.claude']) {
    const src = path.join(lane.path, d);
    if (!fs.existsSync(src)) continue;
    const sz = dirSize(src);
    if (sz > 20 * 1024 * 1024) { rec.archived.push(`${d} SKIPPED (~${(sz / 1e6).toFixed(1)}MB > 20MB)`); continue; }
    fs.cpSync(src, path.join(ARCHIVE, name, d), { recursive: true, filter: noGit });
    rec.archived.push(`${d} (~${(sz / 1e6).toFixed(1)}MB)`);
  }
  manifest.push(rec);
}
fs.writeFileSync(path.join(ARCHIVE, 'lanes-archive-manifest.json'),
  JSON.stringify({ at: new Date().toISOString(), repo: REPO, archive: ARCHIVE, lanes: manifest }, null, 2));
console.log(`lanes sous .lanes/ : ${lanes.length} · archive -> ${ARCHIVE}`);
for (const m of manifest) console.log(`${m.name.padEnd(38)} | dirty=${m.dirty} | ${m.archived.join(', ') || '(rien in-worktree)'}`);
