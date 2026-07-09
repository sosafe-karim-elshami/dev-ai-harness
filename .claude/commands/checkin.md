Autonomous daily check-in — covers what already happened today and proactively
prepares for what's coming. Runs every 2 hours, Mon–Fri 8–18.

Invoke **harness-checkin**. Steps:

1. **Past meetings** — ingests Gemini notes/transcripts (Drive → Gmail → vault)
   for every meeting that already ended today.
2. **Proactive meeting prep** — for every upcoming meeting today and tomorrow:
   - Gathers linked Jira tickets, relevant PRs, prior notes, Confluence docs,
     and attendee signals.
   - Estimates prep time needed (capped at 60 min); marks **URGENT** if the
     meeting is sooner than the estimated prep window.
   - Splits output into **action items** (must-do before the meeting) and
     **to-review** (background reading if time permits).
3. **Action item rollup** — all items from all meetings, tagged by owner
   (`[me]` vs others) with Jira/Slack targets.
4. **Document alignment** — flags Confluence pages and vault knowledge docs
   that may be out of sync with today's decisions.
5. **Tomorrow's plan** — meetings + Jira focus items + carry-over actions.
6. **Your action items** (interactive only) — asks once for anything you want
   to add.
7. **Write vault notes** — hourly snapshot saved to
   `$VAULT/digests/<date>-checkin-<HH>.md`; open/actionable items always
   aggregated into the single daily pending doc at
   `$VAULT/digests/<date>-pending.md` (overwritten each run so it stays fresh).
8. **Push to Jira/Slack** — batched, requires explicit `yes`; autonomous runs
   always draft, never auto-send.

If Google Calendar isn't connected, paste today's meeting titles/times and
the skill proceeds from there.
