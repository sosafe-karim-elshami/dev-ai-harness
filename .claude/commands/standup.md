Composite, **read-only** daily driver: project status + support scan + today's meetings, ordered for the user's role.

## Steps

1. Read `~/.claude/sosafe-harness/profile.json` (missing → `/setup`). Get `person.role_class` and the matching `standup_order` from `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`.
2. Run the sections in that order, gathering only (no mutations):
   - **PM** — invoke `harness-pm` for the status summary + PR tracking (+ team metrics via `compass-analyst` for managers/staff). Skip the "apply fixes" step here.
   - **Support** — invoke `harness-support-triage` step 1 only: surface the unanswered queue (no drafting unless asked).
   - **Meetings** — invoke `harness-meetings` prep for today's calendar events (agenda highlights, not full notes).
   - **Monitoring** — if `monitoring_scan` is in this role's `standup_order` and `profile.integrations` has any monitoring tool configured, invoke `harness-monitoring` for a short production-health read (firing alerts / spiking Sentry issues). Skip silently if nothing is configured.
3. Produce one consolidated digest, role-ordered, with links.
4. **Save the digest** to the Obsidian vault so it's browsable and cross-linked: resolve `$VAULT` via `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json`, then write the digest to `$VAULT/digests/<YYYY-MM-DD>.md` with frontmatter (`type: digest`, `tags: [harness, standup]`, `updated: <date>`). Link out to relevant `[[meetings/...]]` and `[[memory/...]]` notes, and add a one-line `[[wikilink]]` under "## Recent" in `$VAULT/index.md`. If `vaultPath` is missing/empty, skip this step silently. Writing a local note is allowed — it changes no remote state.
5. End with: "Want me to draft support replies, prep a specific meeting, or fix any Jira hygiene? I'll confirm before anything is sent."

Never send or change any **remote** state in `/standup` (Slack/Jira/email/git). It only reads, reports, and saves a local digest note.

## Optional: run on a schedule

To get this each weekday morning as a digest, set up a scheduled run (off by default):
- Use Claude Code scheduling (`CronCreate` / `ScheduleWakeup`) to invoke `/standup` on a cron (e.g. `0 9 * * 1-5`).
- The scheduled run stays read-only and only produces the digest (and optionally staged drafts). It must never auto-send — the guard hook still applies.
- Document the user's chosen schedule in their notes; keep secrets out of the cron command.
