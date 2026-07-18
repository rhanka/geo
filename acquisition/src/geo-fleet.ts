#!/usr/bin/env -S npx tsx
/**
 * geo-fleet.ts — TypeScript pilot for the geo acquisition fleet.
 *
 * Replaces the hand-edited bash FLEET array: the fleet is DATA (acquisition/config/fleet.json),
 * the policy (liveness / relaunch / reconcile / logging) is here in TS, and the only shell it
 * touches is `scripts/geo-worker.sh` as a thin tmux "device driver" (set-buffer/paste-buffer).
 *
 * Every tick appends one row to work/coverage/fleet-timeline.jsonl so the whole run can be
 * consolidated over time (5 key numbers + Δ vs previous tick + which agents were relaunched).
 *
 *   npx tsx acquisition/src/geo-fleet.ts tick                 # one supervision tick (default)
 *   npx tsx acquisition/src/geo-fleet.ts tick --lane geo-nm=10 --lane geo-pv=1   # resize on the fly
 *   npx tsx acquisition/src/geo-fleet.ts status               # fleet + last timeline rows, no launches
 *   npx tsx acquisition/src/geo-fleet.ts timeline [N]         # last N timeline rows with Δ
 *   npx tsx acquisition/src/geo-fleet.ts up | down            # launch all / stop all, no reconcile
 *
 * Idempotent: a live agent (CLI shows "esc to interrupt") is left alone; anything else
 * (no session, idle at the ❯ prompt, spend-limit banner, finished+context-full) is relaunched.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER = resolve(REPO, 'scripts', 'geo-worker.sh');
const CONFIG = resolve(REPO, 'acquisition', 'config', 'fleet.json');

type Lane = { name: string; engine?: string; prompt: string; shards: number; note?: string };
type Singleton = { name: string; engine?: string; prompt: string; model?: string };
type Backfill = { session: string; match: string; cmd: string[] };
type Config = {
  engine: string;
  /** Engine used to retry a lane whose primary engine hit a spend/usage limit. */
  engineFallback?: string;
  lanes: Lane[];
  singletons: Singleton[];
  backfill?: Backfill;
  h2aLoop?: string;
  timeline: string;
};
type Agent = { name: string; engine?: string; prompt: string; shard?: string; model?: string };
type Scoreboard = { pv?: number; normes?: number; zones?: number; cadastre?: number; role?: number; tod?: number; immo?: number };

const iso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** Run a command, never throw — return stdout (trimmed) or '' on any failure. */
function sh(cmd: string, args: string[], timeoutMs = 240_000): string {
  try {
    return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e: any) {
    return (e?.stdout ? String(e.stdout) : '').trim();
  }
}
function tmuxPane(remote: string): string {
  try {
    return execFileSync('tmux', ['capture-pane', '-t', remote, '-p'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function loadConfig(overrides: Map<string, number>): Config {
  const cfg: Config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  for (const lane of cfg.lanes) {
    const o = overrides.get(lane.name);
    if (o !== undefined) lane.shards = o;
  }
  return cfg;
}

/** Expand config → concrete agents. Shards named <lane>-<k> (1-indexed), directive "i/n". */
function expand(cfg: Config): Agent[] {
  const out: Agent[] = [];
  for (const lane of cfg.lanes) {
    for (let k = 1; k <= lane.shards; k++) {
      out.push({ name: `${lane.name}-${k}`, engine: lane.engine, prompt: lane.prompt, shard: `${k - 1}/${lane.shards}` });
    }
  }
  for (const s of cfg.singletons) out.push({ name: s.name, engine: s.engine, prompt: s.prompt, model: s.model });
  return out;
}

/** ALIVE iff the h2a/claude CLI shows its "esc to interrupt" working marker in the pane. */
function isAlive(name: string): boolean {
  return tmuxPane(`remote-${name}`).includes('esc to interrupt');
}

/** The pane exists at all — distinguishes "CLI still booting" from "never launched". */
function hasPane(name: string): boolean {
  return tmuxPane(`remote-${name}`).trim().length > 0;
}

/** Spend/usage limit banners: the lane is not broken, its engine is exhausted. */
const LIMIT_MARKERS = ['spend limit', 'usage limit', 'rate limit', 'limite de dépense', 'quota'];
function isLimited(name: string): boolean {
  const pane = tmuxPane(`remote-${name}`).toLowerCase();
  return LIMIT_MARKERS.some((m) => pane.includes(m));
}

function launch(engine: string, a: Agent): boolean {
  if (!existsSync(resolve(REPO, a.prompt))) {
    console.log(`MISS  ${a.name} (prompt ${a.prompt} absent)`);
    return false;
  }
  const args = ['agent', engine, a.name, a.prompt];
  if (a.shard) args.push('--shard', a.shard);
  if (a.model) args.push('--model', a.model);
  sh('bash', [WORKER, ...args]); // sequential by necessity: tmux paste-buffer is a shared global
  return true;
}

/**
 * Launch, then PROVE the session came up.
 *
 * `launch()` only reports that the worker was invoked: for four days this pilot logged
 * "relaunched 16/16" while tmux was broken and zero agent existed. A relaunch is only
 * real once its pane answers. On a spend/usage limit we retry once on the fallback
 * engine instead of burning the slot on an exhausted account.
 */
function launchVerified(engine: string, fallback: string | undefined, a: Agent): 'up' | 'up-fallback' | 'failed' {
  if (!launch(engine, a)) return 'failed';
  // A Claude/Codex CLI takes ~20-40s to boot to its "esc to interrupt" marker; a pane
  // exists almost immediately but "alive" lags. Verify on the PANE existing + not showing a
  // usage-limit banner, with a generous window, so a slow boot isn't a false FAILED that the
  // next tick re-kills. (isAlive is the steady-state check the tick uses on subsequent passes.)
  for (let i = 0; i < 40; i++) {
    if (hasPane(a.name)) {
      if (!isLimited(a.name)) return 'up';
      break; // usage-limited: fall through to the fallback engine
    }
    sh('sleep', ['1'], 3_000);
  }
  if (fallback !== undefined && fallback !== engine) {
    console.log(`LIMIT    ${a.name} on ${engine} → retry on ${fallback}`);
    if (!launch(fallback, a)) return 'failed';
    for (let i = 0; i < 40; i++) {
      if (hasPane(a.name) && !isLimited(a.name)) return 'up-fallback';
      sh('sleep', ['1'], 3_000);
    }
  }
  return 'failed';
}

function stopAll(agents: Agent[]) {
  for (const a of agents) sh('bash', [WORKER, 'stop', a.name]);
}

/** Reconcile coverage and parse the 5+1 key numbers from the SCOREBOARD line. */
function reconcile(): { line: string; sb: Scoreboard } {
  const out = sh('npx', ['tsx', 'acquisition/src/coverage-reconcile.ts'], 300_000);
  const line = (out.split('\n').find((l) => l.includes('SCOREBOARD')) ?? '').trim();
  const n = (k: string) => {
    const m = line.match(new RegExp(`${k}=(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };
  const sb: Scoreboard = { pv: n('pv'), normes: n('normes'), zones: n('zones'), cadastre: n('cadastre'), role: n('role-foncier'), tod: n('tod') };
  sb.immo = readImmoServed();
  return { line, sb };
}

/** immo-lots served, best-effort from the produced report (not a fresh S3 scan). */
function readImmoServed(): number | undefined {
  const p = resolve(REPO, 'work/coverage/immo-lots.report.json');
  if (!existsSync(p)) return undefined;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of ['servedMunis', 'served', 'qc_lots_served', 'qc_lots', 'count', 'total']) {
      if (typeof j?.[k] === 'number') return j[k];
      if (typeof j?.summary?.[k] === 'number') return j.summary[k];
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function lastTimelineRow(path: string): any | null {
  const p = resolve(REPO, path);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}
function appendTimeline(path: string, row: any) {
  const p = resolve(REPO, path);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(row) + '\n');
}

/** Keep the deterministic immo backfill grinding (process check, not just session). */
function ensureBackfill(bf?: Backfill) {
  if (!bf) return 'no-backfill';
  let running = false;
  try {
    execFileSync('pgrep', ['-f', bf.match], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 15_000 });
    running = true;
  } catch {
    running = false;
  }
  if (running) return 'alive';
  sh('bash', [WORKER, 'stop', bf.session]);
  sh('bash', [WORKER, 'bg', bf.session, '--', ...bf.cmd]);
  return 'relaunched';
}

function fmtDelta(cur?: number, prev?: number): string {
  if (cur === undefined) return '—';
  if (prev === undefined) return String(cur);
  const d = cur - prev;
  return `${cur} (${d >= 0 ? '+' : ''}${d})`;
}

function scoreboardLine(sb: Scoreboard, prev?: Scoreboard): string {
  return (
    `pv=${fmtDelta(sb.pv, prev?.pv)} | normes=${fmtDelta(sb.normes, prev?.normes)} | ` +
    `zones=${fmtDelta(sb.zones, prev?.zones)} | immo=${fmtDelta(sb.immo, prev?.immo)} | ` +
    `cadastre=${fmtDelta(sb.cadastre, prev?.cadastre)} | role=${fmtDelta(sb.role, prev?.role)} | tod=${fmtDelta(sb.tod, prev?.tod)}`
  );
}

function parseOverrides(argv: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lane' && argv[i + 1]) {
      const [name, n] = argv[++i].split('=');
      if (name && n && Number.isFinite(Number(n))) m.set(name, Number(n));
    }
  }
  return m;
}

function tick(cfg: Config) {
  console.log(`=== geo-fleet tick ${iso()} ===`);
  const agents = expand(cfg);
  let relaunched = 0;
  let failed = 0;
  const dead: string[] = [];
  const notUp: string[] = [];
  for (const a of agents) {
    if (isAlive(a.name)) {
      console.log(`ALIVE    ${a.name}`);
      continue;
    }
    dead.push(a.name);
    console.log(`RELAUNCH ${a.name} shard=${a.shard ?? 'none'} model=${a.model ?? 'default'}`);
    const outcome = launchVerified(a.engine ?? cfg.engine, cfg.engineFallback, a);
    if (outcome === 'failed') {
      failed++;
      notUp.push(a.name);
      console.log(`FAILED   ${a.name} (no pane after launch — session did not come up)`);
    } else {
      relaunched++;
      if (outcome === 'up-fallback') console.log(`OK-FB    ${a.name} (on ${cfg.engineFallback})`);
    }
  }
  if (failed > 0) {
    console.log(`\n!! ${failed}/${agents.length} agents FAILED to come up: ${notUp.join(', ')}`);
    console.log('!! check tmux: a missing /tmp/tmux-$UID socket dir makes every h2a run die silently.');
  }
  const bf = ensureBackfill(cfg.backfill);
  console.log(`backfill ${cfg.backfill?.session ?? '(none)'}: ${bf}`);

  console.log('--- reconcile ---');
  const { line, sb } = reconcile();
  const prevRow = lastTimelineRow(cfg.timeline);
  const prev: Scoreboard | undefined = prevRow?.sb;
  console.log(line || '(reconcile: no scoreboard line)');
  console.log('Δ ' + scoreboardLine(sb, prev));

  sh('npx', ['tsx', 'acquisition/src/sync-track-from-coverage.ts', '--apply'], 180_000);

  if (cfg.h2aLoop) {
    sh('h2a', ['loop', 'tick', cfg.h2aLoop], 30_000);
    sh('h2a', ['loop', 'report', cfg.h2aLoop, '--note', `tick ${iso()}: relaunched=${relaunched} | ${line}`], 30_000);
  }

  // `alive` is measured BEFORE relaunching, `up` AFTER and verified: the pair is what
  // tells a stalled fleet (up=0 tick after tick) from a working one.
  const up = agents.filter((a) => isAlive(a.name)).length;
  const row = { ts: iso(), sb, relaunched, failed, alive: agents.length - dead.length, up, total: agents.length, dead, backfill: bf };
  appendTimeline(cfg.timeline, row);
  console.log(`=== tick done (relaunched=${relaunched}, failed=${failed}, UP=${up}/${agents.length}, timeline ${cfg.timeline}) ===`);
}

/**
 * Permanent supervision: tick, wait, tick again — forever.
 *
 * Nothing was re-ticking the fleet (no cron, no timer), so a dead agent stayed dead
 * until a human noticed. This keeps the configured lanes populated on its own.
 * Run it detached, once:
 *   bash scripts/geo-worker.sh bg geo-fleet-loop -- npx tsx acquisition/src/geo-fleet.ts loop --every 600
 */
async function loop(overrides: Map<string, number>, everySec: number): Promise<void> {
  console.log(`=== geo-fleet loop: tick every ${everySec}s ===`);
  for (;;) {
    try {
      // Reload config each tick so engine/shard edits to fleet.json take effect live,
      // without restarting the detached supervisor (e.g. flipping claude↔codex).
      tick(loadConfig(overrides));
    } catch (error) {
      // A single bad tick (S3 blip, reconcile timeout) must never end the supervision.
      console.error(`[loop] tick failed, continuing: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((r) => setTimeout(r, everySec * 1000));
  }
}

function status(cfg: Config) {
  const agents = expand(cfg);
  console.log(`fleet: ${agents.length} agents (${cfg.lanes.map((l) => `${l.name}×${l.shards}`).join(', ')}, +${cfg.singletons.length} singletons)`);
  for (const a of agents) console.log(`  ${isAlive(a.name) ? 'ALIVE   ' : 'down    '} ${a.name}${a.shard ? ` [${a.shard}]` : ''}`);
  timeline(cfg, 8);
}

function timeline(cfg: Config, n: number) {
  const p = resolve(REPO, cfg.timeline);
  if (!existsSync(p)) return console.log(`(no timeline yet at ${cfg.timeline})`);
  const rows = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  console.log(`--- timeline (last ${Math.min(n, rows.length)} of ${rows.length}) ---`);
  let prev: Scoreboard | undefined;
  for (const r of rows.slice(-n)) {
    console.log(`${r.ts}  ${scoreboardLine(r.sb, prev)}  [relaunched ${r.relaunched}, alive ${r.alive}/${r.total}]`);
    prev = r.sb;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'tick';
  const cfg = loadConfig(parseOverrides(argv));
  switch (cmd) {
    case 'tick':
      return tick(cfg);
    case 'loop': {
      const i = argv.indexOf('--every');
      return loop(parseOverrides(argv), i >= 0 ? Number(argv[i + 1]) || 600 : 600);
    }
    case 'status':
      return status(cfg);
    case 'timeline':
      return timeline(cfg, Number(argv[1]) || 12);
    case 'up': {
      const agents = expand(cfg);
      for (const a of agents) {
        console.log(`LAUNCH ${a.name}`);
        launch(a.engine ?? cfg.engine, a);
      }
      return;
    }
    case 'down':
      return stopAll(expand(cfg));
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
