# Ship digest → `$VAULT/digests/<YYYY-MM-DD>-ship-<KEY>.md`

```markdown
---
type: ship
date: <YYYY-MM-DD>
ticket: <KEY>
repo: <repo>
pr: <URL or "not opened (--until verify)">
cost_usd: <from features/<KEY>/usage.md ## Cost>
tags: [harness, ship, <KEY>]
---

# Ship — <KEY> <summary>

PR: <URL> (draft) · branch `task/<KEY>-…` · verdict `<SHIP_COMPLETE | SHIP_BLOCKED reason>`

## Contract → evidence
<the same table as the PR body>

## Gates
- verify: <PASS/FAIL> · semgrep <e>/<w> · browser <pass>/<fail>/<skipped> · reviewer <approve|changes>

## Blockers / follow-ups
- <or "none">

## Cost
<usage.md ## Cost section, verbatim>
```

Add `- [[digests/<date>-ship-<KEY>|🚢 <KEY>]] — <one line>` under `## Recent` in `$VAULT/index.md`.
