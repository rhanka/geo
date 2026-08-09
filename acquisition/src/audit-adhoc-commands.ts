#!/usr/bin/env -S npx tsx
/**
 * audit-adhoc-commands.ts
 *
 * Guardrail forensics for the geo project's Bash PreToolUse gate.
 *
 * Reads the Claude Code session transcripts (JSONL) for THIS project, extracts
 * every `Bash` tool_use command (main agent AND sub-agents / sidechains), joins
 * each command to its tool_result to detect real permission prompts / rejections,
 * then classifies every command through a faithful TypeScript re-implementation of
 *   (a) the current hook logic  (.claude/hooks/deny-adhoc-bash.sh)
 *   (b) the settings.json permissions.allow / permissions.deny rules
 * so we can see which commands are ALLOW / DENY / **UNCOVERED -> PROMPT** (the bug).
 *
 * No jq/grep/cat: pure fs + JSON.parse (the hook blocks ad-hoc shell).
 *
 * Usage:
 *   npx tsx acquisition/src/audit-adhoc-commands.ts
 *   npx tsx acquisition/src/audit-adhoc-commands.ts --json   (machine-readable dump)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_TRANSCRIPTS =
  process.env.GEO_TRANSCRIPT_DIR ||
  '/home/antoinefa/.claude/projects/-home-antoinefa-src-geo';

// ------------------------------------------------------------------ hook model
// Faithful port of .claude/hooks/deny-adhoc-bash.sh decision logic.
// Kept in sync with the shell so the audit reflects reality.

type Decision = 'allow' | 'deny';

// bash `${cmd#cd * && }` : strip shortest leading "cd <something> && "
function stripCdPrefix(cmd: string): string {
  // shortest match: first " && " after a leading "cd "
  if (cmd.startsWith('cd ')) {
    const idx = cmd.indexOf(' && ');
    if (idx > 0) return cmd.slice(idx + 4);
  }
  return cmd;
}

// Current shell hook, ported exactly (the version this repo ships BEFORE the fix).
function decisionCurrentHook(cmd: string): Decision {
  // hard denies (substring, prefix-agnostic)
  const hardDeny = [
    '--force', 'push -f', 'push --force',
    'reset --hard', 'clean -f', 'clean -d',
    'rm -rf', 'rm -fr', 'rm -r ',
  ];
  for (const p of hardDeny) if (cmd.includes(p)) return 'deny';
  if (cmd.includes('$(') || cmd.includes('`')) return 'deny';

  const work = stripCdPrefix(cmd);
  const allowPrefixes = [
    'npx tsx acquisition/src/', 'npx tsx packages/',
    'npx vitest', 'npx tsc',
    'npm run ', 'npm test', 'npm ci', 'npm install', 'npm --prefix ',
    'git ', 'git -C ', 'gh ', 'kubectl ',
    'curl ', 'wget ', 'mkdir ', 'mkdir -p ',
  ];
  for (const p of allowPrefixes) if (work.startsWith(p)) return 'allow';
  return 'deny';
}

// ------------------------------------------------------- settings permissions
// Port of Claude Code's Bash allow/deny matching, as documented: the rule
// `Bash(<pattern>)` matches when the command equals the pattern with a trailing
// `*` acting as a prefix wildcard. There is NO env-prefix / cd-prefix / compound
// normalization: the WHOLE command string must match. (This is exactly why
// `FOO=x npx tsx ...` and `cd p && npx tsx ...` do NOT match `Bash(npx tsx ...*)`.)
type PermRule = { raw: string; prefix: string; exact: boolean };
function parseBashRule(raw: string): PermRule | null {
  const m = raw.match(/^Bash\((.*)\)$/);
  if (!m) return null;
  const body = m[1];
  if (body.endsWith('*')) return { raw, prefix: body.slice(0, -1), exact: false };
  return { raw, prefix: body, exact: true };
}
function ruleMatches(rule: PermRule, cmd: string): boolean {
  return rule.exact ? cmd === rule.prefix : cmd.startsWith(rule.prefix);
}

type Settings = { allow: PermRule[]; deny: PermRule[]; defaultMode?: string };
function loadSettings(): Settings {
  const p = '/home/antoinefa/src/geo/.claude/settings.json';
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const perms = j.permissions || {};
  const map = (arr: string[] = []) =>
    arr.map(parseBashRule).filter((r): r is PermRule => !!r);
  return {
    allow: map(perms.allow),
    deny: map(perms.deny),
    defaultMode: perms.defaultMode,
  };
}

// What the SETTINGS layer alone would decide (used when the hook does NOT fire,
// e.g. for sub-agents on versions where hooks are main-only). Returns:
//   'deny'   -> permissions.deny matched
//   'allow'  -> permissions.allow matched
//   'prompt' -> neither matched => interactive approval prompt (THE BUG)
type SettingsDecision = 'allow' | 'deny' | 'prompt';
function decisionSettings(cmd: string, s: Settings): SettingsDecision {
  for (const r of s.deny) if (ruleMatches(r, cmd)) return 'deny';
  for (const r of s.allow) if (ruleMatches(r, cmd)) return 'allow';
  return 'prompt';
}

// ------------------------------------------------------------ pattern tagging
function patternsOf(cmd: string): string[] {
  const tags: string[] = [];
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+\S/.test(cmd)) tags.push('env-prefix');
  if (/^\s*cd\s+\S+\s+&&/.test(cmd)) tags.push('cd-prefix');
  if (cmd.includes('$(') || cmd.includes('`')) tags.push('cmd-substitution');
  if (/\|\|/.test(cmd)) tags.push('logical-or');
  else if (/\|/.test(cmd)) tags.push('pipe');
  if (/&&/.test(cmd)) tags.push('and-chain');
  if (/;/.test(cmd)) tags.push('semicolon-chain');
  if (/^\s*for\b|^\s*while\b|^\s*if\b/.test(cmd)) tags.push('shell-loop');
  if (/\b(playwright|puppeteer)\b/.test(cmd)) tags.push('browser-tool');
  if (/^\s*node\b/.test(cmd)) tags.push('bare-node');
  const lead = stripCdPrefix(cmd).replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)+/, '');
  const firstTok = lead.trim().split(/\s+/)[0] || '';
  tags.push('lead:' + firstTok);
  return tags;
}

// ------------------------------------------------------------- transcript I/O
interface BashCall {
  file: string;
  uuid: string;
  toolUseId: string;
  sessionId?: string;
  isSidechain: boolean;
  command: string;
  ts?: string;
  resultText?: string;
  resultError?: boolean;
  promptEvidence?: string;
}

const PROMPT_MARKERS = [
  "doesn't want to proceed",
  'do not want to proceed',
  'user doesn’t want',
  'requested permissions',
  'permission to use',
  'permission denied by',
  'operation was rejected',
  'rejected the tool',
  'has not granted',
  'requires approval',
  'approval prompt',
  'tool use was rejected',
  'user has denied permission',
];

function textOf(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
  if (typeof content === 'object') return content.text ?? '';
  return '';
}

function main() {
  const asJson = process.argv.includes('--json');
  if (!existsSync(PROJECT_TRANSCRIPTS)) {
    console.error('Transcript dir not found: ' + PROJECT_TRANSCRIPTS);
    process.exit(1);
  }
  const files = readdirSync(PROJECT_TRANSCRIPTS)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  const calls: BashCall[] = [];
  const resultsById = new Map<string, { text: string; error: boolean }>();

  // ---- diagnostics accumulators ----
  const diag = {
    sidechainRecords: 0,
    mainRecords: 0,
    hookFiredDeny: 0, // occurrences of the hook's deny reason string
    hookFiredAllow: 0, // occurrences of the hook's allow reason string
    permissionDecisionSeen: 0, // any "permissionDecision" token
    sleepBlocked: 0, // Claude Code built-in sleep guard
    perFile: [] as { file: string; mtime: string; bytes: number; sidechain: number }[],
  };
  const HOOK_DENY_REASON = 'Commande ad-hoc rejetee';
  const HOOK_ALLOW_REASON = 'workflow geo committe';

  for (const f of files) {
    const full = join(PROJECT_TRANSCRIPTS, f);
    let raw: string;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let fileSide = 0;
    try {
      const st = statSync(full);
      diag.perFile.push({
        file: f,
        mtime: st.mtime.toISOString(),
        bytes: st.size,
        sidechain: 0,
      });
    } catch {
      /* ignore */
    }
    // cheap raw-string probes (proof the hook actually fired / decisions taken)
    const chunkDeny = raw.split(HOOK_DENY_REASON).length - 1;
    const chunkAllow = raw.split(HOOK_ALLOW_REASON).length - 1;
    const chunkPerm = raw.split('permissionDecision').length - 1;
    const chunkSleep = raw.split('Blocked: sleep').length - 1;
    diag.hookFiredDeny += chunkDeny;
    diag.hookFiredAllow += chunkAllow;
    diag.permissionDecisionSeen += chunkPerm;
    diag.sleepBlocked += chunkSleep;
    for (const line of raw.split('\n')) {
      if (line.includes('"isSidechain":true')) fileSide++;
      if (!line.trim()) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const isSide = rec.isSidechain === true;
      const sessionId = rec.sessionId;
      const msg = rec.message;
      const content = msg?.content;
      // tool_use (assistant) — collect Bash commands
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === 'tool_use' && item?.name === 'Bash') {
            const command = item?.input?.command;
            if (typeof command === 'string') {
              calls.push({
                file: f,
                uuid: rec.uuid,
                toolUseId: item.id,
                sessionId,
                isSidechain: isSide,
                command,
                ts: rec.timestamp,
              });
            }
          }
          // tool_result (user) — collect for join
          if (item?.type === 'tool_result' && item?.tool_use_id) {
            resultsById.set(item.tool_use_id, {
              text: textOf(item.content),
              error: item.is_error === true,
            });
          }
        }
      }
    }
    diag.sidechainRecords += fileSide;
    const pf = diag.perFile.find((x) => x.file === f);
    if (pf) pf.sidechain = fileSide;
  }
  diag.mainRecords = calls.filter((c) => !c.isSidechain).length;

  // join results + detect prompt evidence
  for (const c of calls) {
    const r = resultsById.get(c.toolUseId);
    if (r) {
      c.resultText = r.text.slice(0, 400);
      c.resultError = r.error;
      const low = r.text.toLowerCase();
      const hit = PROMPT_MARKERS.find((m) => low.includes(m.toLowerCase()));
      if (hit) c.promptEvidence = hit;
    }
  }

  const settings = loadSettings();

  // classify
  interface Classified extends BashCall {
    hook: Decision;
    settings: SettingsDecision;
    patterns: string[];
  }
  const classified: Classified[] = calls.map((c) => ({
    ...c,
    hook: decisionCurrentHook(c.command),
    settings: decisionSettings(c.command, settings),
    patterns: patternsOf(c.command),
  }));

  if (asJson) {
    console.log(JSON.stringify(classified, null, 2));
    return;
  }

  // -------- report ----------
  const total = classified.length;
  const side = classified.filter((c) => c.isSidechain);
  const main_ = classified.filter((c) => !c.isSidechain);

  const hookDeny = classified.filter((c) => c.hook === 'deny');
  const hookAllow = classified.filter((c) => c.hook === 'allow');

  // If the hook applies to a call, its verdict wins (allow/deny, never prompt).
  // If the hook does NOT apply (hypothesis: sub-agents), the SETTINGS layer decides,
  // and 'prompt' there is the real bug. Report BOTH views.
  const settingsPrompt = classified.filter((c) => c.settings === 'prompt');
  const sidePrompt = side.filter((c) => c.settings === 'prompt');
  const mainPrompt = main_.filter((c) => c.settings === 'prompt');

  const evidence = classified.filter((c) => c.promptEvidence || c.resultError);

  const L = (s = '') => console.log(s);
  L('===================================================================');
  L(' BASH GUARDRAIL AUDIT  (geo)');
  L('===================================================================');
  L(`transcripts dir : ${PROJECT_TRANSCRIPTS}`);
  L(`files scanned   : ${files.length}  ->  ${files.join(', ')}`);
  L(`Bash tool_use   : ${total}   (main=${main_.length}, sidechain/subagent=${side.length})`);
  L(`settings.defaultMode : ${settings.defaultMode ?? '(unset)'}`);
  L('');
  L('--- CURRENT HOOK verdict (if hook fires for the call) --------------');
  L(`  allow : ${hookAllow.length}`);
  L(`  deny  : ${hookDeny.length}   (hook NEVER prompts; always allow|deny)`);
  L('');
  L('--- SETTINGS-ONLY verdict (what happens if the hook does NOT fire) -');
  L(`  allow  : ${classified.filter((c) => c.settings === 'allow').length}`);
  L(`  deny   : ${classified.filter((c) => c.settings === 'deny').length}`);
  L(`  PROMPT : ${settingsPrompt.length}   <-- interactive approval (THE BUG)`);
  L(`     of which sidechain/subagent : ${sidePrompt.length}`);
  L(`     of which main agent         : ${mainPrompt.length}`);
  L('');

  // pattern histogram over the PROMPT set (settings-uncovered)
  const patCount = new Map<string, number>();
  for (const c of settingsPrompt)
    for (const p of c.patterns) patCount.set(p, (patCount.get(p) ?? 0) + 1);
  const topPats = [...patCount.entries()].sort((a, b) => b[1] - a[1]);
  L('--- TOP PATTERNS among PROMPT (settings-uncovered) commands --------');
  for (const [p, n] of topPats.slice(0, 25)) L(`  ${String(n).padStart(4)}  ${p}`);
  L('');

  // sample uncovered commands
  L('--- SAMPLE of PROMPT (settings-uncovered) commands -----------------');
  const seen = new Set<string>();
  let shown = 0;
  for (const c of settingsPrompt) {
    const key = c.command.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    if (shown++ >= 40) break;
    const scope = c.isSidechain ? 'SUB ' : 'MAIN';
    L(`  [${scope}] hook=${c.hook} :: ${c.command.replace(/\n/g, ' ').slice(0, 150)}`);
  }
  L('');

  // hard evidence of prompts/rejections in the transcript results
  L('--- TRANSCRIPT EVIDENCE (result text markers of prompt/rejection) --');
  if (evidence.length === 0) {
    L('  (none matched — no explicit permission-prompt result strings found)');
  } else {
    for (const c of evidence.slice(0, 30)) {
      const scope = c.isSidechain ? 'SUB ' : 'MAIN';
      L(`  [${scope}] marker=${c.promptEvidence ?? 'is_error'} :: ${c.command.replace(/\n/g, ' ').slice(0, 90)}`);
      if (c.resultText) L(`         -> ${c.resultText.replace(/\n/g, ' ').slice(0, 160)}`);
    }
  }
  L('');
  L('--- WORKFLOW forms that CURRENT HOOK wrongly DENIES (regression) ---');
  // legit-looking commands the current hook denies (env-prefix, etc.)
  const wronglyDenied = classified.filter(
    (c) =>
      c.hook === 'deny' &&
      (c.patterns.includes('env-prefix') || c.patterns.includes('cd-prefix')) &&
      /npx tsx|npm |git |kubectl |vitest|tsc/.test(c.command),
  );
  const wd = new Set<string>();
  for (const c of wronglyDenied) {
    const k = c.command.slice(0, 100);
    if (wd.has(k)) continue;
    wd.add(k);
    L(`  hook=DENY :: ${c.command.replace(/\n/g, ' ').slice(0, 150)}`);
  }
  if (wd.size === 0) L('  (none)');
  L('');
  L('--- ROOT-CAUSE DIAGNOSTICS -----------------------------------------');
  L(`  Bash records: main=${diag.mainRecords}  sidechain/subagent=${diag.sidechainRecords}`);
  L(`  Hook-fired evidence in transcripts:`);
  L(`     deny-reason  "${HOOK_DENY_REASON}"  occurrences : ${diag.hookFiredDeny}`);
  L(`     allow-reason "${HOOK_ALLOW_REASON}" occurrences : ${diag.hookFiredAllow}`);
  L(`     "permissionDecision" token occurrences         : ${diag.permissionDecisionSeen}`);
  L(`     built-in "Blocked: sleep" guard occurrences    : ${diag.sleepBlocked}`);
  L('  Interpretation:');
  if (diag.hookFiredDeny === 0 && diag.hookFiredAllow === 0) {
    L('     -> NO trace of THIS hook firing in the scanned transcripts:');
    L('        these sessions predate the hook (or ran without it). The ad-hoc');
    L('        commands above ran freely => they were NOT gated.');
  } else {
    L('     -> hook decisions ARE present in transcripts (hook was active).');
  }
  L('  Per-file (mtime / bytes / sidechain records):');
  for (const pf of diag.perFile.sort((a, b) => a.mtime.localeCompare(b.mtime)))
    L(`     ${pf.mtime}  ${String(pf.bytes).padStart(9)}B  side=${pf.sidechain}  ${pf.file}`);
  const cur = '/home/antoinefa/.claude/projects/-home-antoinefa-src-geo';
  L(`  (current session file appears here once flushed by Claude Code)`);
  void cur;
  L('');
  L('===================================================================');
}

main();
