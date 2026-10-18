# Contract template → `features/<KEY>/contract.md`

```markdown
---
key: <KEY>
repo: <repo-name>
kind: fe | be
approved_at: <ISO timestamp or "autonomous">
source: <Jira URL>
---

# Contract — <KEY> <summary>

Every row is one acceptance criterion in EARS form. `verify_by` names the gate that proves it;
`evidence` is filled by the gates, never by hand.

| # | Statement (EARS) | verify_by | evidence |
|---|---|---|---|
| 1 | When <trigger>, the <system> shall <response> | script \| browser \| review | |
| 2 | While <state>, the <system> shall <response> | … | |
| 3 | If <error condition>, the <system> shall <response> | … | |

## Out of scope
- <from the ticket, or "none stated">

## Open questions
- <needs_clarification items; empty when approved>
```

EARS forms: *ubiquitous* "The <system> shall …"; *event* "When <trigger>, …"; *state* "While
<state>, …"; *unwanted* "If <condition>, … shall …"; *optional* "Where <feature>, …".

`verify_by` rules: `script` for anything a unit/integration test or type check can prove;
`browser` for visible behaviour in an `fe-` repo; `review` only when neither applies (the
reviewer must then cite `path:line`). Every AC sentence in the ticket maps to ≥1 row.
