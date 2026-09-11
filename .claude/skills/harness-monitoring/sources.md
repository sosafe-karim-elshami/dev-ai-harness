# Monitoring sources

Per-tool probe recipes. Every source is optional: probe, use if present, note one line and
move on if absent. Never block on a missing tool.

## Sentry — via the `sentry` CLI (reuse the `sentry-cli` skill)

`sentry auth status` first; unauthenticated or CLI missing → note it and skip.
Scope with `integrations.sentry.org` and `integrations.sentry.projects`.

| What | Command |
|---|---|
| Unresolved errors | `sentry issue list <org>/<project> --query "is:unresolved" --json --fields shortId,title,level,count,userCount,permalink --limit 10` |
| Issue alert rules | `sentry alert issues list <org>/<project> --json` |
| Metric alert rules | `sentry alert metrics list <org> --json` |
| Cron monitors | `sentry monitor list <org>/<project> --json` — flag anything not `ok` |
| Releases | `sentry release list <org>/<project> --json` — recent release + adoption/health |
| Dashboards | `sentry dashboard list <org> --json`; `sentry dashboard view` the ones named in `integrations.sentry.dashboards`; `-w` gives the web URL |

Lead with high `count` / `userCount`. Prefer dedicated commands over `sentry api`. Always
`--json --fields` to keep output small. Link rather than dumping raw numbers.

## Datadog

`mcp__claude_ai_Datadog__*` present → list monitors scoped by
`integrations.datadog.monitor_tags` and read the named `dashboards`. Flag monitors in
`Alert`, `Warn`, or `No Data`. Otherwise a configured read-only `datadog-ci`/API path. Neither
available → one-line skip.

## Amplitude

Connector present, or `integrations.amplitude.project_ids` + credentials exist → surface the
named dashboards/charts. Link them; summarize headline metrics only. Otherwise skip silently.

## Compass — H2 Pillar 1 hygiene, not optional

Delegate to `compass-analyst` by intent for the team's scorecard: **ownership** set,
**security score**, and **CD adoption**. These are H2 OKR inputs, so they belong in every
scan alongside Sentry — not just when asked. Empty `team.compass_alias` → say so in one line
and suggest `/setup --field team`.

## Role emphasis

Per `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json` → `person.role_class`:

- **ic** — errors touching my repos first.
- **manager / staff** — team-wide alerting, SLA and error-budget risk, cross-service trends,
  Compass gate regressions.
