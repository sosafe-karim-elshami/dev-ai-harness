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
  Bash(harness metrics:*)
  mcp__claude_ai_Atlassian__createConfluencePage
effort: high
---

# Harness Self-Improve

A safe, draft-only reflection loop for the harness. Adapted from the
self-improving-agent pattern (auto-memory curation) but scoped to *this* harness
and gated by the guard hook. Read `~/.claude/sosafe-harness/profile.json` first.

## What it does

1. **Gather signal (read-only):**
   - **The eval scorecard first.** Read the newest `eval-*.md` in `~/.claude/sosafe-harness/digests/` — this is the harness's honest signal (routing / read-only / citations / grounding), and it is what you optimize *against*. If none exists, say so and recommend the user run `harness eval` before you propose anything: without a verifier, self-improvement drifts into hacking a proxy you can't see (Weng's #1 bottleneck).
   - **Observability metrics** — run `harness metrics --json` (or read it): skill coverage, per-skill usage, success rate, staleness, and **orphan logs** (a skill logged but gone from disk = drift). A never-invoked skill is undiscovered or dead; a low success rate is a concrete failing target; an orphan log is a rename that broke a reference.
   - Recent run digests in the same folder — what runs produced, and any errors.
   - Session activity via `harness sessions` context (frequency, resets).
   - Injected memory in `~/.claude/sosafe-harness/memory/*.md`, and the negative-results store `knowledge/anti-patterns/` — never re-propose something recorded there as already tried and failed.
   - The `knowledge/` folder and the `.claude/skills|commands` in the repo.
   - `git log`/`git diff` for what changed recently (never write).
2. **Verify the last change landed.** Diff the newest scorecard against the previous one. Did the last accepted proposal actually move the numbers?
   - **Improved** → note the win.
   - **Flat or regressed** → the change was reward-hacking or noise. Recommend reverting it and record it in `knowledge/anti-patterns/` so it isn't re-proposed. This is the loop's guard against diversity collapse and gaming the proxy.
3. **Mine weaknesses (diagnose):** rank issues by **measured eval delta**, not by vibes — start with the golden tasks that are *failing* and the dimension with the lowest score. Then add qualitative friction (repetition, stale routing, skills whose triggers/allowed-tools don't match use, missing knowledge entries). A proposal with no plausible eval impact is lowest priority.
4. **Propose (drafts):** output a prioritized list. For each: the file to touch, the exact edit or a tight diff sketch, the failing task/dimension it targets, and the expected scorecard movement. Group by impact.
5. **Self-document:** offer to distill durable lessons into a new/updated `knowledge/` entry — wins to `knowledge/`, losses to `knowledge/anti-patterns/` (committed, team-private, PR-reviewed). Follow the respective README format.

## Applying proposals

- Only when the user says "apply": make the **local file edits** described. Do **not** `git add`, `git commit`, `git push`, or open a PR — leave that to the human (the guard hook enforces this for outward actions).
- **Close the loop:** after applying, recommend the user re-run `harness eval` so the next scorecard measures whether the change actually helped. That scorecard becomes the input to the next self-improve pass (the `prompt → context → workflow → harness code` optimization chain, with a real evaluator at the end of it).
- Optionally publish a generated overview to a private Confluence space via `createConfluencePage` — **gated, off unless explicitly asked**.

## Hard rules

- Read-mostly. No sends, no transitions, no commits, no pushes.
- In autonomous/scheduled runs (`HARNESS_AUTONOMOUS=1`) stay purely advisory: produce the proposal list for the digest and stop.
- Ground every proposal in something you observed (cite the file/digest/log). Never invent.
