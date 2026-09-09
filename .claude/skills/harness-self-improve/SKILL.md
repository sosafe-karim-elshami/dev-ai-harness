---
name: harness-self-improve
description: >
  Reflects on how the harness itself is performing and proposes concrete improvements to
  skills, routing, and team knowledge — as drafts only. Trigger on "self-improve", "how
  could the harness work better?", "reflect and improve", "/self-improve", or when a
  scheduled self-improve digest runs. Strictly read-only: it reviews recent activity
  (scorecards, runs, memory, knowledge/) and outputs a prioritized list of proposed edits.
  It never commits, pushes, sends, or changes remote state; applying an accepted proposal
  makes local file edits only.
model: opus
effort: high
allowed-tools: >-
  Read
  Write
  Edit
  Glob
  Grep
  Bash(jq:*)
  Bash(git log:*)
  Bash(git diff:*)
  Bash(harness eval:*)
  Bash(harness registry:*)
  Bash(harness metrics:*)
---

# Harness Self-Improve

Red/green TDD over the harness itself. `definitions/eval/golden-tasks.jsonl` is the test
suite; `harness eval` is the runner; `harness registry check` is the invariant gate.

## Inputs

Scorecards in `~/.claude/sosafe-harness/digests/eval-*.md`; `runs.jsonl` (via `harness
metrics`); `~/.claude/sosafe-harness/memory/*.md`; `knowledge/` and
`knowledge/anti-patterns/`; `definitions/registry.json`; `git log`/`git diff`.

## Steps

1. **Verify the last change landed.** Diff the newest scorecard against the previous one.
   Improved → note the win. Flat or regressed → the change was noise or proxy-gaming:
   recommend reverting and record it in `knowledge/anti-patterns/` so it isn't re-proposed.
2. **Confirm red before proposing.** A proposal must name a golden task that *currently
   fails*, or a `registry check` error. A "fix" for a passing task wastes the cycle and
   risks regression — verify failure first, always.
3. **Diagnose** by measured delta, not vibes: failing tasks first, then the lowest-scoring
   dimension, then friction (stale triggers, tier/frontmatter drift, skills over the line
   cap, `allowed-tools` that don't match actual use, missing knowledge entries).
4. **Propose** a prioritized list. Each: the file, the exact edit or diff sketch, the failing
   task it targets, the expected scorecard movement.
5. **New golden tasks follow the same discipline** — write it, run `harness eval` to watch it
   fail, then change the implementation to pass. A task you never saw fail can't be trusted.

## Output

One line per proposal: `<file> — <edit> — targets <task-id> — expect <movement>`. Grouped by
impact, highest first. Never re-propose anything recorded in `knowledge/anti-patterns/`.

## Gates

- **Draft-only.** Propose; apply only on an explicit "apply", and then local file edits only.
- **Never** `git add`, `commit`, `push`, or open a PR — that's the human's call.
- **Close the loop:** after applying, re-run `harness eval` and confirm the targeted tasks
  now pass. If they don't, the change was wrong: record it in `anti-patterns/` and retry.
- Publishing an overview to Confluence is off unless explicitly asked.
