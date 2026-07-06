---
name: harness-self-improve
description: >
  Reflects on how the harness itself is performing and proposes concrete
  improvements to skills, routing, and team knowledge — as drafts only. Trigger
  on "self-improve", "how could the harness work better?", "reflect and improve",
  "/self-improve", or when a scheduled self-improve digest runs. Strictly
  read-only: it reviews recent activity (digests, sessions, memory, knowledge/)
  and outputs a prioritized list of proposed edits. It never commits, pushes,
  sends, or changes remote state; applying an accepted proposal makes local file
  edits only.
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Bash(git status:*)
  Bash(git log:*)
  Bash(git diff:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__createConfluencePage
effort: high
---

# Harness Self-Improve

A safe, draft-only reflection loop for the harness. Adapted from the
self-improving-agent pattern (auto-memory curation) but scoped to *this* harness
and gated by the guard hook. Read `~/.claude/sosafe-harness/profile.json` first.

## What it does

1. **Gather signal (read-only):**
   - Recent digests in `~/.claude/sosafe-harness/digests/` — what runs produced, and any errors.
   - Session activity via `harness sessions` context (frequency, resets).
   - Injected memory in `~/.claude/sosafe-harness/memory/*.md`.
   - The `knowledge/` folder and the `.claude/skills|commands` in the repo.
   - `git log`/`git diff` for what changed recently (never write).
2. **Diagnose:** find friction, repetition, gaps, stale routing, missing knowledge entries, and skills whose triggers/allowed-tools don't match how they're used.
3. **Propose (drafts):** output a prioritized list. For each: the file to touch, the exact edit or a tight diff sketch, and why. Group by impact.
4. **Self-document:** offer to distill durable lessons into a new/updated `knowledge/` entry (committed, team-private, PR-reviewed). Follow `knowledge/README.md` format.

## Applying proposals

- Only when the user says "apply": make the **local file edits** described. Do **not** `git add`, `git commit`, `git push`, or open a PR — leave that to the human (the guard hook enforces this for outward actions).
- Optionally publish a generated overview to a private Confluence space via `createConfluencePage` — **gated, off unless explicitly asked**.

## Hard rules

- Read-mostly. No sends, no transitions, no commits, no pushes.
- In autonomous/scheduled runs (`HARNESS_AUTONOMOUS=1`) stay purely advisory: produce the proposal list for the digest and stop.
- Ground every proposal in something you observed (cite the file/digest/log). Never invent.
