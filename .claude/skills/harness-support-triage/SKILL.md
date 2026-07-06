---
name: harness-support-triage
description: >
  Finds un-answered support requests across the user's Slack support channels
  and Jira support queue, then drafts grounded replies — checking team knowledge,
  the cloned codebase, and Confluence first. Trigger on "any support waiting?",
  "unanswered questions?", "triage support", "anyone need a reply in #support…",
  "/triage", or when /standup runs the support scan. Produces DRAFTS only;
  posting a reply or commenting on Jira always requires explicit confirmation.
  After a confirmed answer, offers to save it to knowledge/ for next time.
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(jq:*)
  mcp__claude_ai_Slack__slack_search_public_and_private
  mcp__claude_ai_Slack__slack_read_channel
  mcp__claude_ai_Slack__slack_read_thread
  mcp__claude_ai_Slack__slack_read_user_profile
  mcp__claude_ai_Slack__slack_send_message_draft
  mcp__claude_ai_Slack__slack_send_message
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__addCommentToJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  mcp__claude_ai_Atlassian__getConfluencePage
effort: high
---

# Harness Support Triage

Surface support that's slipping through the cracks and make it one keystroke to answer well.

## Setup
Read `~/.claude/sosafe-harness/profile.json` (missing → `/setup`). Use `slack.support_channels`, `jira.project_keys`, `team.confluence_space_keys`, `repos`, and `person.slack_user_id`. Emphasis per `role-playbooks.json` (`support_emphasis`).

## 1. Find unanswered items

**Slack** — for each support channel, `slack_read_channel` over the recent window. Apply the rubric in `triage-rubric.md`. In short, flag a thread/message when:
- it contains a question or help request, **and**
- it has no reply from a team member (not the asker) within the unanswered window (default 4h, see `discovery-queries.json` → `slack.unanswered_window_hours`), **and**
- it isn't marked resolved (no ✅/resolving reaction, no "thanks/solved").

**Jira** — `jira.open_support_jql` (support-labelled, not done, unassigned/uncommented). Also flag tickets with no team comment in > 1 business day.

Rank by age + signal (customer-facing > internal). Present the queue compactly: source, who's waiting, age, one-line summary, link.

## 2. Draft grounded replies (drafts only)

For each item the user wants to answer, **ground the answer before writing it**, in this order:
1. **`knowledge/`** — Grep the repo's `knowledge/*.md` for a matching FAQ/runbook. If found, base the reply on it and cite it.
2. **Codebase** — Grep/Read the relevant repo under `workspace/` (from `profile.repos`) for the authoritative behavior.
3. **Confluence** — `searchConfluenceUsingCql` with `confluence.ground_answer_cql` scoped to the team spaces.

Write a concise draft that **answers + cites sources** (code path, `knowledge/` entry, Confluence/Jira link). If you can't ground it, say what's missing and ask the user rather than guessing.

Use `slack_send_message_draft` to stage Slack replies and show them inline. **Do not post.**

## 3. Send (gated)

When the user approves specific drafts:
- Batch them; show each target (channel/thread or Jira key) + the text; ask **once** to send.
- Post via `slack_send_message` (in-thread) / `addCommentToJiraIssue`. The guard hook also prompts — expected.

## 4. Grow the knowledge base

After a reply is confirmed and sent, if the question is likely to recur, offer:
> "Save this as a `knowledge/` entry so we can answer instantly next time?"
If yes, write `knowledge/<slug>.md` using the format in `knowledge/README.md` (you may use the `skill-builder` skill), with `sources` pointing at the thread/ticket. This is a local repo write (commit it in a normal PR) — not an outward action.
