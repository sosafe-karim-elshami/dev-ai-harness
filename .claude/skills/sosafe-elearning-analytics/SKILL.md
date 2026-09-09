---
name: sosafe-elearning-analytics
description: >
  Process skill for instrumenting Amplitude analytics in fe-lib-course-builder module
  templates. Verifies the repo's actual Amplitude init and the canonical reference hook
  before generating a hook, defining event properties, or writing a Jira ticket. Trigger on
  "add analytics to <module>", "instrument <module> events", "write analytics hook for
  <module>", "analytics ticket for LTC-XXXX", or any request to add Amplitude tracking to a
  lesson template.
model: sonnet
effort: medium
argument-hint: <module name or Jira ticket — e.g. "phishing" or "LTC-1481">
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(find:*)
  Bash(grep:*)
  Bash(git:*)
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
---

# E-Learning Amplitude Analytics

Always start from the **code**, never from memory and never from Confluence alone. Confluence
describes the org-wide standard; `fe-lib-course-builder` is a deliberate exception to it.
Getting that backwards produces confidently wrong tickets.

## Inputs

**`reference.md`** — the identity model, the reference hook, the Confluence page, and the
property taxonomy. **`templates.md`** — the hook shape, the Jira section structure, and the
staging gate. Read `reference.md` before writing anything.

## Steps

1. **Verify the actual init** in `analytics.context.tsx` and `use-url-params.tsx`
   (`reference.md` §1). Never assume the `fe-lib-product-analytics` wrapper's auto-attached
   defaults apply here — they don't, and that's the single most common wrong answer.
2. **Read the canonical hook** `use-vishing-analytics.ts` (`reference.md` §2). Confirm no hook
   already exists for the target module.
3. **Fetch the Confluence guidance** as context, not gospel (`reference.md` §3).
4. **Define the taxonomy** across the three layers — identity, `commonProps`, event-specific
   (`reference.md` §4). Never duplicate identity as an event property.
5. **Generate** the hook or the ticket from `templates.md`.
6. **State the staging gate** in every ticket: unit tests cannot catch missing identity
   (`templates.md` → Staging verification).

## Output

For a hook: the code, plus which reference patterns it mirrors. For a ticket: the filled
sections. Either way, lead with what you verified in the code and cite `path:line` — the
verification is the deliverable, not a preamble to it.

## Gates

Read-only by default. Check the "Known-wrong answers" list in `reference.md` before answering
— a match there is a recorded dead end. Editing a Jira ticket is an outward action: batch it,
confirm once, and let the guard hook gate it.
