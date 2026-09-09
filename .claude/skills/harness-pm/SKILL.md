---
name: harness-pm
description: >
  Project-management workflow — Jira hygiene, sprint/status summaries, and PR tracking
  across the repos the user maintains, plus team metrics by delegating to Compass. Trigger
  on "how's the sprint?", "team status", "Jira hygiene", "what PRs need review?", "any
  stale tickets?", "give me a status update", or when /standup asks for the PM section.
  Reads scope from the profile. Read-only by default: it reports and proposes; any Jira
  change is batched and confirmed, and the guard hook gates it.
model: sonnet
effort: high
allowed-tools: >-
  Read
  Glob
  Grep
  Task
  Skill
  Bash(jq:*)
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__getTransitionsForJiraIssue
  mcp__claude_ai_Atlassian__transitionJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
---

# Harness PM

Show the user their work-in-flight, and let them fix hygiene with one confirmation.

## Inputs

`~/.claude/sosafe-harness/profile.json` (missing → `/setup`): `jira.project_keys`, `repos`,
`team.compass_alias`, `preferences.sprint_length_days`, `person.role_class`. Emphasis per
`definitions/role-playbooks.json` → `pm_emphasis`. Render formats in `report-templates.md`.

## Steps

1. **Scatter the sweep.** Spawn the `pm-scan` subagent (Task tool) for Jira hygiene + the PR
   sweep. It returns JSON. Don't run those queries inline — that's what the subagent is for.
2. **Sprint/status ask** → summarize the active sprint from the scan: scope, done/in-progress/
   blocked counts, at-risk items, changes inside the `sprint_length_days` window.
3. **Metrics ask** → hand off by intent to `compass-analyst`: "Scorecards for
   {compass_alias}, last {sprint_length_days} days, flag gate regressions." Empty
   `compass_alias` → say metrics are unavailable, suggest `/setup --field team`. Never
   reimplement Compass queries.
4. **Render** grouped by problem, ordered by `definitions/urgency-matrix.json`, each line
   carrying its own link and proposed fix. Propose only — apply nothing yet.

## Output

Per `report-templates.md`. One line per finding with its key/PR link, the problem, and the
one-line fix. Totals when the list is truncated.

## Gates

Applying fixes: collect every chosen action into **one** batch, show each key + change +
target value, ask once — "Apply these N changes? (yes/no)" — then apply via
`transitionJiraIssue` / `editJiraIssue` / `addCommentToJiraIssue` and report success/failure.
The guard hook prompts per call as defense-in-depth. `preferences.confirm_outward_actions:
false` may skip the in-skill batch prompt; the hook still fires.
