# Growth modes

Five modes. Rules and the visibility ladder they all reference: `principles.md`.

## visibility-audit

**Trigger:** "what's my visibility gap?", "what have I done lately?", before any 1:1 or review.

1. Merged PRs from the last 14 days across `profile.repos`, author = `person.github_login`.
2. Closed Jira assigned to `person.jira_account_id` in the same window.
3. Per significant item (skip dependency bumps and one-line fixes): search Confluence for a
   page matching the Jira key or PR title; check whether the PR body is non-trivial; check the
   vault for a related note.
4. Apply the review-quality rule from `principles.md` to PRs the user reviewed.
5. Bucket into **fully visible** (ladder 4–5), **partially visible** (2–3), **invisible** (1) —
   and for each invisible item, name the minimum artifact that fixes it.
6. Surface the single highest-ROI action. Usually one Confluence page, or one sentence on the
   next review.

## idp-check

**Trigger:** "IDP check", "how am I tracking against my goals?", before a review cycle.

1. Read the IDP: `$VAULT/IDP.md` or `$VAULT/../IDP.md` (try both). Read-only, always.
2. Extract each goal, its success metrics, its target date.
3. Per goal, pull evidence: closed Jira in the goal's domain (labels, keywords), merged PRs
   with matching context, vault notes referencing it.
4. Rate **green** (evidence supports met) / **yellow** (partial) / **red** (no evidence or
   missed). For yellow and red, name the specific gap and the minimum next action.
5. Surface the goal most at risk of being dismissed in a performance conversation — that's the
   one to own proactively rather than defensively.

## talk-prep

**Trigger:** "what should I present?", "knowledge sharing prep", "help me structure a talk",
"turn this into a deck".

1. Read vault notes outside `meetings/` with technical depth: architecture summaries,
   investigations, "how it works" explanations, decision rationale. Also check `$VAULT/../`.
2. Score each: clear problem statement (+1), before/after comparison (+1), references real
   production data or incidents (+1), relevant to more than one teammate (+1), not already
   presented — no Confluence page found (+1).
3. Surface the top 2–3 with scores and a proposed title.
4. For the top scorer, generate the structure: the problem in business/user cost terms (5 min)
   → the constraints that shaped the solution (3 min) → the solution and why it works (10–15
   min) → a real example or demo (5 min) → how others contribute (3 min).
5. Name the three artifacts to publish alongside: a Confluence page (their name, permanent), a
   recording linked from Confluence and the team channel, and a `CONTRIBUTING-*.md` in the repo.
6. `--artifact slides` → draft the deck locally first; creating the Google Slides deck via
   `gws-slides` is gated on explicit confirmation.

## 11-prep (growth-focused 1:1)

**Trigger:** "1:1 growth prep", "prep my 1:1 with <manager>", or when a 1:1 is being prepped
and the user mentions career, salary, or growth.

1. **visibility-audit** in summary mode: top 3 visible wins, top 1 invisible gap.
2. **idp-check** in summary mode: one line per goal.
3. Open actions from the most recent 1:1 note — did anything from last time actually get done?
4. Build the agenda in the Tight Loop format:
   1. One question for architectural feedback — not "did I do X right" but "how should we think
      about Y".
   2. One risk to align on before it becomes a problem.
   3. One career topic: growth, visibility, compensation, next level.
   4. One thing to explicitly drop — low-value work to trade away.
5. Compensation relevant (user raises it, or the last increase was > 12 months ago per vault
   notes) → surface the evidence bucket (ladder 4–5 items), suggest the framing (specific
   number, specific timeframe, *"what would need to be true?"* as the question), and flag any
   open work that weakens the case.
6. Write to `$VAULT/meetings/<date>-<slug>.md` per `../harness-meetings/note-template.md`, with
   a `## Growth Agenda` section above `## Agenda`.

## stale-work-radar

**Trigger:** invoked automatically by visibility-audit and 11-prep; directly on "what's stale?",
"what should I close?".

1. Open PRs authored by the user across `profile.repos`; flag any open > 7 days with no recent
   activity.
2. Jira assigned to the user in In Review / In Progress / Blocked; flag anything not updated in
   > 14 days.
3. Per stale item, propose exactly one of: **merge**, **close/descope**, or **explicitly
   unblock** — naming what's blocking it.
