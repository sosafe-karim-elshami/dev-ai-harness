---
name: harness-router
description: >
  Routing brain and session primer for the dev-ai-harness. Invoke this FIRST for
  any team/dev workflow request — "what should I look at today?", standup, sprint
  or team status, Jira hygiene, PRs needing review, support triage, meeting
  prep/follow-up, production health/monitoring, "set me up"/onboarding, or any
  ambiguous ask about the user's work. It checks the profile, applies role-aware
  ordering, and dispatches to the right harness skill or command. When the harness
  is installed as a plugin (no repo CLAUDE.md is loaded), this skill carries the
  routing that CLAUDE.md provides in the repo.
---

# Harness Router

The entry point for the harness. It grounds every workflow in the user's profile
and hands off to the right specialized skill/command. It does not perform outward
actions itself — it dispatches.

## First thing

1. Check for the profile at `~/.claude/sosafe-harness/profile.json`.
   - **Missing or `schema_version` ≠ 1** → tell the user to run `/setup` (or invoke
     the `harness-onboarding` skill) before role-aware work. Generic asks (e.g.
     "summarize this PR") still work without it.
   - **Present** → read it. It defines the user (`person.role_class`), their `team`,
     `repos`, `jira.project_keys`, and `slack` channels. **Never hardcode any of
     this — always read it from the profile.**
2. Let `person.role_class` (`ic` | `manager` | `staff`) shape ordering and emphasis,
   per `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json`.

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
| "self-improve", reflect and propose harness improvements | `/self-improve` → `harness-self-improve` |
| create a PR / branch | reuse `sosafe-pr-workflow` (don't reimplement) |
| break work into Jira tickets | reuse `sosafe-planning` |
| security / architecture review | reuse `sosafe-security` / `sosafe-architecture` |

## Principles (non-negotiable)

- **Read-mostly by default.** Every workflow reads, summarizes, and drafts. It does
  not change remote state on its own.
- **Confirm before any outward/destructive action.** Posting to Slack,
  transitioning/creating/commenting on Jira, editing Confluence, sending email,
  `git push`, `gh pr create|merge`. Batch them and ask **once**, naming every
  target. The plugin's `PreToolUse` hook (`hooks/hooks.json` →
  `confirm-outward-actions.sh`) enforces this independently of prose — if you ever
  find it bypassed, stop and surface it.
- **Reuse the marketplace, don't rebuild it.** Metrics → `compass-analyst`. PRs →
  `sosafe-pr-workflow`. Ticket creation → `sosafe-planning`. Reviews →
  `sosafe-security`/`sosafe-architecture`. These come from the
  `sosafe-claude-market` marketplace; ensure it is added (see `/setup` step 1).
- **Ground every answer.** Cite sources — code in `workspace/`, `knowledge/`
  entries, Confluence pages, Jira keys, Slack permalinks. Never invent.
- **The profile is per-user and private** (`~/.claude/sosafe-harness/`). The
  `knowledge/` folder is shared team memory. Don't put one where the other belongs.

## Definitions & knowledge

- `${CLAUDE_PLUGIN_ROOT}/definitions/` — `profile.schema.json` (validate the
  profile), `role-playbooks.json` (role emphasis), `discovery-queries.json`
  (read-only query templates).
- `${CLAUDE_PLUGIN_ROOT}/knowledge/` — the harness's baseline team memory shipped
  with the plugin. Growing it (as `harness-support-triage` does) is committed back
  to the harness repo via PR, since the installed plugin cache is replaced on update.
