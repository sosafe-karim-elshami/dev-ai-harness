# Handoff prompt → `sosafe-ai-harness-task-to-pr:implement-task`

Invoke the skill with exactly this task text (fill the placeholders). It owns the
developer/reviewer/tester loop and its own `harness-verify.mjs` pass; `/ship` re-verifies
independently afterwards and opens the PR itself.

```
Task: <KEY> — <summary>

The acceptance criteria are the numbered contract below. Every row is a requirement;
never drop one when you synthesize the task for your agents.

<contents of features/<KEY>/contract.md, verbatim>

Discovered commands (already resolved; agree with your own Step 2 discovery or stop and say why):
- lint: <cmd or "not available">
- test: <cmd or "not available">
- build: <cmd or "not available">
- typecheck: <cmd or "not available">

Branch: <task/KEY-kebab> already exists and is checked out in a worktree — skip your Step 3a.
features/<KEY>/contract.md and usage.md are already committed; write plan.md and state.md
beside them as usual.

Stop after your Step 7 report. Do NOT run your Step 8 — the caller opens a DRAFT PR and
handles Jira. Do not run sosafe-branching-pr or sosafe-exp-squad-pr.
```

Autonomous mode appends:

```
The plan was pre-approved by the contract approval at <timestamp>; treat your Step 3 as
approved and continue. If you must ask the human anything, print `SHIP_BLOCKED: <question>`
on its own line and stop instead of waiting.
```

`/ship` scans the skill's output for `SHIP_BLOCKED` and stops with that reason.
