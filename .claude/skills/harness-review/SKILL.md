---
name: harness-review
description: >
  The single review entry point. Classifies a diff, branch, or PR and dispatches to the
  reviewers that actually apply — security, architecture boundaries, defects, quality — then
  merges their verdicts into one ranked list. Trigger on "review this", "review my changes",
  "review this PR", "is this ready to merge?", "check this branch", or before opening a PR.
  Read-only: it reports and ranks findings; it never pushes, merges, or edits code.
model: opus
effort: high
allowed-tools: >-
  Read
  Glob
  Grep
  Task
  Skill
  Bash(git diff:*)
  Bash(git log:*)
  Bash(git status:*)
  Bash(git branch:*)
  Bash(gh pr view:*)
  Bash(gh pr diff:*)
  Bash(gh pr list:*)
  Bash(jq:*)
---

# Harness Review

Pick the lenses this diff actually needs, run them in parallel, and merge. The specialist
skills own the rubrics — this skill owns *which* of them to run and how to reconcile them.

## Inputs

The diff: `git diff` against the merge base, or `gh pr diff <n>` for a PR. `profile.json` for
repo scope; `system.json` for ownership and service boundaries. `knowledge/anti-patterns/` —
check it before reporting anything.

## Steps

1. **Resolve the diff.** No argument → `git diff $(git merge-base HEAD main)...HEAD`. A PR
   number or URL → `gh pr diff`. Empty diff → say so in one line and stop.
2. **Classify** which lenses apply, from the changed paths and content:

   | Lens | Applies when |
   |---|---|
   | `security` | auth, input handling, secrets, crypto, deserialization, SQL, file I/O, Dockerfiles, new endpoints, dependency bumps |
   | `boundaries` | cross-service calls, shared tables, new APIs, package/module graph changes, anything under a Pillar 4 decoupling path |
   | `defects` | always |
   | `quality` | always, unless the diff is under ~20 lines |

3. **Fan out.** Spawn one `review-lens` subagent (Task tool) per applicable lens, in parallel.
   Each returns JSON findings with a verdict. Never review inline — the lenses are independent
   and a single pass blurs them.
4. **Merge.** Deduplicate by `file:line`, keeping the highest severity and noting which lenses
   agreed — cross-lens agreement is the strongest signal in the report. Drop anything a lens
   returned with `confirmed: false`.
5. **Rank** by severity, then by cross-lens agreement, then by blast radius from `system.json`.

## Output

Lead with the merge verdict — `block`, `comment`, or `approve` — and the single most important
finding. Then one line per finding:

```
<sev> <file>:<line> — <the defect> — <lens(es)>
```

Cap at ten; state the total if you truncated. No lens-by-lens sections: the user wants the
diff's verdict, not four reports. Name any lens that found nothing in the closing line.

## Gates

Read-only. Never push, merge, commit, or edit code — opening the PR belongs to
`sosafe-pr-workflow`, and autonomous code changes to `sosafe-ai-harness-task-to-pr`. Posting
review comments to GitHub is an outward action: batch, confirm once, guard hook gates it.
