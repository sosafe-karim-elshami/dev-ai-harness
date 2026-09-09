---
name: harness-support-triage
description: >
  Finds un-answered support requests across the user's Slack support channels and Jira
  support queue, then drafts grounded replies — checking team knowledge, the cloned
  codebase, and Confluence first. Trigger on "any support waiting?", "unanswered
  questions?", "triage support", "anyone need a reply in #support…", "/triage", or when
  /standup runs the support scan. Produces DRAFTS only; posting a reply or commenting on
  Jira always requires explicit confirmation. After a confirmed answer, offers to save it
  to knowledge/ for next time.
model: opus
effort: high
allowed-tools: >-
  Read
  Write
  Glob
  Grep
  Task
  Bash(jq:*)
  mcp__claude_ai_Slack__slack_send_message_draft
  mcp__claude_ai_Slack__slack_send_message
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getConfluencePage
---

# Harness Support Triage

Surface support that's slipping, then make it one keystroke to answer *well*. An ungrounded
reply is worse than no reply — grounding is the whole job.

## Inputs

`~/.claude/sosafe-harness/profile.json` (missing → `/setup`): `slack.support_channels`,
`jira.project_keys`, `team.confluence_space_keys`, `repos`, `person.slack_user_id`.
Emphasis per `role-playbooks.json` → `support_emphasis`. Rubric: `triage-rubric.md`.

## Steps

1. **Scatter the scan.** Spawn `support-scan` (Task tool) — it applies the unanswered rubric
   across Slack and Jira and returns the ranked queue as JSON. Never scan inline.
2. Present the queue compactly: source, who's waiting, age, one-line question, link.
3. For each item the user picks, **ground before writing**, in the order in
   `triage-rubric.md` → "Grounding chain": `knowledge/anti-patterns/` → `knowledge/` →
   the repo under `workspace/` → Confluence. Stop at the first authoritative source.
4. Draft a reply that answers *and* cites (code path, knowledge entry, Confluence/Jira link).
   Can't ground it → say what's missing and ask the user. Never guess.
5. Stage Slack replies with `slack_send_message_draft` and show them inline. Do not post.

## Output

One line per queued item. For each draft: the target, the reply text, and its citations —
nothing else. No preamble about what you're about to do.

## Gates

- **Sending:** batch the approved drafts, show each target + text, ask once, then post via
  `slack_send_message` (in-thread) / `addCommentToJiraIssue`. The guard hook also prompts.
- **After a confirmed send,** if the question will recur, offer to write `knowledge/<slug>.md`
  per `knowledge/README.md` with `sources` pointing at the thread/ticket.
- **If a sent answer turns out wrong,** offer to record it in `knowledge/anti-patterns/<slug>.md`
  per that folder's README — what was tried, why it failed, what to do instead. A recorded
  loss is what stops the harness repeating it.
