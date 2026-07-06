---
title: How this works
type: reference
tags: [harness, meta]
updated: {{DATE}}
---

# How this works

Inspired by [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian),
adapted to the **dev-ai-harness**. Rather than a separate vault + REST transport,
this reuses what the harness already has (markdown memory with `[[wikilinks]]`, a
per-context CLI, a guard hook) and points it at a folder inside my everyday
Obsidian vault.

**The setup is shared; each dev has their own vault.** The scaffold, templates,
`/notes` command, and skill wiring live in the committed harness repo. The vault
*content* (this folder's notes) is personal and private — it is never committed.

## The pieces

| Piece | Where | Role |
|---|---|---|
| **Vault** | recorded in `~/.claude/sosafe-harness/config.json` → `vaultPath` | Single personal knowledge base; opened as/inside my Obsidian vault. |
| **Global `/notes`** | `~/.claude/commands/notes.md` (installed by `/setup` from the repo) | Capture / append / search from **any** Claude session, any repo. |
| **Skills** | dev-ai-harness `.claude/skills` | `harness-meetings`, `/standup`, `harness-monitoring` write notes here. |
| **Templates** | dev-ai-harness `definitions/vault-templates/` | What `/setup` scaffolds a new dev's vault from. |
| **Graph** | Obsidian native | `[[wikilinks]]` + frontmatter `type:` drive backlinks and the graph view. |

## Conventions

- **One note = one thing.** Small, linkable, with YAML frontmatter (`title`, `type`, `tags`, `updated`).
- **`type:`** is one of `memory | meeting | digest | monitoring | reference | moc`.
- **Link liberally.** A `[[name]]` that doesn't exist yet is a to-do, not an error.
- **Dates are absolute** (`YYYY-MM-DD`), never "yesterday".
- **Read-mostly.** Outward actions (Slack/Jira/email/push) still go through the harness guard hook and need confirmation — writing a note here is local and safe.

## Related

- [[index|Harness home]]
- [[memory/index|Memory]]
