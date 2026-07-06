---
description: Capture, append to, or search my Harness Obsidian knowledge base from any session
argument-hint: "[capture|add|search|list|open] <text>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(cat:*), Bash(ls:*), Bash(jq:*), Bash(date:*), Bash(rg:*), Bash(open:*)
---

# /notes — Harness knowledge base

A global entry point to my Obsidian knowledge base. Works from **any** repo or
session — it does not depend on the current directory. The vault is per-dev and
private; this command only reads/writes within it.

## Locate the vault (always do this first)

Read `vaultPath` from `~/.claude/sosafe-harness/config.json`:

```
jq -r '.vaultPath // empty' ~/.claude/sosafe-harness/config.json
```

If it's empty or the folder doesn't exist, the dev hasn't scaffolded their vault
yet — tell them to run `/setup` (which scaffolds it from `definitions/vault-templates`
and records `vaultPath`). Do not guess a path. Never write notes outside the vault.
Call the resolved directory `$VAULT`.

## Request: $ARGUMENTS

Interpret the first word as the action (default to **capture** if it's plain prose):

### capture / add
Write a new note (or append to an existing one when the topic clearly matches).
- Choose the subfolder by kind: `memory/`, `meetings/`, `digests/`, `monitoring/`,
  or `knowledge/` (default `knowledge/` for general facts).
- Filename: kebab-case slug of the title, `.md`.
- Frontmatter every note:
  ```
  ---
  title: <human title>
  type: memory | meeting | digest | monitoring | reference | moc
  tags: [harness, ...]
  updated: <YYYY-MM-DD from `date +%F`>
  ---
  ```
- Body: the fact/note. Link related notes with `[[wikilinks]]` (a link to a
  not-yet-existing note is fine — it's a to-do marker).
- If it's a durable **memory**, also add a one-line pointer under "## Facts" in
  `memory/index.md`.
- After writing, add/refresh a one-line bullet under "## Recent" in `$VAULT/index.md`.

### search / find
`rg -i "<query>" "$VAULT"` (and search titles via `Glob`). Return matching notes
as clickable `path:line` refs with a one-line snippet each. Read the top hits and
synthesize a grounded answer — cite the note names.

### list
List notes by area (folder), newest first (`ls -t`). Keep it short.

### open
`open "$VAULT/<match>.md"` to open the note in Obsidian (macOS).

## Principles
- Plain Markdown + `[[wikilinks]]` only — no plugins required.
- One note = one thing; keep them small and linkable.
- Dates absolute; never "yesterday".
- Writing a note is local and safe. Anything outward (Slack/Jira/email) still
  requires explicit confirmation and goes through the harness guard hook.
