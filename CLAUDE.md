# dev-ai-harness

A **role-aware team harness** for Claude Code. Any engineer or EM clones this repo, runs `/setup` once, and gets safe agentic workflows over their daily tools — Jira, GitHub, Slack, Calendar, Gmail, Confluence, Compass — grounded in a profile the harness discovers about *them*.

This file is loaded into every session in this repo. It is the routing brain.

## First thing every session

1. Check for the profile at `~/.claude/sosafe-harness/profile.json`.
   - **Missing or `schema_version` ≠ 1** → tell the user to run `/setup` (or invoke the `harness-onboarding` skill) before doing role-aware work. Generic asks (e.g. "summarize this PR") still work without it.
   - **Present** → read it. It defines the user (`person.role_class`), their `team`, `repos`, `jira.project_keys`, and `slack` channels. **Never hardcode any of this — always read it from the profile.**
2. Let `person.role_class` (`ic` | `manager` | `staff`) shape ordering and emphasis, per `definitions/role-playbooks.json`.

## Routing

| User intent | Route to |
|---|---|
| "set me up", first run, refresh my context | `/setup` → `harness-onboarding` |
| "clone my repos", "pull the projects I maintain" | `harness-workspace` |
| "what should I look at today?", daily driver | `/standup` |
| Jira hygiene, sprint/status, PR tracking, "how's the team doing?" | `harness-pm` (delegates metrics to `compass-analyst`) |
| unanswered support, "anyone need a reply?" | `/triage` → `harness-support-triage` |
| production health, "any errors?", "what's alerting?", Sentry/Datadog/Amplitude | `/monitoring` → `harness-monitoring` |
| prep/run a meeting, agenda, action items | `/meeting` → `harness-meetings` |
| transcribed/finished meeting, "ingest my Gemini notes", follow up on a meeting | `/meeting` (follow-up mode) → `harness-meetings` |
| "show my dashboard", dev status at a glance | `harness dashboard` (CLI) → composes `harness-pm` + `harness-support-triage` + `harness-meetings` |
| "self-improve", reflect and propose harness improvements | `/self-improve` → `harness-self-improve` |
| capture/find a note, "add this to my notes", "what did I write about X" | `/notes` (global) → the Obsidian vault |
| create a PR / branch | reuse `sosafe-pr-workflow` (don't reimplement) |
| break work into Jira tickets | reuse `sosafe-planning` |
| security / architecture review | reuse `sosafe-security` / `sosafe-architecture` |

## Principles (non-negotiable)

- **Read-mostly by default.** Every workflow reads, summarizes, and drafts. It does not change remote state on its own.
- **Confirm before any outward/destructive action.** Posting to Slack, transitioning/creating/commenting on Jira, editing Confluence, sending email, `git push`, `gh pr create|merge`. Batch them and ask **once**, naming every target. A `PreToolUse` hook (`.claude/hooks/confirm-outward-actions.sh`) enforces this independently of prose — if you ever find it bypassed, stop and surface it.
- **Reuse the marketplace, don't rebuild it.** Metrics → `compass-analyst`. PRs → `sosafe-pr-workflow`. Ticket creation → `sosafe-planning`. Reviews → `sosafe-security`/`sosafe-architecture`.
- **Ground every answer.** Cite sources — code in `workspace/`, `knowledge/` entries, Confluence pages, Jira keys, Slack permalinks. Never invent.
- **The profile is per-user and private** (`~/.claude/sosafe-harness/`). The `knowledge/` folder is shared team memory and is committed. Don't put one where the other belongs.

## Layout

- `definitions/` — `profile.schema.json` (validate the profile), `role-playbooks.json` (role emphasis), `discovery-queries.json` (read-only query templates).
- `knowledge/` — committed, shareable team memory. Workflows check it first; `harness-support-triage` grows it.
- `workspace/` — gitignored; the repos the user maintains, cloned by `harness-workspace`.
- `.claude/skills|commands|hooks` — the harness itself.

## Knowledge vault (Obsidian)

Each dev has a **personal, cross-session knowledge base** as an Obsidian vault; the **setup is shared** and the **content is private**. The vault path is per-dev, recorded in `~/.claude/sosafe-harness/config.json` → `vaultPath` (never hardcode it — always resolve it). It holds `memory/`, `meetings/`, `digests/`, `monitoring/`, and `knowledge/`, all plain Markdown with `[[wikilinks]]` and `type:` frontmatter.

- **Shared (committed here):** `definitions/vault-templates/` (scaffold source), `.claude/skills/harness-onboarding/scaffold-vault.sh`, the `.claude/commands/notes.md` command, and the skill wiring. `/setup` step 4 scaffolds each dev's vault from the templates and records their `vaultPath`.
- **Private (never committed):** the dev's vault folder and its notes.
- The global **`/notes`** command captures/searches the vault from **any** session or repo — resolve `vaultPath` first, never write outside it; if unset, tell the user to run `/setup`.
- `harness-meetings` writes agendas/notes to `$VAULT/meetings/`; `/standup` saves digests to `$VAULT/digests/`; `harness-monitoring` saves snapshots to `$VAULT/monitoring/`. All fall back gracefully if the vault path is unset.
- Writing a note is local and safe; outward actions still go through the guard hook.

