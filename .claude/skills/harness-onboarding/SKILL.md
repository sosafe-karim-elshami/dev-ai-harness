---
name: harness-onboarding
description: >
  Bootstraps the harness for whoever is running it — discovers their identity, team, repos,
  Jira projects, and Slack channels, then persists a reusable profile, scaffolds their
  knowledge vault, and derives the system map. Trigger on first run, when
  ~/.claude/sosafe-harness/profile.json is missing or has the wrong schema_version, or
  whenever the user says "set me up", "onboard me", "refresh my context/profile", "/setup",
  or asks a role-aware question while no profile exists. Supports re-discovering a single
  section via "--field <name>". Discovery is READ-ONLY across GitHub/Jira/Confluence/Slack;
  the only writes are local. Always confirm auto-discovered values before saving.
model: sonnet
effort: high
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
  Bash(harness graph:*)
  Bash(bash:*)
  mcp__claude_ai_Atlassian__atlassianUserInfo
  mcp__claude_ai_Atlassian__getAccessibleAtlassianResources
  mcp__claude_ai_Atlassian__getVisibleJiraProjects
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__lookupJiraAccountId
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getTeamworkGraphContext
  mcp__claude_ai_Slack__slack_search_users
  mcp__claude_ai_Slack__slack_search_channels
---

# Harness Onboarding

Discover who the user is and what they maintain, then persist it. Every other workflow reads
what this writes. **Nothing about any team is hardcoded — it all comes from discovery.**

## Inputs

`definitions/discovery-queries.json` (templates), `definitions/profile.schema.json` (shape),
`definitions/role-playbooks.json` (the three `role_class` labels). The exact query sequence
and the ask-vs-query rule per field: **`discovery-recipe.md`** — follow it, don't improvise.

## Steps

1. `gh auth status` — fails → tell the user to run `gh auth login` and stop.
2. Existing profile with `schema_version == 1` and no refresh asked → summarize it and offer:
   refresh all, refresh one `--field`, or keep. `--field <name>` → re-run only that section.
3. Run the sequence in `discovery-recipe.md` (person → repos → team → Jira → Slack → Compass
   → monitoring). **Query first; ask only to fill gaps or confirm.**
4. Show the user the full assembled profile and get explicit approval. Record
   `discovery_provenance` per section so every value is auditable.
5. Write `~/.claude/sosafe-harness/profile.json`; validate with `jq empty`.
6. Scaffold the vault: run `scaffold-vault.sh`, then record `vaultPath` in
   `~/.claude/sosafe-harness/config.json`.
7. Derive the system map: `harness graph build --system` → `system.json` (ownership and
   dependencies from GitHub + Compass). Failure is non-fatal — note it and continue.
8. Offer next: clone repos (`harness-workspace`), then `/standup`.

## Output

The profile summary as a short field list, then the three paths written. Not the JSON.

## Gates

- **Read-only discovery.** Only `get*`/`search*` tools and `gh api`/`gh search` GETs.
- **Confirm before persisting.** Never save a value the user hasn't seen.
- **Degrade gracefully.** Unavailable integration or a declined section → mark it `skipped`
  and continue. A partial profile beats no profile.
- Writes are local only: `profile.json`, `config.json`, `system.json`, the vault scaffold.
