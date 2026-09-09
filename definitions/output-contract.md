# Output contract

Binding on every harness skill, command, and composite. Verbosity is a bug, not a style.

## The reply

- **Lead with the answer.** First sentence is the finding, the decision, or the number. Never restate the ask, never narrate the plan you're about to execute.
- **8 lines is the default ceiling** for a chat reply. A scan over N items may use one line per item plus a one-line lead — nothing more.
- **No section headers under three items.** Two findings are two lines, not two subsections.
- **No preamble, no epilogue.** Drop "I'll now…", "Great question", "Let me know if…", "Hope this helps". The one exception is a gate prompt (below), which is required.
- **Detail goes to the file, not the chat.** Long output belongs in `$VAULT/digests/`, `$VAULT/meetings/`, or a snapshot. In chat, give the headline plus the path.

## Evidence

- Cite as `path:line`, Jira key, PR number, or permalink. Bare claims about the user's system are defects.
- Say "not configured" or "no source found" in one line and move on. Never pad around a missing integration.
- If you can't ground it, say what's missing and ask. Do not guess and do not hedge at length.

## Numbers and lists

- Rank before you print. If 40 items match, show the top ones that matter and state the total: `12 stale (showing 5)`.
- Every item line carries its own evidence link. A list of names with no links is not a finding.
- Classify and order by `definitions/urgency-matrix.json` — priority and flags first, due date last. A digest is a triage list, not a dump.

## Gates

One batched confirmation, naming every target, asked exactly once:

> Apply these N changes? (yes = <what happens>; no = keep as draft)

Never ask per item. Never ask twice. The guard hook firing afterwards is expected defense-in-depth, not a second prompt for you to author.

## Skill authoring

- `SKILL.md` is a contract, not a script: frontmatter → Inputs → Steps → Output → Gates. **60-line cap on the instruction body** (frontmatter and its tool allowlist don't count; `harness registry check` enforces it).
- Steps are imperative one-liners, ten at most. If you need more, it's two skills or a delegated subagent.
- File templates, rubrics, and long formats live in sibling files (`note-template.md`, `report-templates.md`), loaded only when that step runs. Never inline a template into a `SKILL.md`.
- Don't restate the principles in `CLAUDE.md` or this contract. They're already loaded.
