---
name: harness-router
description: >
  Routing brain and session primer for the dev-ai-harness. Invoke this FIRST for any
  team/dev workflow request — "what should I look at today?", standup, sprint or team
  status, Jira hygiene, PRs needing review, support triage, meeting prep/follow-up,
  production health, review, onboarding, or any ambiguous ask about the user's work.
  It primes the profile, applies role-aware ordering, and dispatches to one skill.
  When the harness runs as a plugin (no repo CLAUDE.md loaded), this skill carries
  the routing that CLAUDE.md provides in the repo.
model: opus
effort: low
allowed-tools: Read, Grep, Glob, Skill, Bash(jq:*)
---

# Harness Router

Classify the ask, dispatch to exactly one skill, stop. The router never performs the
target's work — dispatching *is* the work.

## Inputs

1. `${CLAUDE_PLUGIN_ROOT}/definitions/registry.index.md` — **the routing index** (triggers →
   skill → tier, plus Reuse and Never-routable). Read this first, always.
2. `${CLAUDE_PLUGIN_ROOT}/definitions/registry.json` — the full entry (reads, writes, gates,
   subagents) for the ONE skill you picked. Never read the whole file to route.
3. `~/.claude/sosafe-harness/profile.json` — missing or `schema_version` ≠ 1 → tell the user
   to run `/setup`; generic asks still work. Never hardcode anything the profile holds.
4. `~/.claude/sosafe-harness/system.json` — what the user maintains, derived not self-reported.
5. `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json` — `person.role_class` sets ordering.

## Steps

1. Match the ask against the index's trigger column (skills and composites).
2. Call the winner via the **Skill tool** (or its slash command). One skill. Never inline its steps.
3. No confident match → name the two closest candidates in one line each and ask which.
   Don't improvise a workflow that isn't in the registry.
4. The ask is a marketplace capability (index "Reuse") → route there, don't rebuild it.
5. "Never routable" names are internal sub-agents of `sosafe-ai-harness-task-to-pr`.
   Never invoke them; route ticket-to-PR asks to `/ship`.

## Output

One line naming where you routed and why. Then the target skill's output — not a summary of it.
Keep to the eight-line ceiling unless the target is a scan.

## Gates

Read-only. The router itself touches no remote state; the dispatched skill owns its own
gates, and `hooks/confirm-outward-actions.sh` enforces them independently of prose.
