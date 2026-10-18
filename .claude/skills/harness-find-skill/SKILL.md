---
name: harness-find-skill
description: >
  Given a task or intent, finds the most relevant locally INSTALLED skill(s) — spanning
  harness, SoSafe marketplace, and global skills. Use when asking "which installed skill
  handles X?", "what harness command does X?", or "is there a skill for X?". Distinct from
  find-skills, which discovers skills to install from the ecosystem.
model: haiku
effort: low
allowed-tools: Read, Grep, Glob, Bash(find:*), Bash(ls:*), Bash(jq:*)
---

# Harness Find Skill

Answer "which skill handles this?" from the registry first — it's an index built for
exactly this question. Only scan the filesystem when the registry has no match.

## Inputs

- `${CLAUDE_PLUGIN_ROOT}/definitions/registry.index.md` — every harness skill and composite
  with triggers and tier, plus Reuse (marketplace capabilities by intent) and Never-routable
  (names that must never be suggested). `registry.json` holds the purpose text if needed.

## Steps

1. Match the task against the index's triggers, composites, and Reuse lines. Almost every
   ask resolves here.
2. Registry hit → return it. Done. Do not scan the filesystem to "confirm".
3. No hit → the ask is outside the harness. Scan installed skills for a match:
   ```bash
   find "$HOME/.claude/plugins/cache" "$HOME/.claude/skills" -name SKILL.md 2>/dev/null
   ```
   Read only the frontmatter `name` + `description` of candidates whose path or filename
   already looks relevant. For a plugin with several versioned SHA dirs, take the newest:
   `ls -dt "$HOME/.claude/plugins/cache/<market>/<plugin>"/*/ | head -1`.
4. Still nothing → say so in one line and offer `/find-skills` (ecosystem discovery).

## Output

One to three matches, one line each — no headers, no ranking table:

```
<invocation> — <what it does>   (why: <what matched>)
```

Use the full namespaced invocation where one applies: `dev-ai-harness:harness-pm`,
`sosafe-pr-workflow:sosafe-exp-squad-pr`.

## Gates

Read-only. Never return a skill whose entry you didn't actually read, and never suggest a
`registry.not_routable` name.
