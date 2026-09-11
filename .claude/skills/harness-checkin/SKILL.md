---
name: harness-checkin
description: >
  Autonomous daily check-in that runs every 2 hours during working hours (Mon–Fri 8–18):
  ingests today's past meetings, proactively prepares for upcoming ones (estimates prep
  time, splits into action items + to-review), rolls up all action items, flags documents
  that need updating, and prepares tomorrow's plan from Calendar + Jira. Trigger on
  "/checkin", "wrap up today", "what happened today", "prepare for tomorrow", "collect my
  action items", "prep my meetings", or when the cron fires autonomously. Read-only by
  default; pushing to Jira/Slack is batched and gated.
model: sonnet
effort: high
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Task
  Skill
  Bash(jq:*)
  Bash(date:*)
  Bash(find:*)
  mcp__claude_ai_Google_Calendar__list_events
  mcp__claude_ai_Google_Calendar__list_calendars
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__createJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Slack__slack_send_message
---

# Harness Check-in

Read-mostly wrap-up and prep, every 2 hours on weekdays 8–18. Covers what already happened
today and what's coming — touching no remote state unless the user confirms.

## Inputs

`profile.json` (missing → `/setup`, do what's possible). `$VAULT` from `config.json` →
`vaultPath`, else `${CLAUDE_PLUGIN_ROOT}/.scratch/checkins/`. `$NOW`/`$TODAY` from `date`.
`${CLAUDE_PLUGIN_ROOT}/definitions/urgency-matrix.json` for classification. Daily file format:
**`daily-template.md`**. Prep scoring: **`prep-rubric.md`**. Capability chains:
`${CLAUDE_PLUGIN_ROOT}/definitions/mcp-fallbacks.json` — probe before use; most connectors are session-only.
Mode: **interactive** (user ran `/checkin` — ask for their own items at the end) or
**autonomous** (cron — never prompt).

## Steps

1. **Scatter.** Calendar events for today and tomorrow, attendees ≥ 2. Then, in parallel:
   spawn one `meeting-ingest` (Task tool) per past meeting (`start ≤ $NOW`), and one
   `prep-assess` per upcoming meeting (today `start > $NOW`, plus all of tomorrow). Both
   return JSON. Never do this work inline — that's what made this skill slow.
2. **Gather** every returned action item into one master list. Tag the user's own `[me]`,
   others by name. Classify each with the urgency matrix — `kind`, `priority`, `flags`. That
   drives ordering everywhere; never fall back to due-date alone.
3. **Docs to update.** For each decision returned by `meeting-ingest`, search Confluence and
   `$VAULT/${CLAUDE_PLUGIN_ROOT}/knowledge/` for a page it contradicts or extends. List `[title](url) — reason`.
   Flag only — never auto-update a page.
4. **Tomorrow's plan.** Tomorrow's meetings with their prep estimates; Jira assigned to the
   user (`In Progress`/`To Do`, due tomorrow or earlier, max 10); carry-over open `[me]` items.
5. **Write the daily file** per `daily-template.md` — merge, don't replace; one file per day.
6. **Interactive only:** ask once — "Any action items from your side? (one per line, or
   'none')" — and append them. Autonomous: skip, and say `Run /checkin to add your own items.`

## Output

The top three action items and the count of the rest, any urgent prep, and the daily file
path. Everything else lives in the file — don't restate it in chat.

**Always close with any degraded capability**, using its `degrade` message from
`mcp-fallbacks.json`. A cron run that lost Calendar looks identical to a day with no
meetings unless you say so — never omit it silently.

## Gates

- **Read-only by default.** No mutation without an explicit `yes`.
- Pushing: show the full list, ask once — "Push these N items?" — then `createJiraIssue` for
  `jira:NEW`, `addCommentToJiraIssue` for `jira:KEY`, `slack_send_message` for `slack:#channel`.
- **Autonomous never writes remote.** Always draft; surface `N items ready — run /checkin to
  confirm and send.` Guard hook fires in autonomous mode → record the proposed action and stop.
- Vault writes are local and safe.
