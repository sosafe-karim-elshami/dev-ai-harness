# Team Knowledge

Version-controlled, **shareable** team memory — the harness's long-term brain. Inspired by Hermes Agent's "distill reusable knowledge docs" pattern, but kept as plain Markdown so it's reviewable in PRs and grep-able by every workflow.

Unlike the per-user profile (which lives at `~/.claude/sosafe-harness/profile.json` and is never committed), **everything in this folder is committed and shared with the team.**

## What goes here

One Markdown file per durable piece of knowledge:

- **Support FAQs** — recurring questions + the vetted answer (so `harness-support-triage` can answer instantly next time).
- **Runbooks** — "how do we do X" for the systems the team maintains.
- **Decisions & gotchas** — non-obvious context that isn't captured in any single repo's docs.

## Format

```markdown
---
title: <short title>
tags: [support, <repo-or-area>]
sources: [<jira-key>, <confluence-url>, <slack-permalink>]
updated: 2026-06-23
---

## Question / Situation
<the recurring question or scenario>

## Answer
<the vetted answer, with links to code/docs>
```

## How it grows

`harness-support-triage` checks this folder **first** when drafting an answer, and — after you confirm a reply — offers to distill it into a new or updated entry here. You can also add entries directly: drop in a Markdown file following the format above. Keep entries short and link out rather than duplicating docs.
