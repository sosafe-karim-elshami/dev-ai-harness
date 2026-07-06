# Discovery recipe

Exact, read-only query sequence for `harness-onboarding`. All templates referenced live in `${CLAUDE_PLUGIN_ROOT}/definitions/discovery-queries.json`. Fill `{placeholders}` from what you've discovered so far.

## Ask vs. query — the rule

| Field | How | Why |
|---|---|---|
| name, email | prefill (query) → **confirm** | cheap to look up, must be right |
| role (free text) | **ask** | not reliably inferable |
| role_class | **ask** (offer the 3 labels) | drives every workflow's emphasis |
| github_login | query (`gh api user`) | authoritative |
| repos | query → **confirm/prune** | rankable, but the user knows ownership best |
| team, confluence spaces | query → **confirm** | inferred, needs a human check |
| jira project_keys | query (derive) → **confirm** | derived from issue-key prefixes |
| jira_account_id, cloud_id | query | authoritative |
| slack channels | query → **tag** (team/support/pr) | the search finds them; the user labels them |
| compass_alias | query (team_definitions.json) | deterministic lookup |
| sentry/datadog/amplitude | best-effort probe → **confirm** | monitoring tools; skip silently if absent |

## Sequence

1. `gh auth status` — abort with guidance if not authed.
2. `gh api user --jq '{login,name,email}'` → seed person.
3. `mcp__...atlassianUserInfo` → confirm name/email; `getAccessibleAtlassianResources` → `atlassian_cloud_id` (pick the SoSafe site; ask if multiple).
4. **Ask** role + role_class.
5. Repos: run `github.repos_recent_push`; union with `github.repos_i_authored_prs`; rank by `pushed_at` / PR count; present top ~15; user prunes and sets `role`.
6. Team: `searchConfluenceUsingCql` (`confluence.find_person_team_cql`) and `getTeamworkGraphContext` for people↔team; propose name + `confluence_space_keys`; confirm.
7. Jira: `getVisibleJiraProjects`; `searchJiraIssuesUsingJql` with `assignee = currentUser() ORDER BY updated DESC` (max ~50); tally key prefixes → candidate `project_keys`; confirm. `lookupJiraAccountId(email)` → `jira_account_id`.
8. Slack: `slack_search_users` ({name}/{email}) → `slack_user_id`; `slack_search_channels` with patterns from `slack.find_channels`; user tags **team_channels**, **support_channels**, **pr_channel_id**.
9. Compass alias: locate the installed metrics plugin's team file. It lives under the Claude plugins cache; find it with:
   ```bash
   find ~/.claude -path '*sosafe-engineering-metrics*team_definitions.json' 2>/dev/null | head -1
   ```
   Read it, fuzzy-match `team.name` → alias. If not found, leave `team.compass_alias` empty and set provenance `skipped`.
10. Monitoring (`integrations`): best-effort probe, then confirm. All optional — skip any tool that isn't present.
    - **Sentry:** if the `sentry` CLI is authenticated (`sentry auth status`), suggest `integrations.sentry.org` (`sentry org list --json`) and match `projects` to repo names (`sentry project list --json`); offer to record named `dashboards` (`sentry dashboard list --json`).
    - **Datadog:** if a Datadog connector/CLI is available, propose `integrations.datadog` (site, `monitor_tags` scoped to the team, named `dashboards`).
    - **Amplitude:** if configured, propose `integrations.amplitude` (`project_ids`, named `dashboards`).
    - Confirm with the user; set provenance `asked-user` for whatever they accept, `skipped` for the rest.

## Provenance

Set `discovery_provenance.<section>` to one of: `asked-user`, `github-api`, `confluence`, `jira`, `slack-search`, `team-definitions`, `skipped`. This makes it auditable why each value is what it is.

## Output contract

Write exactly one file: `~/.claude/sosafe-harness/profile.json`, conforming to `${CLAUDE_PLUGIN_ROOT}/definitions/profile.schema.json`. Nothing else is written; nothing remote is mutated.
