# Anti-patterns — the negative-results store

Committed, shareable memory of **what didn't work** — wrong answers, dead-end
routes, and approaches the team has already tried and rejected.

Weng's *"Harness Engineering for Self-Improvement"* names **negative results** as
one of the seven bottlenecks: models (and harnesses) are trained and grown on
successes, so they rarely learn to abandon a bad hypothesis or avoid repeating a
known mistake. The rest of `knowledge/` records wins (support FAQs, runbooks);
this folder deliberately records losses so the harness stops making them twice.

## When an entry gets written

- **`harness-support-triage`** — after a drafted answer turns out to be wrong
  (the asker corrects it, or it's later disproven), it offers to record the
  mistake here, not just delete it.
- **`harness-self-improve`** — when a proposal is applied and the next
  `harness eval` scorecard does **not** improve (or regresses), the reverted
  change is logged here so it isn't re-proposed.
- **You, directly** — drop in a Markdown file whenever you catch the harness (or
  yourself) repeating a known dead end.

## How it's used

Both `harness-support-triage` and `harness-self-improve` check this folder
**alongside** the FAQ/runbook lookup *before* answering or proposing — a match
here is a hard "don't go this way again," with the reason.

## Format

```markdown
---
title: <short description of the mistake>
type: negative
tags: [<repo-or-area>, support|routing|self-improve]
sources: [<jira-key>, <slack-permalink>, <eval-scorecard-file>]
updated: 2026-07-09
---

## What was tried
<the answer/route/approach that failed>

## Why it failed
<the correction, the disproof, or the eval delta that showed it didn't help>

## Do instead
<the better path, or "still open — just don't repeat the above">
```

Keep entries short and link out. An entry that becomes obsolete should be removed
(surface it via `harness memory audit`), not left to mislead.
