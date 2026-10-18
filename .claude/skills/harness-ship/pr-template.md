# Draft PR → title + body

Title: `<KEY> <Capitalized summary, no trailing period>` (matches the commit-subject rule).

```markdown
**Full detail:** [contract.md](features/<KEY>/contract.md) · [verify-report.md](features/<KEY>/verify-report.md) · [state.md](features/<KEY>/state.md) · [usage.md](features/<KEY>/usage.md)

## Summary
<2–4 lines: what changed and why, in the ticket's words>

## Contract → evidence
| # | Criterion | Verified by | Evidence |
|---|---|---|---|
| 1 | … | script | `npm run test:ci` ✓ (verify-report.md) |
| 2 | … | browser | screenshots/02-… .png |
| 3 | … | review | `src/x.ts:42` |

## Verification
- lint ✓ · typecheck N/A · test ✓ · build ✓ · semgrep 0 errors / 1 warning (see report)
- Fresh-context review: approve / N gaps closed

## Test plan
- [ ] Reviewer: open the screenshots and the contract table
- [ ] Reviewer: anything marked `review` deserves a second look

_Opened as a draft by the AI harness (`/ship`). Promotion to ready and merge are human steps._
```

Pass this verbatim to `sosafe-exp-squad-pr` with: **draft**, label `ai-harness` (`gh label
create ai-harness --color 0075ca --force` first), no Slack. Keep the repo's own PR template
checkboxes if it has one; tick only what applies.
