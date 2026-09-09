---
name: harness-meetings
description: >
  Prepares for and runs meetings — builds an agenda from Google Calendar cross-referenced
  with Jira and recent PRs, captures notes during the meeting, ingests Gemini transcripts,
  and turns decisions into action items. Trigger on "prep my next meeting", "what's my 2pm
  about?", "agenda for standup", "take notes", "/meeting", "ingest my Gemini notes", "follow
  up on the meeting", or "create the action items". Agenda and notes are built read-only and
  stored locally; pushing action items to Jira or Slack always requires confirmation.
model: sonnet
effort: high
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Task
  Skill
  Bash(gh pr list:*)
  Bash(gh search:*)
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Google_Calendar__*
  mcp__claude_ai_Google_Drive__*
  mcp__claude_ai_Gmail__*
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__createJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__createConfluencePage
  mcp__claude_ai_Slack__slack_send_message
---

# Harness Meetings

Three modes: **prep**, **run/notes**, **follow-up**. Full detail per mode in `modes.md`;
file structure in `note-template.md`.

## Inputs

`~/.claude/sosafe-harness/profile.json` (missing → `/setup`). `$VAULT` from
`config.json` → `vaultPath`, else `.scratch/meetings/`. Fallback chains for Calendar, Drive,
and Gmail: `definitions/mcp-fallbacks.json`.

## Steps

1. Pick the mode: upcoming meeting → **prep**; happening now → **run/notes**; finished, or the
   user says "follow up"/"ingest" → **follow-up**.
2. **Prep** → spawn `prep-assess` (Task tool) per meeting for signals and the prep-time score;
   write the agenda; upsert the daily file. See `modes.md` → Prep.
3. **Run/notes** → live-append as the user relays, or spawn `meeting-ingest` (Task tool) to
   pull and summarize the transcript. See `modes.md` → Run / notes.
4. **Follow-up** → extract the action-item rollup, show it with per-item targets, gate the
   push, then reconcile the daily file. See `modes.md` → Follow-up.
5. Never scan Drive or Gmail inline — `meeting-ingest` owns transcript retrieval, and it
   degrades through the source chain without blocking.

## Output

Prep: the agenda's headline items and the note path. Ingest: which source was used, the
decisions, and the action-item rollup. Follow-up: what was created and where. One line per
item; the full text lives in the note.

## Gates

Batch every Jira create/comment and Slack post into **one** confirmation naming each target.
Confluence publishing is off unless asked. Vault and `.scratch/` writes are local and safe.
Respect `preferences.confirm_outward_actions`; the guard hook fires regardless.
