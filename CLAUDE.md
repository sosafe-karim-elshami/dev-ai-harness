# dev-ai-harness

A **role-aware team harness** for Claude Code. Any engineer or EM clones this repo, runs `/setup` once, and gets safe agentic workflows over their daily tools — Jira, GitHub, Slack, Calendar, Gmail, Confluence, Compass — grounded in a profile the harness discovers about *them*.

This file is loaded into every session in this repo. It is the routing brain.

## First thing every session

1. **Read `definitions/output-contract.md`.** It binds every reply. Verbosity is a bug.
2. Check `~/.claude/sosafe-harness/profile.json`. Missing or `schema_version` ≠ 1 → tell the user to run `/setup`; generic asks still work. Present → read it: it defines `person.role_class`, `team`, `repos`, `jira.project_keys`, `slack`. **Never hardcode any of this.**
3. Read `~/.claude/sosafe-harness/system.json` for what the user actually maintains — ownership, dependencies, service boundaries, derived from GitHub and Compass rather than self-reported. Stale or missing → `harness graph build --system`.
4. Let `person.role_class` (`ic` | `manager` | `staff`) shape ordering, per `definitions/role-playbooks.json`.

## Routing

**How to route:** call the target via the **Skill tool** (or its slash command). Never execute its steps inline — the Skill tool invocation *is* the routing. Depth for every entry below (reads, writes, gates, subagents) is in `definitions/registry.json`; read it when you need more than the destination.

<!-- BEGIN GENERATED ROUTING (harness registry sync) -->

<!-- Generated from definitions/registry.json. Do not hand-edit: `harness registry sync` overwrites it. -->

| Intent | Route to | Tier |
|---|---|---|
| set me up, onboard me, refresh my profile, first run | `/setup` → `harness-onboarding` | sonnet |
| clone my repos, pull the projects I maintain, set up my workspace, update my repos | `harness-workspace` | haiku |
| how's the sprint, team status, Jira hygiene, what PRs need review | `harness-pm` | sonnet |
| any support waiting, unanswered questions, triage support, anyone need a reply | `/triage` → `harness-support-triage` | opus |
| any errors, how's production, what's alerting, Sentry issues | `/monitoring` → `harness-monitoring` | sonnet |
| prep my next meeting, what's my 2pm about, agenda for standup, take notes | `/meeting` → `harness-meetings` | sonnet |
| wrap up today, what happened today, prepare for tomorrow, collect my action items | `/checkin` → `harness-checkin` | sonnet |
| groom my backlog, get my tickets ready, refine the backlog, sprint prep | `/groom` → `harness-groom` | opus |
| review this, review my changes, review this PR, is this ready to merge | `/review` → `harness-review` | opus |
| how's my career going, 1:1 growth prep, what should I present, visibility gap | `/growth` → `harness-growth` | opus |
| self-improve, how could the harness work better, reflect and improve | `/self-improve` → `harness-self-improve` | opus |
| which skill handles, what harness command does, is there a skill for | `harness-find-skill` | haiku |
| add analytics to a module, instrument module events, analytics hook, analytics ticket | `sosafe-elearning-analytics` | sonnet |
| Role-ordered daily driver. Scatter the scans, gather into one digest. | `/standup` (scatter/gather) | sonnet |
| CLI dev status at a glance; caches a structured snapshot for --cached re-render. | `harness dashboard` (scatter/gather) | sonnet |

**Reuse, never rebuild** — route by intent:

- metrics → `compass-analyst (sosafe-engineering-metrics)`
- pull-requests → `sosafe-pr-workflow`
- ticket-creation → `sosafe-planning`
- ticket-quality-size-split → `sosafe-ticket-loop`
- security-review → `sosafe-security`
- architecture-review → `sosafe-architecture`
- autonomous-code-to-pr → `sosafe-ai-harness-task-to-pr:implement-task`
- repo-claude-md → `sosafe-ai-harness-claude-md:generate-claude-md`
- notes-capture → `/notes (global, Obsidian vault)`

**Never routable** (internal sub-agents of `sosafe-ai-harness-task-to-pr`): `harness-developer`, `harness-reviewer`, `harness-tester`.

<!-- END GENERATED ROUTING -->

## Principles (non-negotiable)

- **Read-mostly by default.** Every workflow reads, summarizes, and drafts. It does not change remote state on its own.
- **Confirm before any outward/destructive action.** Slack posts, Jira transitions/creates/comments, Confluence edits, email, `git push`, `gh pr create|merge`. Batch them and ask **once**, naming every target. `.claude/hooks/confirm-outward-actions.sh` enforces this independently of prose — if you find it bypassed, stop and surface it.
- **Reuse the marketplace, don't rebuild it.** See the reuse map above.
- **Ground every answer.** Cite `path:line`, Jira keys, PR numbers, permalinks. Never invent.
- **Verify before you recall.** Memory and `knowledge/` reflect what was true when written. Confirm a file/flag/command still exists before recommending it; if it's gone, surface it for cleanup (`harness memory audit`). Check `knowledge/anti-patterns/` first — a match there is a known dead end.
- **Spend the right model.** Every skill declares a tier in the registry: haiku for mechanical work, sonnet for scan-and-summarize, opus for judgment. Fan work out to subagents at the declared tier rather than doing it inline at the session tier.
- **Private vs shared.** The profile and vault are per-user (`~/.claude/sosafe-harness/`). `knowledge/` is committed team memory. Don't put one where the other belongs.

## H2 2026 company strategy context

Full text in `knowledge/h2-2026-strategy.md` (source: Engineering Confluence). Ground any question about priorities or team direction against it.

- **Pillar 3 (AI Engineering Platform):** this harness IS the shared agent baseline Engineering is rolling out. The AI Guild is the cross-team alignment forum.
- **Pillar 1 (Resilient Operations):** monitoring scans surface Compass hygiene (ownership, security score) and CD adoption alongside Sentry — H2 OKR inputs, not optional.
- **Pillar 4 (Monolith decoupling):** E-Learning is at 84%/24% (code/data) against full contract-boundary isolation. Work on `fe-mf-course-engine`, `be-app-elearning`, or any shared-table path is in scope.
- **Not on the agenda:** multi-cloud, multi-region, major refactoring inside monoliths, a standalone AI pillar. Don't offer these.

## Layout

- `definitions/` — `registry.json` (routing + tiers, single source of truth), `output-contract.md` (reply rules), `profile.schema.json`, `role-playbooks.json`, `discovery-queries.json`, `urgency-matrix.json`, `mcp-fallbacks.json`, `eval/golden-tasks.jsonl`.
- `knowledge/` — committed team memory; `knowledge/anti-patterns/` is the negative-results store, checked before answering.
- `workspace/` — gitignored clones of the repos the user maintains (`harness-workspace`).
- `.claude/skills|commands|hooks` — the harness itself. Hooks: `confirm-outward-actions.sh` (PreToolUse guard) and `log-skill-run.sh` (PostToolUse observability → `runs.jsonl`, read by `harness metrics`).
- `cli/` — the `harness` CLI. `harness registry check` gates routing drift and is part of `harness eval`.

## Knowledge vault (Obsidian)

Each dev has a personal cross-session vault; **setup is shared, content is private**. The path is per-dev in `~/.claude/sosafe-harness/config.json` → `vaultPath` — always resolve it, never hardcode. It holds `memory/`, `meetings/`, `digests/`, `monitoring/`, `growth/`, `knowledge/` as plain Markdown with `[[wikilinks]]` and `type:` frontmatter.

- Shared and committed here: `definitions/vault-templates/`, `.claude/skills/harness-onboarding/scaffold-vault.sh`, `.claude/commands/notes.md`. `/setup` step 4 scaffolds the vault and records `vaultPath`.
- The global **`/notes`** command captures and searches the vault from any session or repo. Never write outside `vaultPath`; if unset, tell the user to run `/setup`.
- Vault writes are local and safe. Outward actions still go through the guard hook.
