# dev-ai-harness

A **role-aware team harness** for Claude Code — clone it, run `/setup`, and get safe, daily agentic workflows over Jira, GitHub, Slack, Calendar, Gmail, Confluence, and Compass, grounded in a profile the harness discovers about *you*.

It is **not** a separate runtime. It runs inside Claude Code and *consumes* the [`sosafe-claude-market`](https://github.com/sosafe-platform-engineering/dev-ai-claude-marketplace) marketplace for the heavy lifting (metrics, PR workflow, planning, reviews). The marketplace is the **library**; this repo is the curated **product** that assembles it into daily workflows.

> Design lineage: borrows patterns from the open-source [Hermes Agent](https://github.com/nousresearch/hermes-agent) (per-user home dir, distilled reusable knowledge, scoped tool exposure) and [NanoClaw](https://github.com/nanocoai/nanoclaw) ("skills over features" — you customize by talking to Claude Code, safe-by-default isolation) — without cloning either runtime.

## Quick start

```bash
git clone <this-repo> dev-ai-harness
cd dev-ai-harness
claude          # start Claude Code in this folder, then:
```
```
/setup
```

`/setup` will:
1. Add the `sosafe-claude-market` marketplace and enable the plugins the harness reuses.
2. **Discover who you are** — queries GitHub, Jira, Confluence, and Slack by your name/role (read-only), asks you only to confirm or fill gaps, and writes a profile to `~/.claude/sosafe-harness/profile.json`.
3. Offer to clone the repos you maintain into `workspace/` (so answers are grounded in real code).

Run `/setup --field repos` (or any section) to re-discover just that part later.

## Daily use

| Command | What it does |
|---|---|
| `/standup` | Read-only daily driver: PM summary + support scan + today's meetings, ordered for your role. |
| `/triage` | Find unanswered support across Slack + Jira; draft grounded replies (you confirm before any send). |
| `/monitoring` | Read-only production health from Sentry / Datadog / Amplitude — whatever's configured (skips the rest). |
| `/meeting` | Prep an agenda from Calendar + Jira/PRs; **ingest the Gemini notes doc** of a finished meeting; capture notes; push action items (gated) to Jira/Slack. |
| `/self-improve` | Read-only reflection: propose improvements to skills/routing/knowledge as drafts (never auto-applied). |
| `/harness` | "What should I look at?" — routes by your role. |

From the CLI (`cli/`): `harness dashboard` renders a role-ordered dev dashboard (PRs/Jira/meetings/support), `harness followup` runs the meeting transcript → action-items flow, and `harness sync` self-updates and rebuilds the CLI.

Plain asks work too: "how's the team's sprint looking?", "anyone in #support-x waiting on a reply?", "prep my 2pm", "ingest my last meeting's Gemini notes and draft follow-ups".

## Safety model

Read-mostly by default. **Every outward or destructive action is gated** — Slack posts, Jira transitions/creates/comments, Confluence edits, email sends, `git push`, `gh pr create|merge`. Two layers:

1. Each skill batches mutations and asks once, naming every target.
2. A `PreToolUse` hook (`.claude/hooks/confirm-outward-actions.sh`) intercepts those tools and forces a confirmation prompt — independent of any skill's prose. Read-only and `*_draft` tools are never gated, so day-to-day use has no friction.

Set `preferences.confirm_outward_actions: false` in your profile to relax the in-skill prompts; the hook still fires.

## What's in here

```
.claude/
  settings.json          # enables marketplace plugins; read-mostly permissions; registers the guard hook
  hooks/                 # confirm-outward-actions.sh — the safety gate
  skills/                # harness-onboarding, harness-workspace, harness-pm, harness-support-triage, harness-meetings
  commands/              # setup, harness, standup, triage, meeting
definitions/             # profile.schema.json, role-playbooks.json, discovery-queries.json
knowledge/               # committed, shareable team memory (support FAQs, runbooks) — grows over time
workspace/               # gitignored; your maintained repos, cloned by harness-workspace
CLAUDE.md                # the routing brain, loaded every session
```

## Optional: scheduled runs

You can have `/standup` and a support sweep run on a schedule (e.g. each weekday morning) via Claude Code's scheduling, producing a read-only digest of drafts. It never auto-sends. See `.claude/commands/standup.md` for the opt-in recipe. Off by default.

## Contributing

- Team knowledge → add/curate Markdown in `knowledge/`.
- New workflow → add a skill under `.claude/skills/<name>/SKILL.md` (kebab-case folder == frontmatter `name`) and, if it needs an entry point, a thin router in `.claude/commands/`.
- Reuse marketplace plugins by intent rather than reimplementing them.
