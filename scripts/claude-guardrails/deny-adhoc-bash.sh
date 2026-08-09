#!/usr/bin/env bash
# =============================================================================
# PreToolUse / Bash gate for the geo project.  (CANONICAL SOURCE)
#
# This is the version-controlled source of truth. Install it into place with:
#     bash scripts/install-claude-guardrails.sh
# which copies it to .claude/hooks/deny-adhoc-bash.sh and validates the gate.
#
# CONTRACT (why this file exists):
#   The autonomous /loop must NEVER hang on an interactive approval prompt.
#   This hook is the SINGLE ARBITER of every Bash tool call: it returns EITHER
#   "allow" OR "deny" and NEVER falls through to the normal permission flow
#   (which is what pops the blocking prompt). Any error / unparsable input /
#   unrecognized command => DENY (fail-closed, never fall open, never prompt).
#
#   Backstop (belt-and-suspenders, configured in .claude/settings.json):
#     - permissions.deny  : hard blocks that beat everything (defense in depth)
#     - permissions.allow : mirrors this allowlist for the simple-command case
#     - the hook is wired with an absolute-path fallback so a missing
#       $CLAUDE_PROJECT_DIR can never make the hook silently not-fire.
#   Optional stronger backstop (see scripts/install-claude-guardrails.sh notes):
#     - permissions.defaultMode = "dontAsk" turns any residual fall-through into
#       a DENY instead of a PROMPT, but ALSO auto-denies every non-Bash tool not
#       in permissions.allow -- only enable it with a comprehensive allow list.
#
# Policy: memory use-committed-scripts-not-inline-bash + zonage QA gate.
# Input on stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}
# =============================================================================
set -u

# --- decision emitters -------------------------------------------------------
# ALLOW: exit 0 + structured JSON (new schema) AND legacy {"decision":"approve"}
#        => skips the interactive prompt on every Claude Code version.
allow() {
  printf '%s\n' '{"decision":"approve","reason":"workflow geo committe (hook allowlist)","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"workflow geo committe (hook allowlist)"}}'
  exit 0
}
# DENY: emit BOTH the structured JSON deny (exit 0, proven honored in this repo)
#       and a stderr reason, then exit 0.
DENY_REASON="Commande ad-hoc rejetee -- utilise un script committe (memoire use-committed-scripts-not-inline-bash)."
deny() {
  local why="${1:-$DENY_REASON}"
  printf 'DENY(geo bash gate): %s\n' "$why" >&2
  printf '{"decision":"block","reason":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$DENY_REASON" "$DENY_REASON"
  exit 0
}

# --- read + parse the command (fail-closed) ----------------------------------
input="$(cat 2>/dev/null)" || deny "stdin illisible"
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
fi
if [ -z "${cmd:-}" ] && command -v node >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})' 2>/dev/null)"
fi
[ -n "${cmd:-}" ] || deny "commande vide / entree non parsable (fail-closed)"

# =============================================================================
# 1) HARD DENIES -- scanned over the WHOLE command (prefix-agnostic), so a
#    dangerous tail inside an otherwise-allowed compound is still blocked.
# =============================================================================
case "$cmd" in
  *'$('*|*'`'*)                                   deny "substitution de commande interdite (script committe requis)" ;;
  *'rm -rf'*|*'rm -fr'*|*'rm -r '*|*'rm --recursive'*) deny "suppression recursive interdite" ;;
  *' --force'*|*'push -f'*|*'push --force'*)      deny "operation --force interdite" ;;
  *'reset --hard'*|*'clean -f'*|*'clean -d'*)     deny "reset/clean destructif interdit" ;;
  *'| bash'*|*'|bash'*|*'| sh'*|*'|sh'*|*'| zsh'*) deny "pipe-to-shell interdit" ;;
  *'mkfs'*|*'dd if='*|*'> /dev/'*|*'of=/dev/'*)   deny "ecriture disque brute interdite" ;;
  *':(){'*|*'chmod -R 777'*|*'chown -R'*)         deny "operation systeme dangereuse" ;;
  *'shutdown'*|*'reboot '*|*'reboot'|*'sudo '*)   deny "commande privilegiee/systeme interdite" ;;
  *' -e '*|*' --eval'*|*'--input-type'*)          : ;;  # handled per-runner below
esac

# =============================================================================
# 2) NORMALIZE -- strip leading env-assignments and cd-prefixes (any order,
#    repeated), so `cd P && VAR=v npx tsx ...`, `VAR=v npx tsx ...`,
#    `cd P; npx ...` and multi-line `cd P\nnpx ...` all reduce to their core.
# =============================================================================
core="$cmd"
i=0
while [ "$i" -lt 12 ]; do
  i=$((i + 1))
  changed=0
  # leading "cd <path> && "  (shortest match => first &&)
  case "$core" in
    'cd '*' && '*) rest="${core#cd * && }"; [ "$rest" != "$core" ] && { core="$rest"; changed=1; } ;;
  esac
  # leading "cd <path>; "
  case "$core" in
    'cd '*'; '*) rest="${core#cd *; }"; [ "$rest" != "$core" ] && { core="$rest"; changed=1; } ;;
  esac
  # leading "cd <path>\n"  (multi-line)
  case "$core" in
    'cd '*$'\n'*) rest="${core#cd *$'\n'}"; [ "$rest" != "$core" ] && { core="$rest"; changed=1; } ;;
  esac
  # leading env assignment "VAR=value " (value has no spaces here)
  first="${core%%[[:space:]]*}"
  case "$first" in
    [A-Za-z_]*=*)
      core="${core#"$first"}"
      lead_ws="${core%%[![:space:]]*}"
      core="${core#"$lead_ws"}"
      changed=1 ;;
  esac
  [ "$changed" -eq 0 ] && break
done

# strip common process wrappers Claude Code itself strips (timeout/time/nice/...)
while : ; do
  case "$core" in
    'timeout '*' '*) core="${core#timeout * }" ;;
    'time '*)        core="${core#time }" ;;
    'nice '*)        core="${core#nice }" ;;
    'nohup '*)       core="${core#nohup }" ;;
    'stdbuf '*' '*)  core="${core#stdbuf * }" ;;
    *) break ;;
  esac
done

lead="${core%%[[:space:]]*}"                    # first token
rest="${core#"$lead"}"; rest="${rest#"${rest%%[![:space:]]*}"}"
sub="${rest%%[[:space:]]*}"                      # second token (subcommand)

# =============================================================================
# 3) ALLOWLIST -- the legitimate committed geo workflow (main + subagents).
#    Generous on legit leaders; everything else is DENIED (never prompted).
# =============================================================================
case "$lead" in
  npx)
    case "$sub" in
      tsx)
        # committed script runner; block inline eval / stdin
        args="${rest#tsx}"; args="${args#"${args%%[![:space:]]*}"}"  # drop "tsx "
        case " $args " in
          *' -e '*|*' --eval'*|*' -p '*|*' - '*) deny "npx tsx -e (code inline) interdit" ;;
        esac
        allow ;;
      vitest|tsc|playwright|prettier|eslint|tsdown|tsup) allow ;;
      *) deny "npx <$sub> non autorise" ;;
    esac ;;
  node|node18|node20|node22)
    case " $rest " in
      *' -e '*|*' --eval'*|*' --input-type'*|'  ') deny "node -e / inline interdit" ;;
      *) allow ;;                               # committed .mjs/.js runner
    esac ;;
  npm|pnpm|yarn)
    case "$sub" in
      run|run-script|test|t|ci|install|i|ls|list|exec|version|--prefix|prefix|rebuild|dedupe) allow ;;
      *) deny "npm <$sub> non autorise" ;;
    esac ;;
  bash|sh|zsh)
    case "$rest" in
      scripts/*|./scripts/*|'-c '*)
        case "$rest" in '-c '*) deny "bash -c inline interdit" ;; *) allow ;; esac ;;
      *) deny "bash <$rest> non autorise (seul scripts/ committe)" ;;
    esac ;;
  git|'git -C'|gh|kubectl|helm|docker|podman) allow ;;
  curl|wget|scp)                               allow ;;   # download public sources (pipeline)
  aws|rclone|mc|s3cmd)                          allow ;;   # S3 pipeline I/O
  mkdir|cp|mv|ln|touch|rmdir)                   allow ;;   # stage work dirs / place outputs
  make)                                          allow ;;
  track)                                         allow ;;   # read-only track reporting CLI (skill track-operation)
  *) deny "leader '<$lead>' hors allowlist" ;;
esac

# unreachable (every branch allow/deny-exits); fail-closed just in case
deny "fallthrough inattendu"
