#!/usr/bin/env bash
# SubagentStop observability hook — one line per subagent that finishes.
#
# Pairs with log-skill-run.sh so `harness metrics` can see fan-out: which agents
# a skill spawned, how often, and (when the branch names a ticket) for what.
# Schema-compatible with sosafe-ai-harness task-to-pr's track-usage.sh so one
# aggregator reads both. Non-blocking: always exits 0.
set -uo pipefail

input="$(cat)" || exit 0
log="${HOME}/.claude/sosafe-harness/runs.jsonl"
mkdir -p "$(dirname "$log")" 2>/dev/null || exit 0

agent="$(printf '%s' "$input" | jq -r '.agent_type // .agent_name // .subagent_type // empty' 2>/dev/null)"
[ -z "$agent" ] && exit 0
agent="${agent#dev-ai-harness:}"
session="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
ticket=""
if [ -n "$cwd" ] && { [ -d "$cwd/.git" ] || [ -f "$cwd/.git" ]; }; then
  ticket="$(git -C "$cwd" branch --show-current 2>/dev/null | grep -oE '\b[A-Z][A-Z0-9]+-[0-9]+\b' | head -1)"
fi

jq -cn \
  --arg agent "$agent" \
  --arg session "$session" \
  --arg ticket "$ticket" \
  '{ts: (now|floor), event: "subagent_stop", agent: $agent, session_id: $session} + (if $ticket != "" then {ticket: $ticket} else {} end)' \
  >> "$log" 2>/dev/null || true

exit 0
