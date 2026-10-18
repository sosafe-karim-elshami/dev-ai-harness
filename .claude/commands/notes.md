---
description: Capture, append to, or search my Harness Obsidian knowledge base from any session
argument-hint: "[capture|add|search|list|open] <text>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(cat:*), Bash(ls:*), Bash(jq:*), Bash(date:*), Bash(rg:*), Bash(open:*)
---

# /notes — Harness knowledge base

Global entry point to the per-dev Obsidian vault; works from any repo or session.

## Locate the vault first

`$VAULT` = `jq -r '.vaultPath // empty' ~/.claude/sosafe-harness/config.json`. Empty or
missing folder → tell the user to run `/setup` (it scaffolds the vault from
`${CLAUDE_PLUGIN_ROOT}/definitions/vault-templates`). Never guess a path; never write outside `$VAULT`;
never write into `${CLAUDE_PLUGIN_ROOT}` — that is the shared repo.

## Request: $ARGUMENTS

First word is the action; plain prose means **capture**.

- **capture / add** — new note, or append when the topic clearly matches. Folder by kind:
  `memory/`, `meetings/`, `digests/`, `monitoring/`, else `knowledge/`. Filename: kebab-case
  slug. Frontmatter: `title`, `type` (memory | meeting | daily | monitoring | reference | moc),
  `tags: [harness, …]`, `updated: <date +%F>`; optional `expires: <YYYY-MM-DD>` for
  time-bound facts and `status: superseded` + `superseded_by:` when replaced. Link with
  full-path `[[folder/name]]` wikilinks. A durable memory also gets a one-line pointer under
  "## Facts" in `memory/index.md`; every note gets a bullet under "## Recent" in `$VAULT/index.md`.
- **search / find** — `rg -i "<query>" "$VAULT"` plus title `Glob`; return `path:line` refs with a
  one-line snippet, then a grounded synthesis citing note names.
- **list** — notes by folder, newest first (`ls -t`). Short.
- **open** — `open "$VAULT/<match>.md"` (macOS).

## Principles

Plain Markdown + wikilinks only. One note, one thing. Dates absolute. Writing a note is local
and safe; anything outward still goes through the guard hook.
