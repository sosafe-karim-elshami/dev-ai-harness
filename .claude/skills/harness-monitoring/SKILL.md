---
name: harness-monitoring
description: >
  Surfaces production health from the team's monitoring/observability tools —
  Sentry (issues, alerts, cron monitors, releases), Datadog (monitors,
  dashboards), and Amplitude (product analytics) — grounded in the user's
  profile. Trigger on "any errors?", "how's production?", "what's alerting?",
  "show me Sentry issues", "Datadog monitors", "monitoring", "/monitoring", or
  when /standup or the dashboard runs the monitoring scan. Read-only: it reports
  and links; it never resolves issues, edits alerts, or changes dashboards
  unless the user explicitly asks (and that is gated).
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(sentry issue list:*)
  Bash(sentry issue view:*)
  Bash(sentry issue events:*)
  Bash(sentry alert issues list:*)
  Bash(sentry alert metrics list:*)
  Bash(sentry monitor list:*)
  Bash(sentry dashboard list:*)
  Bash(sentry dashboard view:*)
  Bash(sentry release list:*)
  Bash(sentry org list:*)
  Bash(sentry project list:*)
  Bash(sentry auth status:*)
  Bash(sentry api:*)
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Datadog__*
  mcp__claude_ai_Sentry__*
  mcp__claude_ai_Amplitude__*
effort: high
---

# Harness Monitoring

Give the user a grounded, read-only picture of production health across whatever
observability tools they actually have connected. **"If available" is the whole
design:** probe each integration, use it if present, skip it silently (one line
noting it's not configured) if not. Never block on a missing tool.

## Setup
Read `~/.claude/sosafe-harness/profile.json` (missing → `/setup`). Use
`integrations.sentry`, `integrations.datadog`, `integrations.amplitude`, and
`repos` to scope. Order/emphasize per `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`
(`person.role_class`): ICs → errors touching my repos; managers/staff → team-wide
alerting, SLA/error-budget risk, cross-service trends.

## Sources (probe in this order; each is optional)

### Sentry (via the `sentry` CLI — reuse the `sentry-cli` skill)
Check `sentry auth status` first; if unauthenticated or the CLI is missing, note it and move on.
- **Errors:** `sentry issue list <org>/<project> --query "is:unresolved" --json --fields shortId,title,level,count,userCount,permalink --limit 10` per project in `integrations.sentry.projects` (use `integrations.sentry.org`). Lead with high `count`/`userCount`.
- **Alerts:** `sentry alert issues list <org>/<project> --json` and `sentry alert metrics list <org> --json` — which rules exist and which are firing.
- **Cron monitors:** `sentry monitor list <org>/<project> --json` — flag any not `ok`.
- **Releases:** `sentry release list <org>/<project> --json` — recent release + adoption/health when relevant.
- **Dashboards:** `sentry dashboard list <org> --json`; if `integrations.sentry.dashboards` names specific ones, `sentry dashboard view` them and summarize key widgets. Always link (`-w` gives the web URL) rather than dumping raw numbers.
- Prefer dedicated commands over `sentry api`; use `--json --fields` to keep output small.

### Datadog (if a Datadog connector/CLI is available)
- If `mcp__claude_ai_Datadog__*` tools are present, use them to list monitors (scoped by `integrations.datadog.monitor_tags`) and read named `dashboards`; flag monitors in `Alert`/`Warn`/`No Data`.
- Otherwise, if a `datadog-ci`/API path with credentials is configured, use it read-only. If neither is available, skip with a one-line note.

### Amplitude (if configured)
- If an Amplitude connector is present, or `integrations.amplitude.project_ids` + credentials exist, surface the named `dashboards`/charts (link them; summarize headline metrics only). Skip silently otherwise.

## Output
Produce a compact **Monitoring** report, role-ordered, sections omitted when empty:
- **Errors (Sentry)** — top unresolved issues with counts + links.
- **Alerting** — Sentry alert rules + Datadog monitors currently firing.
- **Health** — cron monitors, release adoption, error-budget/SLA notes.
- **Analytics** — Amplitude headline charts (links).
- **Dashboards** — links to the Sentry/Datadog/Amplitude dashboards named in the profile.
End with: "Not configured: <tools skipped>. Add them with `/setup --field integrations`."

**Optionally persist the snapshot** (when the user asks for a saved/dated health report, or when run from `/standup`): resolve `$VAULT` via `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json` and write the report to `$VAULT/monitoring/<YYYY-MM-DD>.md` (`type: monitoring`, `tags: [harness, monitoring]`). Skip silently if `vaultPath` is unset. This is a local note — no remote state changes.

## Safety
Read-only by default. Do **not** resolve/ignore Sentry issues, edit alert rules,
create/edit dashboards, or start trials. If the user explicitly asks to act
(e.g. "resolve SENTRY-123"), confirm once and proceed — the guard hook also gates
Sentry write commands, and autonomous/scheduled runs are denied and must report
the proposed action instead.
