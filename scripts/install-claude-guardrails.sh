#!/usr/bin/env bash
# =============================================================================
# install-claude-guardrails.sh
#
# Materializes the version-controlled Bash guardrail (canonical source under
# scripts/claude-guardrails/) into .claude/ so the PreToolUse gate is active
# and persistent. Backs up whatever is currently there, then validates the
# gate end-to-end with the committed pipe-test.
#
#   bash scripts/install-claude-guardrails.sh
#
# Why this exists: an agent's Edit/Write of .claude/ takes effect for the live
# session but is not always visible to the agent's git sandbox, so the guardrail
# is version-controlled here and installed by this idempotent script (runnable
# by a human or a session-start hook).
# =============================================================================
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
src="$here/scripts/claude-guardrails"
dst_hook="$here/.claude/hooks/deny-adhoc-bash.sh"
dst_settings="$here/.claude/settings.json"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

echo "== install-claude-guardrails =="
echo "repo root : $here"

mkdir -p "$here/.claude/hooks"

# backup existing (non-destructive)
for f in "$dst_hook" "$dst_settings"; do
  if [ -f "$f" ]; then
    cp -f "$f" "$f.bak-$stamp"
    echo "backed up : $f -> $f.bak-$stamp"
  fi
done

cp -f "$src/deny-adhoc-bash.sh" "$dst_hook"
chmod +x "$dst_hook"
echo "installed : $dst_hook"

cp -f "$src/settings.json" "$dst_settings"
echo "installed : $dst_settings"

echo "== validating gate (pipe-test + settings) =="
npx tsx "$here/acquisition/src/verify-bash-gate.ts" || {
  echo "VALIDATION FAILED — review output above" >&2
  exit 1
}

cat <<'NOTE'

== OPTIONAL absolute backstop ==
The hook above already guarantees no Bash prompt (it always allow/denies and is
wired with an absolute-path fallback). If you additionally want ANY residual
fall-through auto-DENIED instead of prompted, set in .claude/settings.json:

    "permissions": { "defaultMode": "dontAsk", ... }

CAUTION: "dontAsk" auto-denies EVERY tool not matched by permissions.allow
(including Read/Edit/Write/WebFetch and MCP tools). Only enable it together with
a comprehensive permissions.allow for the non-Bash tools your workflow uses,
and re-run this validator to confirm nothing legitimate is blocked.
NOTE
echo "== done =="
