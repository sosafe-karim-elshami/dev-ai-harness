Prepare for, run, or follow up on a meeting.

Invoke the **harness-meetings** skill. Pick the mode from what the user asks:
- **prep** (default) — build an agenda from Calendar + Jira + recent PRs and save it to `.scratch/meetings/`.
- **notes** — capture discussion, decisions, and action items into the meeting file. For a finished meeting, **ingest the Gemini notes Google Doc** (Drive → Gmail → Meetily → pasted, first that works) and summarize it into the notes file instead of typing.
- **follow-up** — extract action items and push them to Jira/Slack (batched, confirmed, guard-gated). If no notes file exists yet, ingest the transcript and build one first.

If the user names a meeting/time, scope to it; otherwise use today's / the next calendar event. If Google Calendar isn't connected, ask the user for the meeting details and proceed.
