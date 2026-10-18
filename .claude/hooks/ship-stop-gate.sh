#!/bin/bash
# Stop hook for /ship: a run may not end on a bare "done".
#
# Active only while features/<KEY>/ship.active exists (the skill creates it at the worktree
# step and removes it at the digest step). Then the last assistant message must either
# declare SHIP_BLOCKED or the verify report must say PASS and a PR (URL or pr.md) must
# exist. Honours stop_hook_active so a blocked stop cannot loop.

INPUT=$(cat)
[[ "$(echo "$INPUT" | jq -r '.stop_hook_active // false')" == "true" ]] && exit 0
CWD=$(echo "$INPUT" | jq -r '.cwd // ""'); [[ -z "$CWD" ]] && CWD="$PWD"
BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null)
KEY=$(echo "$BRANCH" | grep -oE '\b[A-Z][A-Z0-9]+-[0-9]+\b' | head -1)
[[ -z "$KEY" ]] && exit 0
DIR="$CWD/features/$KEY"
[[ -f "$DIR/ship.active" ]] || exit 0

LAST=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')
echo "$LAST" | grep -q 'SHIP_BLOCKED' && exit 0

REASON=""
if [[ ! -f "$DIR/verify-report.json" ]]; then
  REASON="no verify report yet (features/$KEY/verify-report.json)"
elif [[ "$(jq -r '.verdict // ""' "$DIR/verify-report.json" 2>/dev/null)" != "PASS" ]]; then
  REASON="verify report verdict is not PASS"
elif [[ ! -f "$DIR/pr.md" ]] && ! echo "$LAST" | grep -qE 'https://github.com/[^ ]+/pull/[0-9]+'; then
  REASON="no draft PR URL in the report and no features/$KEY/pr.md"
fi
[[ -z "$REASON" ]] && exit 0

jq -n --arg r "$REASON" --arg k "$KEY" '{
  decision: "block",
  reason: ("A /ship run for " + $k + " is still active: " + $r + ". Finish the gates, or end with `SHIP_BLOCKED <reason>` and say what is missing.")
}'
exit 0
