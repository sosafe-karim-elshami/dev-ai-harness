Reflect on how the harness itself could work better, and propose improvements — **read-only, drafts only**.

Invoke the **harness-self-improve** skill. It reviews recent harness activity (digests, session history, memory, and the `knowledge/` folder), spots friction and gaps, and proposes concrete edits to skills, routing (`CLAUDE.md`), or team knowledge.

Hard rules:
- Never commit, push, send, or change remote state. Every proposal is a diff/description for a human to apply.
- Surface proposals as a prioritized list; if the user says "apply", make the local file edits only (still no commit/push) and stop.
- Self-documentation lands in `knowledge/` (committed, team-private). Publishing anything outward (e.g. Confluence) is gated and off unless explicitly asked.
