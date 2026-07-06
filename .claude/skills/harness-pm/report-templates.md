# PM report templates

Keep output skimmable. Lead with the section that matches the user's `role_class` (`role-playbooks.json`). Always link issues (`<JIRA_URL>/browse/KEY`) and PRs.

## Status summary

```
## <Team> — sprint status (<sprint name / dates>)
**Health:** <one line — on track / at risk / blocked>

- Done: <n>   In progress: <n>   Blocked: <n>   To do: <n>
- At risk: <KEY — title — why (1 line)> …
- Changed since last <N>d: <KEY — what changed> …
```

## Jira hygiene

```
## Jira hygiene — <project_keys>
### Stale in progress (> 5d)   (<n>)
- KEY — title — owner — last update <Nd ago>   → propose: <action>

### Missing estimates in sprint   (<n>)
- KEY — title — owner   → propose: add estimate

### Unassigned active work   (<n>)
- KEY — title — status   → propose: assign to <suggested?>

> Want me to apply any of these? I'll batch them and confirm before anything changes.
```

## PR tracking

```
## PRs across your repos
### Awaiting your review   (<n>)
- repo#NN — title — author — opened <Nd ago>   <url>

### Approved, not merged   (<n>)
- repo#NN — title — author   <url>

### Stale (no update > 3d)   (<n>)
- repo#NN — title — author — last update <Nd ago>   <url>

### Your open PRs   (<n>)
- repo#NN — title — <draft|ready> — reviewDecision   <url>
```
