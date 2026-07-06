Show production health from the team's monitoring tools — **read-only**.

Invoke the **harness-monitoring** skill. It probes whatever is configured in the profile's `integrations` (Sentry, Datadog, Amplitude) and surfaces:
- unresolved Sentry issues (top by count/users), alert rules, cron monitors, release health;
- Datadog monitors currently firing + named dashboards (if a Datadog connector/CLI is available);
- Amplitude headline charts/dashboards (if configured).

"If available" is the rule: use each tool if present, skip it silently otherwise. Order by `person.role_class` per `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`. Link out to dashboards rather than dumping raw numbers. Never resolve issues, edit alerts, or change dashboards unless explicitly asked (and that is gated).
