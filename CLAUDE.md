# dev-ai-harness

Role-aware team harness for Claude Code: profile-grounded, read-mostly agentic workflows over Jira, GitHub, Slack, Calendar, Gmail, Confluence, and Compass. This file is the session primer. Routing lives in the registry, not here.

## First thing every session

1. `~/.claude/sosafe-harness/profile.json` — missing or `schema_version` ≠ 1 → tell the user to run `/setup`; generic asks still work. It defines `person.role_class`, `team`, `repos`, `jira.project_keys`, `slack`. Never hardcode any of it.
2. `~/.claude/sosafe-harness/system.json` — what the user maintains, derived from GitHub and Compass. Stale or missing → `harness graph build --system`.
3. `person.role_class` (`ic` | `manager` | `staff`) orders every digest, per `definitions/role-playbooks.json`.

## Routing

`harness-router` reads `definitions/registry.index.md` (triggers → skill → tier) and the full `definitions/registry.json` entry only for the skill it picks. Route through the Skill tool; never execute a skill's steps inline. Capabilities the index lists under "Reuse" are routed to the marketplace, never rebuilt. Names under "Never routable" are never invoked.

## Principles

- **Read-mostly.** Workflows read, summarize, and draft. Outward actions — Slack, Jira, Confluence, email, `git push`, `gh pr create|ready|merge` — are batched into one confirmation naming every target; `.claude/hooks/` enforces this independently of prose. Merge, push to main, and destructive git are denied outright.
- **Lead with the answer.** Eight lines is the default ceiling; detail goes to the vault file and chat gets the headline plus the path. Full rules in `definitions/output-contract.md` — read it when authoring or evaluating a skill, not every session.
- **Ground every claim** as `path:line`, Jira key, PR number, or permalink. A missing integration is one line: "not configured".
- **Verify before you recall.** Memory and `knowledge/` were true when written; confirm a file or flag still exists before recommending it, and check `knowledge/anti-patterns/` first.
- **Spend the right model.** Tiers live in the registry: haiku for mechanical, sonnet for scan-and-summarize, opus for judgment. Fan out to subagents at their tier; subagents reply sentinel + JSON per `definitions/agent-output-contract.md`.
- **Private vs shared.** Profile and vault are per-user under `~/.claude/sosafe-harness/` (vault path: `config.json → vaultPath`); `knowledge/` is committed team memory.

## Layout

- `definitions/` — `registry.json` (+ generated `registry.index.md`), `output-contract.md`, `agent-output-contract.md`, `profile.schema.json`, `role-playbooks.json`, `urgency-matrix.json`, `mcp-fallbacks.json`, `retention.json`, `eval/golden-tasks.jsonl`.
- `.claude/skills|commands|agents|hooks|rules` — the harness itself. Rules load by path: `rules/strategy.md` (company context), `rules/vault.md` (vault conventions).
- `knowledge/` — team memory; `anti-patterns/` is the negative-results store.
- `cli/` — the `harness` CLI: `registry check|sync`, `eval`, `metrics`, `doctor`, `archive`, `compress`, `sync`.
- `workspace/` — gitignored clones of the user's repos.
