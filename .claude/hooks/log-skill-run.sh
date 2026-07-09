#!/usr/bin/env bash
# PostToolUse(Skill) observability hook — the harness's telemetry layer.
#
# Appends one JSON record per skill invocation so `harness metrics` can report
# usage, coverage, success rate, and drift. Ported from the CMS Platform vault's
# observability layer, but the log lives in the PER-USER private dir
# (~/.claude/sosafe-harness/), never in the repo — the harness keeps usage data
# private, consistent with the profile and vault.
#
# Non-blocking: always exits 0, never interrupts the agent even if logging fails.
set -uo pipefail

input="$(cat)" || exit 0

log="${HOME}/.claude/sosafe-harness/runs.jsonl"
mkdir -p "$(dirname "$log")" 2>/dev/null || exit 0

skill="$(printf '%s' "$input" | jq -r '.tool_input.skill // empty' 2>/dev/null)"
[ -z "$skill" ] && exit 0   # not a skill invocation we can attribute

session="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"

# Success is explicit: a failure is is_error==true OR success==false; everything
# else is a success. (Don't use jq's `//` — it treats `false` as empty and would
# silently flip a real failure back to true.)
ok="$(printf '%s' "$input" | jq -r 'if .tool_response.is_error == true then "false" elif .tool_response.success == false then "false" else "true" end' 2>/dev/null)"

jq -cn \
  --arg skill "$skill" \
  --arg session "$session" \
  --argjson ok "${ok:-true}" \
  '{ts: (now|floor), event: "skill_invoked", skill: $skill, session_id: $session, success: $ok}' \
  >> "$log" 2>/dev/null || true

exit 0
