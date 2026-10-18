Backlog grooming pass — sweep, quality-check, size, and split tickets so they walk
into refinement/sprint-planning ready. **Read-only by default; every Jira write is
batched and confirmed.**

Invoke **harness-groom**. It reuses the marketplace (does not reimplement grooming):

1. **Sweep** — `harness-pm` Jira hygiene: stale in-progress, missing estimates,
   unassigned active work, scoped to `jira.project_keys`.
2. **Readiness** — `sosafe-ticket-loop:check-ticket-quality` per candidate →
   verdict `feasible | too-big | blocked` + a suggested comment.
3. **Size** — `sosafe-ticket-loop:estimate-ticket-size` → per-criterion t-shirt sizes.
4. **Route** — `feasible` → keep (small, single-repo tickets get `next: /ship KEY`); `too-big` → offer `sosafe-ticket-loop:decompose-ticket`
   (delegates creation to `sosafe-planning:sosafe-jira-planning`); `blocked` → collect
   the missing info + suggested comment.
5. **Prioritize + save** — order by `${CLAUDE_PLUGIN_ROOT}/definitions/urgency-matrix.json`; write a groom
   snapshot to `$VAULT/digests/<date>-groom.md`.
6. **Apply (gated)** — batch every Jira write and ask once; autonomous runs draft only.

Scope it by naming a board, epic, sprint, or a single ticket (e.g. "/groom LTC-1299").
For general grooming, do **not** use `review-automated-tickets` — it's scoped to
`ai-automated` tickets in `Ready for Dev`; the sweep + per-ticket quality check is the path.

Requires the `sosafe-ticket-loop` and `sosafe-planning` marketplace plugins enabled
(`harness-pm` is built in). If either is missing, say so and run the steps it can.
