---
name: harness-pm
description: >
  Project-management workflow — Jira hygiene, sprint/status summaries, and PR
  tracking across the repos the user maintains, plus team metrics by delegating
  to Compass. Trigger on "how's the sprint?", "team status", "Jira hygiene",
  "what PRs need review?", "any stale tickets?", "give me a status update", or
  when /standup asks for the PM section. Reads scope from the profile. Read-only
  by default: it reports and proposes; any Jira change is batched and confirmed
  (and the guard hook gates it).
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(gh pr list:*)
  Bash(gh pr view:*)
  Bash(gh search:*)
  Bash(jq:*)
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__getTransitionsForJiraIssue
  mcp__claude_ai_Atlassian__transitionJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
effort: high
---

# Harness PM

Give the user a grounded picture of their work-in-flight and let them fix hygiene issues with one confirmation.

## Setup
Read `~/.claude/sosafe-harness/profile.json` (if missing → `/setup` first). Use `jira.project_keys`, `repos`, `team.compass_alias`, `preferences.sprint_length_days`, and `person.role_class`. Order/emphasize per `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json` (`pm_emphasis`). Query templates are in `${CLAUDE_PLUGIN_ROOT}/definitions/discovery-queries.json`.

## Capabilities (all read-only to gather; mutations are opt-in)

### 1. Jira hygiene
Run, scoped to `jira.project_keys`:
- **Stale in-progress** — `jira.stale_in_progress_jql`.
- **Missing estimates in sprint** — `jira.missing_estimate_jql`.
- **Unassigned active work** — `jira.unassigned_jql`.
Present findings grouped by problem (format in `report-templates.md`). For each, propose a concrete fix (assign, estimate, comment, transition). **Do not apply anything yet.**

### 2. Sprint / status summary
Summarize the active sprint: scope, done/in-progress/blocked counts, at-risk items, notable changes since the user's `sprint_length_days` window. Use the `report-templates.md` status format. This is purely read + summarize.

### 3. PR tracking
Across `repos` (use `gh pr list`/`gh search prs`): open PRs, drafts, PRs awaiting **the user's** review, PRs that are approved-but-unmerged, and stale PRs (no update > 3 days). Link each.

### 4. Metrics (delegate — do not rebuild)
For any metrics/scorecard/trend ask, hand off **by intent** to the `compass-analyst` skill from `sosafe-engineering-metrics`, e.g.: "Get scorecards for {compass_alias}, last {sprint_length_days} days, flag any gate regressions." If `compass_alias` is empty, say metrics are unavailable and suggest `/setup --field team`. Never reimplement Compass queries here.

## Applying fixes (gated)
If the user wants to act on hygiene findings:
1. Collect the chosen actions into one batch.
2. Show the full list — each issue key, the change, and the target value.
3. Ask **once**: "Apply these N changes? (yes/no)".
4. On yes, apply via `transitionJiraIssue` / `editJiraIssue` / `addCommentToJiraIssue`. The guard hook will also prompt per outward call — that's expected defense-in-depth.
5. Report what succeeded/failed.

Respect `preferences.confirm_outward_actions`: if `false`, you may skip the in-skill batch prompt, but the guard hook still fires.
