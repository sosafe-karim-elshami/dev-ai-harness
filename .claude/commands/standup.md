---
description: Role-ordered, read-only daily driver — project status, support queue, today's meetings, production health, merged into one triage list.
---

Composite **read-only** daily driver. Scatter the scans, gather one digest.

## Steps

1. Read `~/.claude/sosafe-harness/profile.json` (missing → `/setup`). Take `person.role_class`
   and its `standup_order` from `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`.
2. **Seed from today's daily file.** Read `$VAULT/digests/<TODAY>.md` if it exists — the single
   daily file that `/checkin` maintains. Carry its open action items, meeting prep, and
   docs-to-update forward as today's starting point instead of re-deriving them.
3. **Scatter — one message, all scans in parallel.** Spawn via the Task tool:
   - `pm-scan` — Jira hygiene + PR sweep (JSON).
   - `support-scan` — unanswered Slack/Jira queue (JSON). Surface only; no drafting.
   - `prep-assess` — one per meeting on today's calendar (JSON). Agenda highlights, not notes.
   - `harness-monitoring` — **only if** `monitoring_scan` is in this role's `standup_order`
     **and** `profile.integrations` has a monitoring tool configured. Skip silently otherwise.

   Don't call `harness-pm` or `harness-support-triage` here — they'd re-do the scan in the main
   context. The subagents are the scan; this command is the merge.
4. **Gather.** Classify every item with `${CLAUDE_PLUGIN_ROOT}/definitions/urgency-matrix.json`
   (kind, priority, flags), then order by it — leadership/overdue first, then P1 → P2 → P3, then
   due date. Prefix each line with its priority and flag markers. Section order follows
   `standup_order`; omit any empty section.
5. **Save** to `$VAULT/digests/<YYYY-MM-DD>.md` — merge into the existing daily file, never
   replace it: preserve completed `[x]` items, de-duplicate, bump `last_updated`. Format per
   `.claude/skills/harness-checkin/daily-template.md`. Add a `[[wikilink]]` under "## Recent" in
   `$VAULT/index.md`. `vaultPath` unset → skip silently.
6. Close with one line: "Want support replies drafted, a meeting prepped, or Jira hygiene
   fixed? I'll confirm before anything is sent."

## Output

Per `${CLAUDE_PLUGIN_ROOT}/definitions/output-contract.md`: the top item per section, one line
each with its link, then the digest path. The full digest lives in the file — don't reprint it.

## Safety

Never changes remote state — no Slack, Jira, email, or git. Reads, reports, and saves one local
digest note.

## Optional: run on a schedule

Off by default. `CronCreate` / `ScheduleWakeup` to invoke `/standup` on a weekday cron (e.g.
`0 9 * * 1-5`). Scheduled runs stay read-only and produce the digest plus staged drafts only —
never auto-send; the guard hook still applies. Keep secrets out of the cron command.
