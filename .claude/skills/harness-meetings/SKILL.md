---
name: harness-meetings
description: >
  Prepares for and runs meetings — builds an agenda from Google Calendar
  cross-referenced with Jira and recent PRs, captures notes during the meeting,
  and turns decisions into action items. Trigger on "prep my next meeting",
  "what's my 2pm about?", "agenda for standup", "take notes", "/meeting",
  "follow up on the meeting", or "create the action items". Agenda and notes are
  built read-only and stored locally; pushing action items to Jira or Slack
  always requires explicit confirmation.
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Bash(gh pr list:*)
  Bash(gh search:*)
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Google_Calendar__authenticate
  mcp__claude_ai_Google_Calendar__*
  mcp__claude_ai_Google_Drive__*
  mcp__claude_ai_Gmail__*
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__createJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__createConfluencePage
  mcp__claude_ai_Slack__slack_send_message
effort: high
---

# Harness Meetings

Three modes: **prep**, **run/notes**, **follow-up**. Read `~/.claude/sosafe-harness/profile.json` first (missing → `/setup`).

> Calendar access uses the Google Calendar MCP tools. If they aren't connected/authenticated, say so and proceed with whatever the user pastes in (meeting title, time, attendees).

## Where notes live (Obsidian vault)

Resolve the knowledge vault once: `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json` → call it `$VAULT`. Meeting notes go to **`$VAULT/meetings/<YYYY-MM-DD>-<slug>.md`** so they're browsable and cross-linked in Obsidian. If `vaultPath` is missing/empty or the folder doesn't exist, fall back to the repo-local `.scratch/meetings/<date>-<slug>.md` (gitignored) and mention it. Use `note-template.md` for structure either way, and add a `[[wikilink]]` to the note under "## Recent" in `$VAULT/index.md` when you write to the vault.

## Ingest transcript (Gemini notes)

For a finished meeting, ingest the auto-generated transcript instead of typing notes. Try these sources in order and use the first that works — degrade gracefully, never block:

1. **Google Drive (primary).** Google Meet's "Gemini takes notes" writes a Google Doc ("… - Notes by Gemini" or "… - Transcript"). Find it by:
   - the notes-doc link attached to the Calendar event (check the event's attachments/description), or
   - a Drive search by meeting title + date.
   Then fetch the doc's text with the Google Drive tools. (Tool names come from the connected Google Drive connector, e.g. `mcp__claude_ai_Google_Drive__*` search/fetch — pick the actual search/read tools exposed; if the connector isn't present, fall through.)
2. **Gmail recap (fallback).** If Gemini emailed a recap, search Gmail for it and read the body. Note: Gmail is gated by the guard hook, so in autonomous/draft runs this will be denied — use it interactively.
3. **Meetily / local export (fallback).** If the user captured the meeting with Meetily (or another local tool), read the exported transcript/summary file they point to.
4. **Pasted text (always works).** Accept a pasted doc link or the transcript text directly.

State which source you used. Then hand the raw transcript to the summarization step below.

## Prep (default)
1. Identify the meeting: from Calendar (next/today's, or the one the user names). Capture title, time, attendees, description.
2. **Build the agenda** by cross-referencing:
   - Jira: `searchJiraIssuesUsingJql` for the team/`project_keys` — in-progress, blocked, due-soon items relevant to the attendees/topic.
   - GitHub: recent + open PRs across `profile.repos` worth discussing (`gh pr list`/`gh search prs`).
   - `$VAULT/knowledge/` and prior notes in `$VAULT/meetings/` (or `.scratch/meetings/`) for open follow-ups.
3. Produce the agenda using `note-template.md`. Write it to `$VAULT/meetings/<date>-<slug>.md` (fallback `.scratch/meetings/<date>-<slug>.md`). Show it to the user.
4. **Update the daily file.** After writing the meeting note, upsert
   `$VAULT/digests/<TODAY>.md` (the single daily file — never create a
   separate pending or checkin file):
   - Read the file if it already exists; preserve all sections not related to
     this meeting.
   - Add or replace the `## Meeting prep needed` entry for this specific
     meeting with the prep action items just generated.
   - If the file does not exist yet, create it using the daily-file template
     from `harness-checkin` Step 6 (with only the meeting prep section filled,
     `last_updated` set to now, and the meeting listed in `## Meetings today`).
   - Never duplicate a meeting entry — match by meeting title + date and
     replace in place.
   - Always bump `last_updated` in the frontmatter to the current time.

## Run / notes
- Open (or create) `$VAULT/meetings/<date>-<slug>.md` (fallback `.scratch/meetings/<date>-<slug>.md`). As the user relays discussion, append notes under each agenda item: decisions, blockers, and **action items** (owner + what + due if known), following the schema in `note-template.md`.
- **From a transcript:** if you ingested a Gemini/Meetily transcript (see "Ingest transcript" above), summarize it into the same `note-template.md` structure instead of live-typing:
  - Map the discussion into per-topic **Discussion** bullets and a **Decision** line.
  - Extract every commitment into an **action item** — infer `owner` (map spoken names to attendees), `what`, and `due` if a date was mentioned; leave `due: none` otherwise.
  - Guess a sensible `target` for each (`jira:NEW`, `jira:KEY` if a ticket was named, or `slack:#channel`); mark uncertain ones for the user to confirm.
  - Set `Source: transcript (<gemini-doc|gmail|meetily|pasted>)` in the file header.
  - Write the file to `$VAULT/meetings/<date>-<slug>.md` (fallback `.scratch/meetings/<date>-<slug>.md`) and show the user the parsed action-item rollup.
- Keep it structured so follow-up can extract action items cleanly.

## Follow-up (gated)
0. If there's no notes file yet but the meeting is over, run **Ingest transcript** → **Run / notes** first, so follow-up works end-to-end from a real meeting with zero manual note-taking.
1. Extract all action items from the notes file (the "Action items (rollup)" section).
2. Show the user the full list, each tagged with its target: **Jira** (new issue or comment on an existing key) or **Slack** (which channel).
3. Ask **once**: "Create/post these N items? (yes/no)".
4. On yes: `createJiraIssue` / `addCommentToJiraIssue` for Jira; `slack_send_message` for the summary/announcement. For Jira ticket creation, you may delegate to `sosafe-planning` for well-formed tickets. The guard hook prompts per outward call — expected.
5. Optionally offer to publish the notes as a Confluence page (`createConfluencePage`) — gated, off unless asked.
6. **Reconcile the daily file.** After follow-up (regardless of whether items
   were pushed), update `$VAULT/digests/<TODAY>.md`:
   - Mark items that were pushed/created as `[x]`, or remove the meeting's
     prep section entirely if all prep items are done.
   - Append any **new** action items surfaced during follow-up to the
     `## My action items` section (or `## Team items` for other owners).
   - Preserve everything else in the daily file unchanged.
   - Bump `last_updated` in the frontmatter to the current time.

Respect `preferences.confirm_outward_actions`. Nothing leaves the machine without confirmation.
