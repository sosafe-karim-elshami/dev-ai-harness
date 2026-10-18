# Verify gate → `features/<KEY>/verify-report.{md,json}`

External verification, never self-report. Run these yourself with the Bash tool, in the
worktree, after implement-task returns.

## 1. Resolve commands (never invent)

Order: repo `CLAUDE.md` statements → `package.json` scripts `harness:lint|test|build|typecheck`
(a repo's explicit override for this gate) → `lint`, `test:ci` else `test`, `build`, `typecheck`.
Missing category = `not available` (the report says so; the reviewer treats it as a gap for
`script`-verified rows).

## 2. Deterministic re-run

```
node "$(ls -d ~/.claude/plugins/cache/sosafe-claude-market/sosafe-ai-harness/*/task-to-pr/scripts 2>/dev/null | head -1 || echo ~/.claude/plugins/marketplaces/sosafe-claude-market/plugins/sosafe-ai-harness/task-to-pr/scripts)/harness-verify.mjs" \
  --lint "<cmd>" --test "<cmd>" --build "<cmd>" [--typecheck "<cmd>"] > features/<KEY>/verify-stdout.txt 2>&1; echo "exit=$?"
```

Exit `0` PASS, `1` FAIL, `2` INCONCLUSIVE (dirty tree or nothing discoverable). Read only the
tail you need; the full stdout stays in the file. An auth/CodeArtifact failure (`E401`,
"Unable to authenticate") is an environment problem: say so and stop, it is not a fix pass.

## 3. Semgrep on the diff

```
semgrep --config p/ci --config p/react --baseline-commit "$(git merge-base origin/main HEAD)" \
  --error --json --quiet > features/<KEY>/semgrep.json; echo "exit=$?"
```

`ERROR` findings block (FAIL); `WARNING` findings go to the contract reviewer. `semgrep` missing
→ record `semgrep: not installed` in the report; the reviewer treats security rows as unverified.

## 4. Write the report

`verify-report.json`:
```json
{ "verdict": "PASS|FAIL|INCONCLUSIVE", "ran_at": "<ISO>", "commit": "<sha>",
  "commands": [{ "category": "lint", "command": "...", "result": "PASS|FAIL|N/A", "exit": 0 }],
  "semgrep": { "errors": 0, "warnings": 0, "findings": [{ "check_id": "", "path": "", "line": 0, "severity": "" }] },
  "browser": null }
```
`verify-report.md` is the human twin: one line per command, the Semgrep counts, and the
contract rows this gate proves (`verify_by: script`) with the command as evidence. The browser
step appends its section later. Commit both with `KEY Add verify report`.
