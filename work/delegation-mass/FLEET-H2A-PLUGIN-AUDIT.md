# Fleet h2a plugin audit

Date: 2026-07-10
Repo: `/home/antoinefa/src/geo`
Branch: `feat/cadre-acquisition`

## Scope

This audit covers the current geo supervision path:

- `acquisition/src/geo-fleet.ts`
- `acquisition/config/fleet.json`
- `scripts/geo-loop-tick.sh`
- `scripts/geo-worker.sh`
- local `@sentropic/h2a` / `@sentropic/h2a-runtime` packages installed under `/home/antoinefa/.npm-global/lib/node_modules`

Operational constraints respected: no `.track` writes, no fleet stop, no acquisition jobs.

## Current state

The fleet table is already data-driven:

- `acquisition/config/fleet.json` owns lanes, shard counts, prompts, singleton agents, deterministic backfill, loop id and append-only timeline path.
- `acquisition/src/geo-fleet.ts` owns expansion, liveness checks, relaunch policy, reconcile, sync-track call and one JSONL timeline row per tick.
- `scripts/geo-loop-tick.sh` is a thin compatibility shim around `npx tsx acquisition/src/geo-fleet.ts tick`.

The remaining non-integrated boundary is `scripts/geo-worker.sh`. It is still a device driver around:

- `h2a run <engine> <repo> --name <session> --no-attach --no-gw`
- `h2a stop <session>`
- `tmux capture-pane`
- `tmux set-buffer` / `paste-buffer` / `send-keys`

That is tolerable as a launcher, but it is not yet a clean TypeScript plugin boundary.

## What should still move to TS/config

Priority order:

1. Replace `geo-worker.sh` with a typed `AgentDriver` interface used by `geo-fleet.ts`. Keep a shell-backed implementation only as a fallback adapter, not as the policy surface.
2. Move prompt composition and shard prefixing out of bash. `fleet.json` should describe prompts/shards; TS should build the effective message.
3. Replace tmux pane string probing (`esc to interrupt`) with structured h2a/session state when available. The timeline should record the source of truth used for each liveness verdict.
4. Preserve append-only logs: keep `work/coverage/fleet-timeline.jsonl`, and add driver events (`launch_requested`, `ready`, `prompt_sent`, `stop_requested`, `inspect_failed`) as structured fields instead of relying on pane text.
5. Deprecate old wave scripts that still encode fleet or launch policy in bash:
   - `scripts/geo-codex-8-wave.sh`
   - `scripts/geo-remote-4-wave.sh`
   - `scripts/geo-wave-launch.sh`
   - `scripts/geo-supervisor-subagent.sh`

## h2a package audit

Installed binary:

- `which h2a` -> `/home/antoinefa/.npm-global/bin/h2a`
- symlink target -> `/home/antoinefa/.npm-global/lib/node_modules/@sentropic/h2a/dist/bin.js`
- `h2a --version` -> `0.85.11`

Package evidence:

- `@sentropic/h2a/package.json`
  - name: `@sentropic/h2a`
  - version: `0.85.11`
  - exports only `"."` as `./dist/index.js` / `./dist/index.d.ts`
  - bin: `h2a`
  - optional peer dependency: `@sentropic/h2a-runtime`
- `@sentropic/h2a-runtime/package.json`
  - name: `@sentropic/h2a-runtime`
  - version: `0.85.11`
  - exports only `"."` as `./dist/index.js` / `./dist/index.d.ts`

Importable `@sentropic/h2a` surface proven by `dist/index.d.ts`:

- protocol/store: `createLocalStore`, `listPresence`, `readPresence`, `writePresence`, `resolveRecipient`, `inboxDir`
- MCP/server: `createMcpServer`, `runMcpStdio`, `SessionRegistry`
- loop store: `createObjectiveLoop`, `joinObjectiveLoop`, `reportObjectiveLoop`, `stopObjectiveLoop`, `listObjectiveLoops`
- drumbeat: `recordStop`, `scanDrumbeat`, `drumbeatTick`, relauncher interfaces and adapters
- governance: `conductorFor`, `conductorLaunchCheck`, `recordSpawnRequest`

MCP tools exposed by `@sentropic/h2a/dist/mcp.d.ts` include:

- session/presence: `h2a_session_open`, `h2a_session_close`, `h2a_discover_sessions`
- messaging: `h2a_inbox`
- loop: `h2a_loop_create`, `h2a_loop_join`, `h2a_loop_report`, `h2a_loop_done`, `h2a_loop_stop`, `h2a_loop_list`, `h2a_loop_status`
- governance: `h2a_conductor`, `h2a_conductor_claim`, `h2a_conductor_release`, `h2a_conductor_launch_check`, `h2a_conductor_launch`

Importable `@sentropic/h2a-runtime` surface proven by `dist/index.d.ts`:

- `run(options: RunOptions): Promise<RunResult>`
- remote session API: `createRemoteSession`, `listRemoteSessions`, `getRemoteSession`, `stopRemoteSession`, `refreshRemoteSession`, `renameRemoteSession`
- job helpers: `startJob`, `resumeThrottledJob`
- h2a-facing projections: `projectAgentsForH2a()`, `capturePaneForH2a(name, lines?)`

Important limitation: the tmux helpers that look like the needed local driver (`startLocalSession`, `killLocalSession`, `sendKeysLiteral`, `capturePane`) exist in `@sentropic/h2a-runtime/dist/tmux.d.ts`, but they are not exported through the package export surface. Importing those by deep `dist/...` path would bypass `package.json` exports and is not a stable plugin API.

CLI evidence:

- `h2a run --help` describes a runtime/remote command surface for starting local tmux sessions.
- It is not represented as a typed high-level `launchAgent({ engine, cwd, name, prompt, model, gateway })` API in the public package exports.

Conclusion: h2a is importable for protocol, store, MCP, loop, presence, drumbeat, remote sessions and some runtime helpers. It does not yet expose a clean public TypeScript API that fully replaces `geo-worker.sh` for local interactive agent launch, prompt injection, stop, inspect and message-send.

## Minimum h2a evolution request

Add a public package export, either in `@sentropic/h2a` or `@sentropic/h2a-runtime`, dedicated to fleet orchestration:

```ts
export type H2AAgentEngine = 'claude' | 'codex' | 'gemini' | 'agy' | 'opencode';

export interface H2AFleetDriverOptions {
  root?: string;
  cwd: string;
  defaultGateway?: 'on' | 'off' | 'auto';
  logger?: (event: H2AFleetEvent) => void;
}

export interface LaunchAgentInput {
  engine: H2AAgentEngine;
  name: string;
  cwd: string;
  prompt?: string;
  model?: string;
  gateway?: 'on' | 'off' | 'auto';
  attach?: boolean;
  replace?: boolean;
  idempotencyKey: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentHandle {
  name: string;
  instance?: string;
  sessionId?: string;
  tmux?: { session: string; pane: string; window?: string };
  status: 'starting' | 'ready' | 'running' | 'idle' | 'stopped' | 'failed';
}

export interface InspectAgentInput {
  name?: string;
  instance?: string;
}

export interface AgentSnapshot extends AgentHandle {
  lastHeartbeatAt?: string;
  workStatus?: string;
  lastPaneLine?: string;
  connectionConfidence?: 'active' | 'idle-uncertain' | 'unknown';
}

export interface SendAgentMessageInput {
  name?: string;
  instance?: string;
  text: string;
  submit?: boolean;
  idempotencyKey: string;
}

export interface StopAgentInput {
  name?: string;
  instance?: string;
  reason?: string;
  idempotencyKey: string;
  timeoutMs?: number;
}

export interface H2AFleetDriver {
  launchAgent(input: LaunchAgentInput, signal?: AbortSignal): Promise<AgentHandle>;
  inspectAgent(input: InspectAgentInput): Promise<AgentSnapshot | undefined>;
  sendMessage(input: SendAgentMessageInput, signal?: AbortSignal): Promise<{ delivered: boolean; target: string }>;
  stopAgent(input: StopAgentInput, signal?: AbortSignal): Promise<{ stopped: boolean; target: string }>;
  reportLoop(loopId: string, note: string, input?: { instance?: string; agentId?: string }): Promise<void>;
  tickLoop(loopId: string, input?: { execute?: boolean }): Promise<unknown>;
}
```

Events should be emitted as structured records:

```ts
export type H2AFleetEvent =
  | { type: 'agent.launch.requested'; name: string; idempotencyKey: string; at: string }
  | { type: 'agent.launch.ready'; name: string; sessionId?: string; pane?: string; at: string }
  | { type: 'agent.prompt.sent'; name: string; bytes: number; at: string }
  | { type: 'agent.inspect'; name: string; status: AgentSnapshot['status']; at: string }
  | { type: 'agent.stop.requested'; name: string; reason?: string; at: string }
  | { type: 'loop.reported'; loopId: string; at: string };
```

Required error/idempotence behavior:

- Idempotency key is mandatory for launch, stop and send. Repeating the same key returns the same result or a no-op success.
- `replace: false` must never disturb a live agent.
- `replace: true` must stop only the exact named/session target, never glob by default.
- Errors should be typed: `H2A_RUNTIME_UNAVAILABLE`, `H2A_AGENT_EXISTS`, `H2A_AGENT_NOT_FOUND`, `H2A_AGENT_AMBIGUOUS`, `H2A_PANE_UNREADY`, `H2A_HUMAN_ACTIVITY_DEFERRED`, `H2A_STORE_LOCK_TIMEOUT`, `H2A_TRANSIENT`.
- Prompt/message injection must use argv/literal-safe transport internally; callers never concatenate shell strings.
- Inspect must return structured status without forcing callers to parse tmux pane text. A degraded `lastPaneLine` fallback is acceptable if marked as degraded.

## How geo-fleet.ts would consume it

Geo should keep a small local interface:

```ts
interface FleetAgentDriver {
  inspect(a: Agent): Promise<AgentSnapshot | undefined>;
  launch(a: Agent, promptText: string): Promise<AgentHandle>;
  stop(a: Agent): Promise<void>;
  send(a: Agent, text: string): Promise<void>;
  reportLoop(loopId: string, note: string): Promise<void>;
}
```

Then provide two implementations:

- `H2aPluginDriver`, backed by the new h2a API.
- `ShellGeoWorkerDriver`, current `scripts/geo-worker.sh` fallback for compatibility.

The `tick()` path would become:

1. expand fleet from `fleet.json`
2. `inspect()` every agent
3. launch missing/dead agents through the configured driver
4. reconcile coverage
5. append one timeline row with per-agent driver events and source-of-truth
6. `reportLoop()` through h2a when configured

This keeps geo policy in TS/config while isolating unavoidable host mechanics behind a typed adapter.

## Local improvement applied

Small safe code change: `ensureBackfill()` in `acquisition/src/geo-fleet.ts` no longer uses `execSync("pgrep -f ...")` through a shell. It now calls:

```ts
execFileSync('pgrep', ['-f', bf.match], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 15_000 });
```

This removes one inline shell fragment without changing fleet behavior.
