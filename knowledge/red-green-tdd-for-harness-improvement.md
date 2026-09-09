---
title: Red/Green TDD for harness self-improvement
tags: [harness, self-improve, eval, agentic-patterns]
sources: [https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/]
updated: 2026-08-26
---

## Situation

The harness evolves through `harness-self-improve` cycles: read the eval scorecard,
propose skill/routing changes, apply them, re-run `harness eval`. Without explicit
TDD discipline, the loop can propose "improvements" that have no measurable impact or
that break passing tasks.

## Answer

The self-improve loop IS a red/green TDD loop over the harness. Apply the discipline
explicitly:

**Red** — before proposing any fix, confirm the target golden task is actually failing
in the current `eval-*.md` scorecard. A proposal without a red task is untestable.

**Green** — apply the minimal change (skill file, routing table, command file) and
re-run `harness eval` to confirm the task now passes. If it doesn't, the change is
wrong — don't commit it.

**Never skip verifying red.** If you propose a fix for a task that already passes,
you're not improving the harness — you're adding noise and regression risk.

**New golden tasks follow the same rule:** write the task in
`definitions/eval/golden-tasks.jsonl`, run `harness eval` to confirm it fails (red),
then change the routing/skill to make it pass (green). A task you never saw fail
proves nothing.

## Why this matters for agents specifically

Simon Willison's agentic engineering patterns note: "A significant risk with coding
agents is that they might write code that doesn't work, or build code that is
unnecessary and never gets used, or both." The same risk applies to harness changes
— an agent proposing skill edits without a failing eval task can introduce changes
that look plausible but are never exercised. The eval + red/green gate closes this.

## Worked example (2026-08-26)

1. Scorecard showed `route-standup` failing — RED confirmed.
2. Changed "invoke `harness-pm`" → "call the **`harness-pm`** skill (Skill tool)" in
   `standup.md`.
3. Re-ran `harness eval` — `route-standup` ✓, routing improved 8/9 → 9/10 — GREEN.
4. New failure `route-self-improve` appeared → RED confirmed, targeting the same
   "invoke vs. Skill tool" ambiguity in the routing table.
5. Added "How to route" anchor to `CLAUDE.md` and `harness-router/SKILL.md` →
   pending green run.
