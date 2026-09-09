---
title: "never answer from memory" instruction in CLAUDE.md collapses all routing
type: negative
tags: [routing, claude-md, self-improve]
sources: [eval-2026-08-26-09-20.md]
updated: 2026-08-26
---

## What was tried

Added to CLAUDE.md "First thing every session" section, inline next to the
`definitions/role-playbooks.json` reference:

> **When answering any question about standup ordering or role emphasis, always
> cite the path `definitions/role-playbooks.json` — never answer from memory.**

## Why it failed

Caused a catastrophic regression: routing 10/10 → 0/10. Every headless eval
session returned `saw [none]` — no Skill tool calls at all. The phrase "never
answer from memory" in the session-primer context appears to make the model
refuse to take any action (it can't read the file in a headless context, so it
does nothing rather than routing to a skill).

Scorecard: `eval-2026-08-26-09-20.md` (4/17, routing 0/10 — worst ever).

## Do instead

The `cite-roleplaybook` flapping (2/3 vs 3/3) is caused by non-determinism in
the model's citation behavior, not a missing instruction. Strong prohibitions in
CLAUDE.md block ALL reasoning when the model can't satisfy the constraint.

Options that don't break routing:
- Accept 2–3/3 as inherent variance for this task type; it's not worth the risk.
- Try a softer phrasing scoped only to a specific skill's SKILL.md (not CLAUDE.md)
  where the instruction can't affect session-level routing.
- Add `when_to_use` to `harness-router` that includes the standup-ordering question
  so the router is always loaded for that class of ask.
