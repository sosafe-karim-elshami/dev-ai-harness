---
name: harness-onboarding
description: >
  Bootstraps the harness for whoever is running it — discovers their identity,
  team, repos, Jira projects, and Slack channels, then persists a reusable
  profile. Trigger on first run, when ~/.claude/sosafe-harness/profile.json is
  missing or has the wrong schema_version, or whenever the user says "set me
  up", "onboard me", "refresh my context/profile", "/setup", or asks a
  role-aware question (standup, triage, meeting, team status) while no profile
  exists. Supports re-discovering a single section via "--field <name>".
  Discovery is READ-ONLY across GitHub/Jira/Confluence/Slack; the only thing it
  writes is the local profile file. Always confirm auto-discovered values with
  the user before saving.
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Bash(gh api:*)
  Bash(gh search:*)
  Bash(gh auth status)
  Bash(mkdir -p:*)
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__atlassianUserInfo
  mcp__claude_ai_Atlassian__getAccessibleAtlassianResources
  mcp__claude_ai_Atlassian__getVisibleJiraProjects
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__lookupJiraAccountId
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getTeamworkGraphContext
  mcp__claude_ai_Slack__slack_search_users
  mcp__claude_ai_Slack__slack_search_channels
effort: high
---

# Harness Onboarding

Discover who the user is and what they maintain, then write a validated profile to `~/.claude/sosafe-harness/profile.json`. Every other harness workflow reads that file. **The harness is generic — nothing about any team is hardcoded. It all comes from discovery.**

## Principles

- **Query first, ask only to fill gaps or confirm.** Don't ask for things you can look up.
- **Read-only discovery.** Use only `get*`/`search*` tools and `gh api`/`gh search` GETs. The single write is the profile file.
- **Confirm before persisting.** Show the user every auto-discovered value. Record how each section was found in `discovery_provenance`.
- **Degrade gracefully.** If an integration is unavailable or the user declines, mark that section `skipped` and continue.

## Steps

### 0 — Pre-flight & existing profile
- Run `gh auth status`. If it fails, tell the user to run `gh auth login` and stop.
- Read `~/.claude/sosafe-harness/profile.json` if it exists.
  - If present and `schema_version == 1` and the user didn't ask to refresh → summarize it and ask whether to refresh all, refresh one `--field`, or keep as-is.
  - If `--field <name>` was given, re-run only that section (below) and merge.

### 1 — Person (ASK + confirm)
- Prefill name/email from `mcp__...atlassianUserInfo` and `gh api user`.
- Ask the user to confirm name/email and to give their **role** (free text) and pick a **role_class**: `ic`, `manager`, or `staff` (show the labels from `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`).
- `github_login` from `gh api user`. `jira_account_id` via `lookupJiraAccountId` (their email). `atlassian_cloud_id` from `getAccessibleAtlassianResources` (use the SoSafe site; if several, ask). `slack_user_id` via `slack_search_users`.

### 2 — Repos (QUERY → CONFIRM)
- Use the `github.repos_recent_push` and `github.repos_i_authored_prs` templates in `${CLAUDE_PLUGIN_ROOT}/definitions/discovery-queries.json`. Rank by recent push / PR authorship. Cross-check CODEOWNERS where cheap.
- Present the ranked list; let the user prune and mark each `role` (maintainer/contributor/...). Default `cloned: false`.

### 3 — Team & Confluence (QUERY → CONFIRM)
- `searchConfluenceUsingCql` with `confluence.find_person_team_cql` and `getTeamworkGraphContext` (people↔team links) to propose a team name + space keys. Confirm with the user.

### 4 — Jira (QUERY → CONFIRM)
- `getVisibleJiraProjects` + `searchJiraIssuesUsingJql` with `jira.my_recent_issues_jql`; tally key prefixes to derive candidate `project_keys` (see `jira.derive_project_keys`). Confirm; ask for a default board id if the user knows it.

### 5 — Slack (QUERY → CONFIRM)
- `slack_search_channels` with the `slack.find_channels` patterns around the team name. Ask the user to tag which are **team**, **support**, and the **pr** channel.

### 6 — Compass alias & other integrations (QUERY, best-effort)
- Resolve `compass_alias`: read `team_definitions.json` from the installed `sosafe-engineering-metrics` plugin (search for it under the Claude plugins dir; see `discovery-recipe.md`) and fuzzy-match the team name. If not found, leave empty and note it.
- Sentry/Amplitude: best-effort match by repo name; skip silently if unavailable.

### 7 — Build, validate, confirm, write
- Assemble the object per `${CLAUDE_PLUGIN_ROOT}/definitions/profile.schema.json`. Set `schema_version: 1`, `generated_at` to `date -u +%Y-%m-%dT%H:%M:%SZ`, and fill `discovery_provenance`.
- **Show the user the full profile** and ask for final approval.
- On approval: `mkdir -p ~/.claude/sosafe-harness` and `Write` the JSON. Validate it: `jq empty ~/.claude/sosafe-harness/profile.json` (and, if a validator is handy, against the schema).
- Offer next steps: "Clone your repos into `workspace/`? (harness-workspace)" and "Run `/standup`?".

See `discovery-recipe.md` for the exact query sequence and the ask-vs-query rules per field.
