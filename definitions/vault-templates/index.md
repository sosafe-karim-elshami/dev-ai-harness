---
title: Harness Knowledge Base
type: moc
tags: [harness, moc, sosafe]
updated: {{DATE}}
---

# 🧭 Harness Knowledge Base

The single, cross-session knowledge base for my SoSafe work. Any Claude Code
session — in any repo — reads and writes here via the global `/notes` command.
Everything is plain Markdown with `[[wikilinks]]`, so Obsidian's graph and
backlinks work out of the box.

> Canonical location recorded in `~/.claude/sosafe-harness/config.json` → `vaultPath`.

## Areas

- [[memory/index|🧠 Memory]] — durable facts about me, my work, and how the harness should behave.
- **📅 Meetings** → `meetings/` — agendas, notes, and action-item rollups (from `harness-meetings`).
- **📊 Digests** → `digests/` — daily standup digests (from `/standup`).
- **🚨 Monitoring** → `monitoring/` — production-health snapshots (from `harness-monitoring`).
- **📚 Knowledge** → `knowledge/` — reusable, groundable notes (architecture, decisions, how-tos).

## How to use it

- **From any session:** `/notes` — capture, append, or search anything here.
- **Meetings:** `harness-meetings` writes agendas/notes into `meetings/`.
- **Daily:** `/standup` saves the digest into `digests/`.
- See [[How this works]] for the full design.

## Recent

<!-- Newest notes bubble up here; kept short on purpose. -->
