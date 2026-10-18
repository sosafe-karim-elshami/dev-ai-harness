# Browser smoke (fe- repos only)

Proves `verify_by: browser` rows against the running app with Chrome DevTools MCP. Nobody
else at SoSafe does this inside an agent loop yet; keep it cheap and evidence-first.

## Stack map

| repo | bring-up | base URL | teardown |
|---|---|---|---|
| `fe-mf-course-engine` | LT vault `harness/stacks/manager-mfe.yaml` via `/start-stack` (dev-ai-context-manager `start.sh FeCourseEngine`) | `http://localhost:4000` | `stop.sh --all` |
| `fe-lib-course-builder` | `npm run dev` in the worktree (no `course-player` manifest yet) | `http://localhost:5173` | kill the dev server you started |
| other `fe-` | repo `CLAUDE.md` dev command; else `SHIP_BLOCKED no-stack` | — | — |

Check the port first (`lsof -i :<port>`); a stack already running is reused, never restarted.
Prerequisites (VPN, CodeArtifact, `.env`) missing → report `browser: blocked (<why>)` and let
the reviewer treat the rows as unverified; do not loop.

## Delegation

Spawn `browser-smoke` (Task) with: base URL, the contract rows tagged `browser` (number +
statement + any route hints from the ticket), and `features/<KEY>/screenshots/` as the
screenshot dir. It returns one verdict per row with a screenshot path, console errors, and
failing requests.

## Evidence rules

- Every `pass` has a screenshot; a verdict without one is `not-verifiable`.
- Console errors fail a row unless the same error reproduces on `origin/main` (note it).
- Append a `## Browser` section to `verify-report.md` (row → verdict → screenshot) and fill
  `browser` in `verify-report.json`. Commit screenshots with `KEY Add browser evidence`.
