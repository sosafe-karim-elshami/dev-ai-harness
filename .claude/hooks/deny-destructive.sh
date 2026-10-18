#!/bin/bash
# Always-on PreToolUse guard for Bash: the actions no mode may take.
#
# Chat-stated boundaries can vanish in compaction; this one cannot. It denies (never asks)
# landing code on a protected branch, merging, force-pushing, rewriting history, and
# recursive deletes outside the project, its worktrees, or the temp dir. Ordinary branch
# work — commit, rebase, merge main INTO a feature branch, push a feature branch,
# --force-with-lease — stays allowed. Regex prelude ported from sosafe-ticket-loop's
# enforce-no-merge.sh, minus its run-marker scoping: this applies everywhere.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[[ "$TOOL" != "Bash" ]] && exit 0
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[[ -z "$COMMAND" ]] && exit 0

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: ($reason + " — the harness never does this; a human on the owning team does.") }
  }'
  exit 0
}
matches() { echo "$COMMAND" | grep -qE "$1"; }

GIT='(^|[[:space:]])git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir(=|[[:space:]]+)[^[:space:]]+|--work-tree(=|[[:space:]]+)[^[:space:]]+|--no-pager|-[pP]))*[[:space:]]+'
GH='(^|[[:space:]])gh([[:space:]]+(-R[[:space:]]+[^[:space:]]+|--repo(=|[[:space:]]+)[^[:space:]]+|--[a-zA-Z][a-zA-Z-]*=[^[:space:]]*|--[a-zA-Z][a-zA-Z-]*|-[a-zA-Z]))*[[:space:]]+'
PUSH="${GIT}push[[:space:]]"
ARGS='([^&|;]*[[:space:]])?'

# Merge / promote
matches "${GH}pr[[:space:]]+merge([[:space:]]|$)"            && deny "gh pr merge is not allowed"
matches "${GH}api[[:space:]][^&|;]*/merge([[:space:]]|$)"    && deny "merging via gh api is not allowed"

# Protected branches
matches "${PUSH}${ARGS}[+]?(HEAD:|refs/heads/)?(main|master|develop)([[:space:]]|$)"        && deny "direct push to a protected branch is not allowed — open a PR"
matches "${PUSH}${ARGS}[+]?[^[:space:]]*:(refs/heads/)?(main|master|develop)([[:space:]]|$)" && deny "pushing to a protected branch is not allowed — open a PR"
matches "${PUSH}${ARGS}(--delete|-d)([[:space:]]|$)"         && deny "deleting a remote branch is not allowed"
matches "${PUSH}${ARGS}:[^[:space:]]"                        && deny "deleting a remote branch (':<ref>') is not allowed"

# History rewrites and force pushes (lease is fine)
matches "${PUSH}${ARGS}(-f|--force)([[:space:]]|$)"          && deny "force-push is not allowed (use --force-with-lease on your own branch)"
matches "${GIT}reset[[:space:]]+${ARGS}--hard([[:space:]]|$)" && deny "git reset --hard discards work"
matches "${GIT}clean[[:space:]]+${ARGS}-[a-zA-Z]*[fdx]"       && deny "git clean -f/-d/-x deletes untracked files"
matches "${GIT}branch[[:space:]]+${ARGS}-D([[:space:]]|$)"    && deny "git branch -D force-deletes a branch"
matches "${GIT}worktree[[:space:]]+remove[[:space:]]+${ARGS}(--force|-f)([[:space:]]|$)" && deny "forced worktree removal discards work"

# rm -rf outside the project / worktrees / temp
if matches '(^|[[:space:]&;|])rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r[[:space:]]+-f|-f[[:space:]]+-r)'; then
  ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
  TMP="${TMPDIR:-/tmp}"
  for arg in $(echo "$COMMAND" | sed -E 's/.*rm[[:space:]]+//' | tr -d '"'"'"); do
    [[ "$arg" == -* ]] && continue
    # Expand a literal ~ / $HOME ourselves so the comparison sees the real path.
    expanded="$arg"
    [[ "$arg" == "~" || "$arg" == "~/"* ]] && expanded="${HOME}${arg#\~}"
    [[ "$arg" == '$HOME'* ]] && expanded="${HOME}${arg#\$HOME}"
    case "$expanded" in
      "$ROOT"|"$ROOT"/*|./*|"$TMP"/*|/tmp/*|/private/tmp/*|*/.claude/worktrees/*) ;;
      /*|"$HOME"|"$HOME"/*) deny "rm -rf outside the project, its worktrees, or the temp dir ($arg)" ;;
    esac
  done
fi
exit 0
