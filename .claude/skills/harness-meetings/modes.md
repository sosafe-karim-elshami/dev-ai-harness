# Meeting modes

Detail for the three modes. Structure for every file written here comes from
`note-template.md`.

## Where notes live

Resolve once: `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json` → `$VAULT`. Notes go
to `$VAULT/meetings/<YYYY-MM-DD>-<slug>.md`. Unset, empty, or missing folder → fall back to
repo-local `.scratch/meetings/<date>-<slug>.md` (gitignored) and say so. When writing to the
vault, add a `[[wikilink]]` under "## Recent" in `$VAULT/index.md`.

## Prep

1. Identify the meeting — from Calendar (next, today's, or the one the user names): title,
   time, attendees, description. Calendar MCP unavailable → say so and work from whatever the
   user pastes in.
2. Spawn `prep-assess` (Task tool) for the signal gathering, prep-time score, and the
   action-items/to-review split. It returns JSON. Don't gather inline.
3. Write the agenda to the notes path using `note-template.md`. Show it to the user.
4. Upsert `$VAULT/digests/<TODAY>.md` — the single daily file. Read it first if it exists;
   preserve every unrelated section; add or replace this meeting's `## Meeting prep needed`
   entry, matched by title + date so it never duplicates; list the meeting under `## Meetings
   today`; bump `last_updated`. Doesn't exist → create it from
   `../harness-checkin/daily-template.md` with only the prep section filled.

## Run / notes

- **Live:** open or create the notes file and append under each agenda item as the user relays
  discussion — decisions, blockers, and action items (owner + what + due) per the template.
- **From a transcript:** spawn `meeting-ingest` (Task tool) instead of live-typing. It locates
  the transcript (calendar attachment → Drive → Gmail recap → existing note → none),
  summarizes into the template, extracts action items with inferred `owner`/`what`/`due`/
  `target`, and writes the note. It reports which source it used — pass that through.
- Uncertain targets come back flagged `uncertain: true`. Surface those for the user to confirm
  rather than silently guessing a Jira key.

## Follow-up

1. No notes file but the meeting is over → run **Run / notes** from a transcript first, so
   follow-up works end-to-end with zero manual note-taking.
2. Extract the action items from the notes file's rollup section.
3. Show the full list, each tagged with its target: Jira (new issue, or a comment on a named
   key) or Slack (which channel).
4. Gated — ask once: "Create/post these N items? (yes/no)". On yes: `createJiraIssue` /
   `addCommentToJiraIssue`; `slack_send_message` for the summary. Delegate well-formed ticket
   creation to `sosafe-planning`. The guard hook prompts per call as defense-in-depth.
5. Publishing the notes to Confluence (`createConfluencePage`) is off unless asked.
6. **Reconcile the daily file** either way: mark pushed items `[x]` (or drop the meeting's prep
   section if every prep item is done), append newly surfaced items to `## My action items` or
   `## Team items`, preserve everything else, bump `last_updated`.
