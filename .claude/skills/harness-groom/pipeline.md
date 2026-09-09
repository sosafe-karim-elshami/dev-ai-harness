# Grooming pipeline

Detail for each stage. **Reuse, don't rebuild:** this pipeline orchestrates existing skills.
Never reimplement hygiene queries, quality checks, sizing, or ticket creation.

## 1 — Sweep the board

Call `harness-pm` (its Jira-hygiene capability) scoped to `jira.project_keys` for stale
in-progress, missing estimates, and unassigned active work. That's the "what's rotting"
pass — read-only, gather, fix nothing.

Build the **candidate list**: backlog and to-do items, plus anything hygiene flagged. Skip
anything already In Review or Done.

## 2 — Readiness per ticket

Spawn one `ticket-readiness` subagent (Task tool) per candidate. Each returns JSON with a
verdict (`feasible` / `too-big` / `blocked`), a per-criterion t-shirt size, the reason, and
`sosafe-ticket-loop`'s suggested comment. They fan out in parallel — don't loop inline.

The subagent delegates to `sosafe-ticket-loop:check-ticket-quality` and
`:estimate-ticket-size`. Those own the rubric and the sizing model.

> ⚠️ Never use `review-automated-tickets` for general grooming — it's scoped to
> `ai-automated`-labelled tickets in the `Ready for Dev` column and will silently skip an
> untagged backlog.

## 3 — Route each verdict

| Verdict | Route |
|---|---|
| `feasible` | Keep in the groomed list with its size and a one-line "why ready". |
| `too-big` | Offer `sosafe-ticket-loop:decompose-ticket` to split into linked subtasks that each pass the quality check. It delegates creation to `sosafe-planning:sosafe-jira-planning`. Creates tickets → **gated**. |
| `blocked` | Collect the suggested comment plus the missing info into a "not ready" list. Posting the comment or pinging the author → **gated**. |

## 4 — Prioritize and present

Order by `definitions/urgency-matrix.json`: leadership/overdue first, then P1 → P2 → P3, then
due date. One line per ticket:

```
<pri> <flags> [KEY] <summary> — <size> — <verdict> — <next: keep | split | needs: …>
```

Save a snapshot to `$VAULT/digests/<YYYY-MM-DD>-groom.md` (`type: groom`, `tags: [harness,
groom]`) and add a `[[wikilink]]` under "## Recent" in `$VAULT/index.md`. Skip silently if
`vaultPath` is unset. Local write — safe, no confirmation needed.

## 5 — Apply (gated)

Collect **every** proposed Jira write — estimates, splits, comments, re-assignments,
transitions — into one batch. Show each key and its exact change, then ask once:

> Apply these N changes? (yes = write to Jira as listed; no = keep as draft)

On yes: `editJiraIssue` / `addCommentToJiraIssue` / `transitionJiraIssue`, and
`decompose-ticket` for splits. Report what succeeded and what failed. The guard hook fires
per call as defense-in-depth. Autonomous runs never write — save the draft list and stop.
