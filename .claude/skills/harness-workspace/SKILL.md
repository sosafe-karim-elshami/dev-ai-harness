---
name: harness-workspace
description: >
  Clones the repos the user maintains into the local workspace/ folder and keeps
  them updated, so other workflows can ground answers in real code. Trigger when
  the user says "clone my repos", "pull the projects I maintain", "set up my
  workspace", "update my repos", or after onboarding offers it. Reads the repo
  list from the profile; clones are the only side effect and the user confirms
  before any clone runs.
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
effort: medium
---

# Harness Workspace

Bring the user's maintained repos onto disk under `workspace/` (gitignored) and keep them fresh.

## Steps

1. **Read the profile** at `~/.claude/sosafe-harness/profile.json`. If missing, tell the user to run `/setup` first and stop. Take the `repos` array.
2. **Survey** `workspace/`: which repos are already cloned (`ls workspace/`), which are in the profile but missing, which are present but not in the profile.
3. **Plan and confirm.** Show the user:
   - Repos to **clone** (in profile, not on disk).
   - Repos to **update** (`git -C workspace/<name> fetch` + fast-forward `pull` only if clean).
   - Anything in `workspace/` not in the profile (leave alone; just note).
   Ask for confirmation before cloning/pulling. (Clones go through the safe-by-default model; `git push` is never part of this skill.)
4. **Clone** approved repos: `gh repo clone <full_name> workspace/<name>` (uses the user's gh auth). Default to the repo's default branch; don't switch branches.
5. **Update** approved existing repos: `git -C workspace/<name> fetch --all --prune`, then fast-forward `pull` **only if** the working tree is clean and on a tracking branch. Never overwrite local changes — if dirty, report and skip.
6. **Mark progress.** For each successfully cloned repo, set `cloned: true` in the profile and Write it back (validate with `jq empty`).
7. **Summarize**: cloned, updated, skipped (with reasons).

## Notes

- This skill never modifies remote state. It only reads (`fetch`/`pull`) and writes to the local `workspace/`.
- Grounding workflows (`harness-support-triage`, `harness-pm`) will Grep/Read these clones; keeping them current improves answer quality.
