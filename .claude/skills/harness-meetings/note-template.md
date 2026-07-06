# Meeting note template

Stored at `.scratch/meetings/<YYYY-MM-DD>-<slug>.md` (gitignored). Agenda and notes share one file so follow-up can extract action items in place.

```markdown
# <Meeting title> — <YYYY-MM-DD HH:MM>
Attendees: <names>
Source: <calendar event / manual / transcript (gemini-doc|gmail|meetily|pasted)>

## Agenda
1. <topic>
   - Context: <Jira KEY / PR repo#NN / knowledge link>
2. <topic>
   - Context: …

## Notes
### 1. <topic>
- Discussion: <bullets>
- Decision: <what was decided, or "none">
- [ ] ACTION — owner: <name> — <what> — due: <date|none> — target: <jira:NEW|jira:KEY|slack:#channel>

### 2. <topic>
- …

## Action items (rollup)
- [ ] <owner> — <what> — target: <…>
```

## Action-item schema

Each action item carries: **owner**, **what**, optional **due**, and a **target**:
- `jira:NEW` — create a new Jira issue (consider delegating to `sosafe-planning`).
- `jira:KEY` — comment/update an existing issue.
- `slack:#channel` — post in a channel.

Follow-up reads the rollup, confirms once, then executes (gated by the guard hook).
