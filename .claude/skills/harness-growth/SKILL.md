---
name: harness-growth
description: >
  Career growth and visibility coach for ICs. Audits the gap between work done and work made
  visible, tracks IDP progress, surfaces knowledge-sharing opportunities from private notes,
  preps growth-focused 1:1 agendas, and flags stale open work. Trigger on "how's my career
  going?", "1:1 growth prep", "what should I present?", "visibility gap", "IDP check",
  "knowledge sharing prep", "level up", "how do I get a raise?", "turn my work into a
  talk/slides", or whenever a 1:1 with a manager is being prepped and the user mentions
  growth, salary, or career.
model: opus
effort: medium
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Skill
  Bash(gh pr list:*)
  Bash(gh pr view:*)
  Bash(gh search:*)
  Bash(jq:*)
  Bash(find:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Atlassian__createConfluencePage
  mcp__claude_ai_Google_Calendar__list_events
---

# Harness Growth

Five modes: **visibility-audit**, **idp-check**, **talk-prep**, **11-prep**,
**stale-work-radar**. Steps per mode in **`modes.md`**; the visibility ladder and the honesty
rules in **`principles.md`** — read that first, it's what makes this skill worth running.

## Inputs

`profile.json` (missing → `/setup`): `repos`, `person.github_login`,
`person.jira_account_id`. `$VAULT` from `config.json` → `vaultPath`. The user's `IDP.md` if
present — read-only, always.

## Steps

1. Pick the mode from the ask; ambiguous → run **visibility-audit**, the default entry point.
2. Run that mode's steps from `modes.md`.
3. Place every significant item on the visibility ladder (`principles.md`) and report the gap,
   not just the work.
4. Apply the rules in `principles.md` without softening them. If the evidence contradicts the
   user's self-assessment, say so in the first line.
5. Close with exactly one highest-ROI next action — specific artifact, specific date.

## Output

Three buckets or one line per goal, depending on mode. Every claim carries its PR link, Jira
key, or Confluence URL. Then the single next action. Longer artifacts (talk outlines, 1:1
agendas) go to `$VAULT/growth/` — in chat, give the headline and the path.

## Gates

- **Never write `IDP.md`.** Read it; the user owns it.
- Publishing to Confluence or creating a Slides deck (`gws-slides`) is gated on explicit
  confirmation, batched once, naming the target.
- Vault writes under `$VAULT/growth/` are local and safe.
