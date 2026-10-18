---
paths:
  - "definitions/vault-templates/**"
  - "definitions/retention.json"
  - "cli/src/archive.ts"
  - "cli/src/compress.ts"
  - "cli/src/links.ts"
  - "cli/src/vault-index.ts"
  - ".claude/commands/notes.md"
  - ".claude/skills/harness-meetings/**"
  - ".claude/skills/harness-checkin/**"
  - ".claude/skills/harness-monitoring/**"
---
# Knowledge vault (Obsidian) conventions

Each dev has a personal cross-session vault; **setup is shared, content is private**. Path: `~/.claude/sosafe-harness/config.json → vaultPath` — always resolve it, never hardcode. Folders: `memory/`, `meetings/`, `digests/`, `monitoring/`, `growth/`, `knowledge/`; plain Markdown with `[[wikilinks]]` and `type:` frontmatter.

- Shared and committed here: `definitions/vault-templates/`, `.claude/skills/harness-onboarding/scaffold-vault.sh`, `.claude/commands/notes.md`. `/setup` step 4 scaffolds the vault and records `vaultPath`.
- Never write outside `vaultPath`; if unset, tell the user to run `/setup`. Vault writes are local and safe; outward actions still go through the guard hook.
- **Retention:** dated notes age out of the live folders per `definitions/retention.json` via `harness archive` / `harness compress` (launchd, Monday 07:50). Nothing is ever deleted. Full-path links are rewritten on move; avoid `../` relative links.
- Carry-forward source for a new daily digest is the newest live note in `digests/` (a daily or a `weekly/` rollup).
