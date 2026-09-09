---
name: harness-groom
description: >
  Organize and groom the backlog: sweep the board for hygiene, quality-check each candidate
  ticket for readiness, size it, and split the too-big ones — so tickets walk into
  refinement/sprint-planning ready. Trigger on "/groom", "groom my backlog", "get my tickets
  ready", "refine the backlog", "sprint prep", "is this ticket ready?", or "split this
  ticket". Reuses the marketplace (harness-pm + sosafe-ticket-loop + sosafe-planning) — it
  does not reimplement grooming. Read-only by default; every Jira write is batched and
  confirmed, and the guard hook gates it.
model: opus
effort: high
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Task
  Skill
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__getTransitionsForJiraIssue
  mcp__claude_ai_Atlassian__transitionJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
---

# Harness Groom

Turn a messy backlog into a triaged, sized, ready list. This skill *orchestrates* — the
per-stage detail lives in **`pipeline.md`**, and the rubrics belong to `sosafe-ticket-loop`.

## Inputs

`profile.json` (missing → `/setup`): `jira.project_keys`, `person.role_class`. `$VAULT` from
`config.json` → `vaultPath`, else `.scratch/`. `definitions/urgency-matrix.json` for ordering.
Scope: default to `jira.project_keys`; a named board, epic, sprint, or single ticket narrows it.

## Steps

1. **Sweep** — call `harness-pm` for Jira hygiene, build the candidate list. `pipeline.md` §1.
2. **Fan out readiness** — one `ticket-readiness` subagent (Task tool) per candidate, in
   parallel. Each returns verdict + size + reason as JSON. `pipeline.md` §2.
3. **Route** each verdict: `feasible` keep, `too-big` offer a split, `blocked` collect what's
   missing. `pipeline.md` §3.
4. **Order and present** by the urgency matrix, one line per ticket; save the snapshot.
   `pipeline.md` §4.
5. **Batch every write** into a single confirmation. `pipeline.md` §5.

The keep/split/reject call is yours; the per-ticket checks are the subagents'. Don't
re-litigate their verdicts, but do overrule one when the ticket's context contradicts it —
and say why in the "why ready" line.

## Output

One line per ticket, ordered:

```
<pri> <flags> [KEY] <summary> — <size> — <verdict> — <next>
```

Then the counts (`N ready, N to split, N blocked`) and the snapshot path. Nothing else.

## Gates

Read-only by default — verdicts, sizes, and the list are computed without touching Jira. One
batched confirmation for all writes. Autonomous runs never write: save the draft and stop.
Guard hook blocks → record the proposed action and stop. Vault writes are safe.
