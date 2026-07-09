---
name: harness-checkin
description: >
  Autonomous daily check-in that runs every 2 hours during working hours
  (Mon–Fri 8–18): ingests today's past meetings, proactively prepares for
  upcoming ones (estimates prep time, splits into action items + to-review),
  rolls up all action items, flags documents that need updating, and prepares
  tomorrow's plan from Calendar + Jira. Trigger on "/checkin", "wrap up today",
  "what happened today", "prepare for tomorrow", "collect my action items",
  "prep my meetings", or when the cron fires autonomously.
  Read-only by default; pushing to Jira/Slack is batched and gated.
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Bash(jq:*)
  Bash(date:*)
  Bash(find:*)
  mcp__claude_ai_Google_Calendar__list_events
  mcp__claude_ai_Google_Calendar__get_event
  mcp__claude_ai_Google_Calendar__list_calendars
  mcp__claude_ai_Google_Drive__search_files
  mcp__claude_ai_Google_Drive__read_file_content
  mcp__claude_ai_Google_Drive__get_file_metadata
  mcp__claude_ai_Google_Drive__download_file_content
  mcp__claude_ai_Gmail__search_threads
  mcp__claude_ai_Gmail__get_thread
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__createJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Atlassian__updateConfluencePage
  mcp__claude_ai_Slack__slack_send_message
  mcp__claude_ai_Slack__slack_send_message_draft
effort: high
---

# Harness Check-in

A **read-mostly autonomous wrap-up + prep** that runs every 2 hours on
weekdays 8–18. It covers what already happened today and what's coming next —
without touching any remote state unless the user confirms.

---

## Setup

1. Read `~/.claude/sosafe-harness/profile.json` (missing → tell the user to
   run `/setup`; skip role-aware steps but do what's possible).
2. Resolve `$VAULT` via `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json`.
   Fall back to `.scratch/checkins/` (gitignored) if unset.
3. Capture `$NOW` and `$TODAY` via `date`. Detect run mode:
   - **Interactive** — user triggered `/checkin`; ask for their action items
     at the end (step 7).
   - **Autonomous** — fired by cron; skip interactive prompts, save results
     to vault, surface a compact summary.

---

## Daily file — the single source of truth

**One file per day.** All check-in runs for a given date read from and write
to a single file: `$VAULT/digests/<YYYY-MM-DD>.md`.

- **If the file does not exist** (first run of the day): create it using the
  template in Step 6.
- **If it already exists** (subsequent runs): read the current state, then
  **overwrite** it with an updated version — preserving all completed `[x]`
  items, merging new action items, and bumping `last_updated`.
- **Never create** `<date>-checkin-<HH>.md`, `<date>-pending.md`, or any
  other per-run files. The single daily file replaces both.

Mark the active day in the `## Meetings today` table with emoji status:
- `✅` — meeting done, notes captured
- `⏳` — meeting done, no notes yet
- `🔜` — meeting still upcoming today

---

## Step 1 — Ingest today's past meetings

Fetch calendar events for today where `start ≤ $NOW` and attendee count ≥ 2.
For each, find notes/transcript using this priority chain (degrade gracefully):

1. **Calendar attachment** — check event description/attachments for a Drive
   doc link and fetch it.
2. **Google Drive** — search for a Gemini notes doc by meeting title + date.
3. **Gmail recap** — search for Gemini recap emails from today (gated by guard
   hook in autonomous mode — skip silently if denied).
4. **Existing vault note** — check `$VAULT/meetings/<today>-*.md`.
5. **No source** — flag as "⏳ no notes found"; list at the end.

For meetings with a raw Gemini transcript (sources 1–3): summarize it into
the `note-template.md` structure and write to
`$VAULT/meetings/<today>-<slug>.md`. Link in `$VAULT/index.md`.

State which source was used for each meeting.

---

## Step 2 — Proactive meeting preparation

Fetch calendar events for:
- **Today**, `start > $NOW` (meetings not yet started)
- **Tomorrow** (full day)

For each upcoming meeting, run this prep assessment:

### 2a — Assess prep needed

Gather context signals:
- **Jira tickets** linked in the event description or title (`searchJiraIssuesUsingJql`
  for any KEY mentioned; also search by meeting topic in `project_keys`).
- **PRs** relevant to the topic (`gh search prs` across `profile.repos` by
  keyword from the meeting title/description, if available).
- **Prior meeting notes** — search `$VAULT/meetings/` for previous occurrences
  of this recurring meeting (match by title stem).
- **Confluence pages** — `searchConfluenceUsingCql` by topic/title to find
  relevant docs the attendees may reference.
- **Attendees** — note names; if external (outside the org domain), flag as
  higher-stakes.

### 2b — Estimate prep time

Score each signal and sum into a recommended prep window:

| Signal | Adds |
|---|---|
| Linked Jira ticket (open, unread) | +10 min |
| Open PR to review | +15 min per PR |
| No prior meeting notes (first occurrence) | +15 min |
| Prior notes with open action items for the user | +10 min |
| Relevant Confluence doc (not recently read) | +10 min per doc |
| External attendees | +10 min |
| Meeting duration > 60 min | +15 min |

Cap at 60 min total. If `time_until_meeting < estimated_prep_time`, mark as
**URGENT — prep now**.

### 2c — Split into action items and to-review

**Action items (must-do before meeting):**
- Owner always = user. Format: `[ ] [prep] <what> — for: <meeting title> — due: <meeting start time>`
- Include: create/read the Jira ticket, review the linked PR, update a doc
  that will be discussed, write down open questions.

**To review (background reading, do if time permits):**
- Prior meeting notes summary
- Relevant Confluence pages (link + one-line description)
- Related PRs not directly on the agenda

If a meeting has no prep signals, say "No prep needed — context looks complete."

---

## Step 3 — Parse action items from past meetings

For each past meeting with notes:
- Read the "## Action items (rollup)" section.
- Extract items with: **owner**, **what**, **due**, **target**
  (`jira:NEW | jira:KEY | slack:#channel | me`).
- Tag items owned by the profile user as `[me]`; tag others by name.

Accumulate into the **master action list**.

---

## Step 4 — Document alignment

For each decision recorded in today's meeting notes:
1. Search Confluence (`searchConfluenceUsingCql`) by topic. If a page exists
   that the decision contradicts or extends, list it with a short diff note.
2. Check `$VAULT/knowledge/` for matching topic pages.

Produce a **"Docs to update"** list: `[title](url) — reason`. One line if
nothing is out of sync.

Do **not** auto-update any page — flag only.

---

## Step 5 — Tomorrow's plan

1. **Tomorrow's meetings** — from the proactive prep assessment in step 2.
2. **Jira focus** — items assigned to the user: `In Progress` or `To Do`,
   due tomorrow or earlier. Limit 10, sorted by due/priority.
3. **Carry-over actions** — open `[me]` items from the master list.

---

## Step 6 — Write (or update) the daily file

Write to `$VAULT/digests/<TODAY>.md`. If the file already exists, read it
first and merge: preserve completed `[x]` items, de-duplicate open items,
bump `last_updated`. Never create a separate file for each run.

```markdown
---
type: daily
date: <YYYY-MM-DD>
last_updated: "<HH:MM>"
tags: [harness, daily]
---

# 📅 <YYYY-MM-DD> — Daily

## Meetings today

| Time | Meeting | Notes |
|------|---------|-------|
| <HH:MM> ✅/⏳/🔜 | <Title> (<duration>) | [[meetings/<slug>]] or — |

---

## My action items

<!-- Overdue first, then by due date, then undated. Bold the top blocker. -->
- [ ] **<most urgent item>** — due: <date|time> — <context>
- [ ] <next item> — due: <date|none>

---

## Meeting prep needed

<!-- Only meetings that still need prep (start > $NOW). Omit section if all done. -->
### <Meeting title> — <HH:MM> today — ⚠️ URGENT / ~X min prep
**Full prep note:** [[meetings/<slug>]]
- [ ] [prep] <what> — due: <HH:MM>

**To review**
- [<Confluence title>](<url>) — <why relevant>

---

## Team items

- [ ] [<Name>] <what> — due: <date|none>

---

## Docs to update

<!-- Omit section if nothing needs updating. -->
- [<page>](<url>) — <reason>

---

## Tomorrow — <YYYY-MM-DD>

### Meetings
| Time | Meeting | Prep |
|------|---------|------|
| <HH:MM> | <Title> | ~<X> min |

### Jira focus
- [<KEY>](<url>): <summary> — due <date|none>

### Carry-over
- [ ] <what>

---

## Reminders
<!-- Performance review, OKR deadlines, etc. Omit if none. -->
```

After writing, add or replace a link under "## Recent" in `$VAULT/index.md`:
- **Today's date**: `- [[digests/<TODAY>|📅 <TODAY> (active)]] — <one-line summary>`
- **Past dates**: `- [[digests/<DATE>|📅 <DATE>]] — <one-line summary>`

Never add checkin-HH or pending links to the index — only the single daily link.

---

## Step 7 — Collect user's own action items (interactive only)

Ask once:
> "Any action items from your side I should capture? List them (one per line,
> or say 'none')."

Append each to the master list tagged `[me]` and write back to the daily file.
In **autonomous mode**, skip and show this reminder instead:
> "Autonomous check-in saved. Run `/checkin` to add your own action items."

---

## Step 8 — Confirm and push (gated)

Show the full action list and ask **once**:
> "Push these N items? (yes = create Jira / post Slack as listed; no = draft only)"

On yes: `createJiraIssue` for `jira:NEW`; `addCommentToJiraIssue` for
`jira:KEY`; `slack_send_message` for `slack:#channel`.

In **autonomous mode**: always draft, never push. Surface:
> "N items ready — run `/checkin` to confirm and send."

---

## Safety rules

- **Read-only by default.** No mutations without explicit `yes`.
- **Autonomous = non-interactive.** Produces a vault note + compact summary.
  Never sends messages, creates tickets, or asks questions.
- **Guard hook applies.** `.claude/hooks/confirm-outward-actions.sh` blocks
  outward calls independently — if it fires in autonomous mode, record the
  proposed action and stop.
- **Vault writes are always safe.** Writing to `$VAULT/digests/` or
  `$VAULT/meetings/` is local and does not trigger the guard hook.
- **One file per day, always.** Never create `<date>-checkin-<HH>.md`,
  `<date>-pending.md`, or any other per-run files. If you find old-format
  files from previous runs, leave them alone — do not delete or merge them
  automatically.
