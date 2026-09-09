---
description: Review the current diff, branch, or a named PR through every lens that applies, merged into one ranked verdict.
argument-hint: "[PR number, URL, or nothing for the current branch]"
---

Call the **`harness-review`** skill (Skill tool) with `$ARGUMENTS`.

Nothing passed → review the current branch against its merge base with `main`. A number or URL
→ review that PR.

The skill classifies the diff, fans out one `review-lens` subagent per applicable lens
(security, boundaries, defects, quality), and merges the findings into a single ranked list
with one merge verdict. Read-only — it never pushes, merges, or edits code.
