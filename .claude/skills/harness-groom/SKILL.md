---
name: harness-groom
description: >
  Organize and groom the backlog: sweep the board for hygiene, quality-check each
  candidate ticket for readiness, size it, and split the too-big ones — so tickets
  walk into refinement/sprint-planning ready. Trigger on "/groom", "groom my
  backlog", "get my tickets ready", "refine the backlog", "sprint prep", "is this
  ticket ready?", or "split this ticket". Reuses the marketplace (harness-pm +
  sosafe-ticket-loop + sosafe-planning) — it does not reimplement grooming.
  Read-only by default; every Jira write is batched and confirmed (guard hook gates it).
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Skill
  Bash(jq:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__getTransitionsForJiraIssue
  mcp__claude_ai_Atlassian__transitionJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
effort: high
---

# Harness Groom

A **read-mostly backlog grooming pass**. It turns a messy backlog into a triaged,
sized, ready list — reusing marketplace skills for the heavy lifting and ordering
everything by the shared urgency matrix. Nothing is written to Jira without an
explicit `yes`.

**Reuse, don't rebuild** (per CLAUDE.md): this skill *orchestrates* existing skills.
Do not reimplement hygiene queries, quality checks, sizing, or ticket creation.

## Setup

1. Read `~/.claude/sosafe-harness/profile.json` (missing → tell the user to run
   `/setup`; do what's possible). Use `jira.project_keys`, `person.role_class`.
2. Resolve `$VAULT` via `jq -r '.vaultPath' ~/.claude/sosafe-harness/config.json`
   (fall back to `.scratch/` if unset).
3. Read `definitions/urgency-matrix.json` — used to prioritize/order the groomed list.
4. Scope: default to the user's `jira.project_keys`. If the user names a board,
   epic, sprint, or single ticket, groom just that.

## Step 1 — Sweep the board (reuse `harness-pm`)

Invoke **`harness-pm`** (capability 1, "Jira hygiene") to surface, scoped to
`jira.project_keys`: stale in-progress, **missing estimates**, and unassigned active
work. This is the "what's rotting / unready" pass. **Read-only — gather, don't fix yet.**

Build the **candidate list**: backlog + to-do items (plus anything hygiene flagged) that
are grooming candidates. Skip items already In Review / Done.

## Step 2 — Readiness check per ticket (reuse `sosafe-ticket-loop:check-ticket-quality`)

For each candidate, invoke **`sosafe-ticket-loop:check-ticket-quality`** to get a
structured verdict — **`feasible` / `too-big` / `blocked`** — plus its suggested comment.
The validator never posts or routes; **this skill owns the routing** (Step 4).

> ⚠️ Do **not** use `review-automated-tickets` for general grooming — its source scopes it
> to `ai-automated`-labeled tickets in the `Ready for Dev` column only. For an untagged
> backlog, the `harness-pm` sweep + per-ticket `check-ticket-quality` is the right path.

## Step 3 — Size the feasible ones (reuse `sosafe-ticket-loop:estimate-ticket-size`)

For each `feasible` ticket (and any `too-big` before splitting), invoke
**`sosafe-ticket-loop:estimate-ticket-size`** for a per-criterion t-shirt size
(overall + business-logic + UI + technical, XS–XL). Pure estimate — it does not write to Jira.

## Step 4 — Route each verdict

- **`feasible`** → keep in the groomed list with its size + a one-line "why ready".
- **`too-big`** → offer **`sosafe-ticket-loop:decompose-ticket`** to split into linked
  subtasks that each pass `check-ticket-quality` (it delegates creation to
  `sosafe-planning:sosafe-jira-planning`). Splitting **creates tickets → gated** (Step 6).
- **`blocked`** → collect the suggested comment + the missing info; add to a
  "not ready" list. Posting the comment / pinging the author is **gated** (Step 6).

## Step 5 — Prioritize + present (urgency matrix)

Order the groomed list with `definitions/urgency-matrix.json`: leadership/overdue first,
then P1 → P2 → P3, then due date. Present one line per ticket:

```
<pri> <flags> [KEY] <summary> — <size> — <verdict> — <next: keep | split | needs: …>
```

Save a groom snapshot to `$VAULT/digests/<YYYY-MM-DD>-groom.md` (local, safe) with
frontmatter (`type: groom`, `tags: [harness, groom]`) and add a `[[wikilink]]` under
"## Recent" in `$VAULT/index.md`. Skip silently if `vaultPath` is unset.

## Step 6 — Apply changes (gated)

Collect every proposed Jira write — estimates to set, tickets to split/create, comments
to post, re-assignments, transitions — into **one batch**. Show the full list (each key +
the exact change) and ask **once**:

> "Apply these N changes? (yes = write to Jira as listed; no = keep as draft)"

On `yes`: apply via `editJiraIssue` / `addCommentToJiraIssue` / `transitionJiraIssue`, and
`decompose-ticket` for splits. The `confirm-outward-actions.sh` guard hook fires per call
as defense-in-depth. In **autonomous** runs: never write — save the draft list and stop.
Report what succeeded / failed.

## Safety rules

- **Read-only by default.** Sizes, verdicts, and the groomed list are computed without
  touching Jira. No mutation without an explicit `yes`.
- **Guard hook applies.** If it blocks an outward call, record the proposed action and stop.
- **Vault writes are safe** and need no confirmation.
