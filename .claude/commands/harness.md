"What should I look at?" — the role-aware entry point.

## Steps

1. Read `~/.claude/sosafe-harness/profile.json`. If missing or `schema_version` ≠ 1, run `/setup` first.
2. Look up `person.role_class` in `${CLAUDE_PLUGIN_ROOT}/definitions/role-playbooks.json` to get this user's `standup_order` and emphasis.
3. If the user gave a specific intent (e.g. "what PRs need review?", "prep my 2pm", "any support waiting?"), route directly to the matching skill: `harness-pm`, `harness-meetings`, or `harness-support-triage`.
4. Otherwise, give a brief role-aware menu of what you can do now (PM summary, support scan, meeting prep, clone/update repos) and offer to run `/standup` for the full picture.

Stay read-only here — this is a dispatcher, not an action.
