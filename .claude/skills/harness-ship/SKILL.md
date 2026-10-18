---
name: harness-ship
description: >
  Take one Jira ticket to a verified DRAFT pull request: acceptance criteria become a
  numbered contract, the marketplace implement-task loop writes the code, a script re-runs
  lint/tests/build plus Semgrep, a browser smoke checks FE behaviour, a fresh-context
  reviewer grades the diff against the contract, then the draft PR opens and Jira moves to
  In Review. Trigger on "/ship <KEY>", "ship this ticket", "implement LTC-…", "take this to
  a draft PR". Never merges, never marks a PR ready, never pushes to main.
model: opus
effort: high
argument-hint: "<TICKET> [--dry-run | --until verify | --autonomous]"
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Task
  Skill
  EnterWorktree
  ExitWorktree
  Bash(git:*)
  Bash(gh pr list:*)
  Bash(gh pr view:*)
  Bash(gh pr checks:*)
  Bash(node:*)
  Bash(npm run:*)
  Bash(npx semgrep:*)
  Bash(semgrep:*)
  Bash(jq:*)
  Bash(lsof:*)
  Bash(date:*)
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getTransitionsForJiraIssue
  mcp__claude_ai_Atlassian__transitionJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
hooks:
  Stop:
    - hooks:
        - type: command
          command: bash "${CLAUDE_PLUGIN_ROOT}/.claude/hooks/ship-stop-gate.sh"
---

# Harness Ship

One ticket → one verified draft PR. You orchestrate; the marketplace writes the code; scripts
and a fresh reviewer decide whether it is done. Detail per step lives in the sibling files.

## Inputs

`$ARGUMENTS` = `KEY` plus flags. `profile.json` → `repos[].local_path`; LT registry at
`config.json → ltVaultPath` + `harness/products/*.yaml` (else Jira labels); `$VAULT` from
`config.json`. Mode: supervised (default) or autonomous (`--autonomous` / `HARNESS_AUTONOMOUS=1`).

## Steps

1. **Orient** — `getJiraIssue KEY`. Resolve the repo: registry `features[].repos` → Jira labels
   → `profile.repos`. More than one repo → stop with `SHIP_BLOCKED multi-repo`. Classify `fe-`/`be-`.
   Not arriving from `/groom` → run `sosafe-ticket-loop:check-ticket-quality`; `blocked`/`too-big` → stop.
   Jira unreachable (headless) → say so in one line and stop; never invent the ticket.
2. **Contract** — spawn `ac-contract` (Task) → JSON → render `contract-template.md` →
   `features/KEY/contract.md`. Supervised: show it, ask once "Approve this contract?". Autonomous:
   `needs_clarification` non-empty → `SHIP_BLOCKED`. `--dry-run` ends here (print repo, commands, steps).
3. **Worktree** — if `.claude/worktrees/` is ignored by neither `.gitignore` nor
   `.git/info/exclude`, append it to `.git/info/exclude` (local, never committed). `EnterWorktree`
   named `task/KEY-<kebab>` (fix/ for bugs). First commit: `contract.md` + `usage.md` header
   (`KEY Add ship contract`). Touch `features/KEY/ship.active`.
4. **Implement** — `Skill sosafe-ai-harness-task-to-pr:implement-task` with the prompt in
   `handoff.md`: the contract verbatim as the task, branch exists, stop after its Step 7.
5. **Verify gate** — per `verify-gate.md`: `harness-verify.mjs` with the discovered commands,
   then Semgrep on the diff → `features/KEY/verify-report.{md,json}`. FAIL → one fix pass
   through step 4 (cap 1), then `SHIP_BLOCKED`.
6. **Browser smoke (fe only)** — per `browser-smoke.md`: bring the stack up, spawn
   `browser-smoke` with the `browser` items → screenshots + verdicts appended to the report; tear down.
7. **Contract review** — spawn `contract-reviewer` with contract + `git diff origin/main...HEAD`
   + verify report. `gaps[]` → one fix pass (cap 1), re-run 5–6; still gaps → `SHIP_BLOCKED`.
8. **Draft PR** — supervised: show title `KEY <Summary>` + `pr-template.md` body once, then
   `Skill sosafe-pr-workflow:sosafe-exp-squad-pr` with "DRAFT, label ai-harness, no Slack".
   If it cannot reach Jira, do the In Review transition yourself (gated). `--until verify` or
   autonomous: write `features/KEY/pr.md` and never push.
9. **Digest** — `$VAULT/digests/<date>-ship-KEY.md` per `digest-template.md`; link it from
   `$VAULT/index.md`. Remove `ship.active`.
10. **Report** — ≤8 lines: PR URL (draft), `N/N contract items verified`, cost from `usage.md`,
    digest path. Last line is `SHIP_COMPLETE` or `SHIP_BLOCKED <reason>`.

## Output

The report above. Every claim of "verified" points at a line in `verify-report.md` or a
screenshot; a bare "tests pass" is a defect.

## Gates

Never `gh pr merge`, never `gh pr ready`, never push `main`; the PR is always `--draft`.
`deny-destructive.sh` enforces this regardless of mode. Autonomous runs never write remote
state (push, PR, Jira land in `pr.md`). Never skip the verify gate "because the diff is small".
