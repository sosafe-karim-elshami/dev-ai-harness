---
name: harness-monitoring
description: >
  Surfaces production health from the team's monitoring/observability tools — Sentry
  (issues, alerts, cron monitors, releases), Datadog (monitors, dashboards), Amplitude
  (product analytics), and Compass hygiene — grounded in the user's profile. Trigger on
  "any errors?", "how's production?", "what's alerting?", "show me Sentry issues", "Datadog
  monitors", "monitoring", "/monitoring", or when /standup or the dashboard runs the
  monitoring scan. Read-only: it reports and links; it never resolves issues, edits alerts,
  or changes dashboards unless the user explicitly asks, and that is gated.
model: sonnet
effort: medium
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Skill
  Bash(sentry:*)
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Datadog__*
  mcp__claude_ai_Sentry__*
  mcp__claude_ai_Amplitude__*
---

# Harness Monitoring

A grounded, read-only picture of production health across whatever the user actually has
connected. **"If available" is the whole design:** probe, use, or skip in one line.

## Inputs

`~/.claude/sosafe-harness/profile.json` (missing → `/setup`): `integrations.sentry`,
`integrations.datadog`, `integrations.amplitude`, `team.compass_alias`, `repos`. Probe
recipes and role emphasis: `sources.md`. Fallbacks: `${CLAUDE_PLUGIN_ROOT}/definitions/mcp-fallbacks.json`.

## Steps

1. Probe each source in `sources.md` — Sentry, Datadog, Amplitude, Compass. Skip what isn't
   configured; never block, never retry a missing tool.
2. Delegate Compass hygiene (ownership, security score, CD adoption) to `compass-analyst`.
   These are H2 Pillar 1 OKR inputs — include them in every scan, not only when asked.
3. Rank by blast radius: users affected, then event count, then recency.
4. Order per `role-playbooks.json` → `person.role_class`.

## Output

Compact **Monitoring** report; omit any empty section. Errors → top unresolved with counts
and links. Alerting → what's firing now. Health → cron monitors, release adoption, error
budget. Analytics → headline charts. Compass → gate status. Close with one line: `Not
configured: <tools>. Add them with /setup --field integrations.`

Persist when asked for a dated report, or when run from `/standup`: write to
`$VAULT/monitoring/<YYYY-MM-DD>.md` (`type: monitoring`). Skip silently if `vaultPath` is
unset. Local note — no remote state.

## Gates

Read-only. Never resolve or ignore an issue, edit an alert rule, create or change a
dashboard, or start a trial. Explicit ask ("resolve SENTRY-123") → confirm once, then act;
the guard hook gates Sentry writes too. Autonomous runs are denied and must report the
proposed action instead.
