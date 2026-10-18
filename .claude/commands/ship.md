---
description: Take one Jira ticket to a verified DRAFT PR — contract, implement-task, script + Semgrep + browser gates, fresh review, draft PR, Jira → In Review.
argument-hint: "<TICKET> [--dry-run | --until verify | --autonomous]"
---

Call the **`harness-ship`** skill (Skill tool) with `$ARGUMENTS`.

`--dry-run` stops after the contract (no worktree, no code). `--until verify` runs every gate
but writes `features/<KEY>/pr.md` instead of pushing. The PR is always a draft; promoting it
and merging are human steps. Never invoke `sosafe-ai-harness-task-to-pr:implement-task`
directly for ticket work — `/ship` wraps it with the contract and the gates.
