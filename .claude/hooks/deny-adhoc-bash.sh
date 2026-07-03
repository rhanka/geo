#!/usr/bin/env bash
# PreToolUse/Bash hook for the geo project.
# Goal: NEVER hang on an approval prompt during the autonomous /loop.
#   - ad-hoc / diagnostic / dangerous commands  -> DENY immediately (fast fail)
#   - the committed geo workflow                -> ALLOW immediately (no prompt)
#   - anything unrecognized / any error         -> DENY (fail-safe, never fall open)
# Policy: memory use-committed-scripts-not-inline-bash.
# Input on stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}

emit() { printf '%s\n' "$1"; exit 0; }
DENY='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Commande ad-hoc rejetee -- utilise un script committe (voir memoire use-committed-scripts-not-inline-bash)."}}'
ALLOW='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"workflow geo committe (allowlist hook)"}}'
deny() { emit "$DENY"; }
allow() { emit "$ALLOW"; }

input="$(cat 2>/dev/null)" || deny
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "${cmd:-}" ] || deny

# --- Hard denies (dangerous), regardless of prefix ---
case "$cmd" in
  *'--force'*|*'push -f'*|*'push --force'*) deny ;;
  *'reset --hard'*|*'clean -f'*|*'clean -d'*) deny ;;
  *'rm -rf'*|*'rm -fr'*|*'rm -r '*) deny ;;
  *'$('*|*'`'*) deny ;;              # command substitution (ad-hoc diagnostics)
esac

# Strip a leading "cd <path> && " (workspace navigation is fine).
work="${cmd#cd * && }"

# --- Allowlist: the committed geo workflow, by leading command ---
case "$work" in
  'npx tsx acquisition/src/'*) allow ;;
  'npx tsx packages/'*) allow ;;
  'npx vitest'*) allow ;;
  'npx tsc'*) allow ;;
  'npm run '*|'npm test'*|'npm ci'*|'npm install'*|'npm --prefix '*) allow ;;
  'git '*|'git -C '*) allow ;;
  'gh '*) allow ;;
  'kubectl '*) allow ;;
esac

# Anything else (ad-hoc stat/date/for/grep/cat/... , unknown): fail-safe deny.
deny
