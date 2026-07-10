---
name: find-skill
description: Given a task or intent, finds the most relevant locally installed skill(s) — spanning harness, SoSafe marketplace, and global skills. Use when asked "which skill should I use for X?", "is there a skill for X?", "what command handles X?", or when the right skill is unclear.
---

# Find Skill

Search all locally installed skills and return the best match(es) for the described task.

## Steps

1. **Discover all installed SKILL.md files** by running:
   ```bash
   find \
     "$HOME/.claude/plugins/cache/sosafe-harness" \
     "$HOME/.claude/plugins/cache/sosafe-claude-market" \
     "$HOME/.claude/skills" \
     -name "SKILL.md" 2>/dev/null | sort
   ```
   For versioned sosafe plugins (multiple SHA dirs), only read the most recently modified dir per plugin:
   ```bash
   ls -dt "$HOME/.claude/plugins/cache/sosafe-claude-market/<plugin>"/*/ | head -1
   ```

2. **For each SKILL.md**, extract:
   - `name` and `description` from frontmatter
   - First 30 lines of body (trigger phrases, when-to-use, what it covers)

3. **Rank against the user's task** — match on keywords, intent, domain, and explicit trigger phrases in the skill body.

4. **Return the top 1–3 matches** in this format:
   ```
   /<skill-name>  — <one-sentence description>
   Why: <what specifically matched the request>
   ```
   If a match is from a plugin namespace, show the full invocation: `dev-ai-harness:harness-pm` or `sosafe-pr-workflow:sosafe-exp-squad-pr`.

5. If nothing matches, say so and offer to help directly or suggest `/find-skills` (the external skills marketplace search).

## Matching guidance

- Harness-workflow tasks (standup, meeting, sprint, monitoring, check-in, career growth) → prefer `dev-ai-harness:harness-*`
- SoSafe engineering tasks (PRs, Jira planning, security review, architecture, unit tests) → prefer `sosafe-*` marketplace skills
- Ambiguous asks → show one from each relevant category and let the user pick
- Never guess or fabricate a skill name — only return skills whose SKILL.md you actually read
