---
name: harness-workspace
description: >
  Clones the repos the user maintains into the local workspace/ folder and keeps them
  updated, so other workflows can ground answers in real code. Trigger when the user says
  "clone my repos", "pull the projects I maintain", "set up my workspace", "update my
  repos", or after onboarding offers it. Reads the repo list from the profile; clones are
  the only side effect and the user confirms before any clone runs.
model: haiku
effort: low
allowed-tools: >-
  Read
  Write
  Glob
  Bash(gh repo clone:*)
  Bash(git -C:*)
  Bash(git clone:*)
  Bash(ls:*)
  Bash(mkdir -p:*)
  Bash(jq:*)
---

# Harness Workspace

Bring the user's maintained repos onto disk under `${CLAUDE_PLUGIN_ROOT}/workspace/` (gitignored) and keep them
fresh, so grounding workflows can Grep real code instead of guessing.

## Inputs

`~/.claude/sosafe-harness/profile.json` → `repos[]`. Missing → tell the user to run
`/setup` and stop.

## Steps

1. Survey `${CLAUDE_PLUGIN_ROOT}/workspace/`: cloned already, in the profile but missing, on disk but not in the profile.
2. Show the plan — to clone, to update, to leave alone — and ask once before touching anything.
3. Clone approved: `gh repo clone <full_name> ${CLAUDE_PLUGIN_ROOT}/workspace/<name>`. Default branch only; never switch branches.
4. Update approved: `git -C ${CLAUDE_PLUGIN_ROOT}/workspace/<name> fetch --all --prune`, then fast-forward `pull`
   **only if** the tree is clean and on a tracking branch. Dirty → report and skip, never overwrite.
5. Set `cloned: true` for each success and write the profile back (`jq empty` to validate).

## Output

Three counts and the exceptions: `cloned N, updated N, skipped N` plus one line per skipped
repo with its reason. Nothing else.

## Gates

Confirm once before cloning or pulling. `git push` is never part of this skill; remote state
is never modified.
