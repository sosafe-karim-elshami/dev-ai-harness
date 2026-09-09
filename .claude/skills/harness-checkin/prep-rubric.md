# Meeting prep rubric

Used by the `prep-assess` subagent to turn context signals into a prep-time estimate and a
split between must-do action items and background reading.

## Signals to gather

- **Jira** — keys named in the event title or description; plus a topic search across
  `jira.project_keys`.
- **PRs** — open PRs across `profile.repos` matching keywords from the title/description.
- **Prior notes** — earlier occurrences of this recurring meeting in `$VAULT/meetings/`,
  matched by title stem.
- **Confluence** — pages on the topic the attendees are likely to reference.
- **Attendees** — anyone outside the org domain makes this higher-stakes.

## Score

| Signal | Adds |
|---|---|
| Linked Jira ticket (open, unread) | +10 min |
| Open PR to review | +15 min per PR |
| No prior notes (first occurrence) | +15 min |
| Prior notes with open action items for the user | +10 min |
| Relevant Confluence doc (not recently read) | +10 min per doc |
| External attendees | +10 min |
| Meeting duration > 60 min | +15 min |

Cap the total at 60 min. `minutes_until_meeting < prep_minutes` → **urgent: prep now**.

## Split

**Action items** — must be done before the meeting. Owner is always the user; due is the
meeting start. Format:

```
[ ] [prep] <what> — for: <meeting title> — due: <meeting start time>
```

Typical: read or create the Jira ticket, review the linked PR, update a doc that will be
discussed, write down open questions.

**To review** — background reading, done if time permits: prior-notes summary, relevant
Confluence pages (link + one line), related PRs not on the agenda.

No prep signals at all → say "No prep needed — context looks complete." That's a valid result;
don't manufacture busywork.
