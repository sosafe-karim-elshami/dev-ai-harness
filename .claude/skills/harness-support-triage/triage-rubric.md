# Triage rubric

What counts as "unanswered", and how to ground a reply. The goal: never miss a real request, never nag on noise, never answer without evidence.

## A message/thread is UNANSWERED when ALL hold

1. **It's a request.** Contains a question, a help/`@here`/`@channel` ask, an error report, or "can someone…". Skip pure FYIs, announcements, bot posts, and social chatter.
2. **No team reply.** No reply in the thread from a team member who isn't the asker, within the **unanswered window** (default 4 hours; `discovery-queries.json` → `slack.unanswered_window_hours`). A reply from the asker themselves doesn't count.
3. **Not resolved.** No resolving reaction (✅, white_check_mark, "done"), and no closing message like "thanks, solved", "nvm", "figured it out".

For Jira: support-labelled, `statusCategory != Done`, and either unassigned or with no team comment in > 1 business day.

## Prioritize

1. Customer-/stakeholder-facing over internal.
2. Older over newer (note anything past an SLA the team uses).
3. Blocking ("prod down", "can't ship") over informational.

## Grounding order (before drafting)

1. `knowledge/*.md` (team memory) — Grep for the topic; reuse + cite if matched.
2. `workspace/<repo>` (cloned code) — Grep/Read for authoritative behavior; cite the path.
3. Confluence (team spaces) — `confluence.ground_answer_cql`; cite the page.

If none of these yield a confident answer: **do not guess.** Summarize what you found, state the gap, and ask the user how to proceed (or tag the right owner).

## Draft quality bar

- Lead with the direct answer, then the why, then links.
- Keep it short; link out rather than pasting docs.
- Match the channel's tone. Never promise timelines on the team's behalf.
- Always end the staged draft with its cited sources so the human can verify before sending.
