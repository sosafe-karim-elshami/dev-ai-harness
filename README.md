# dev-ai-harness

![Status: Experiment](https://img.shields.io/badge/status-experiment-orange) ![Author: karim.elshami](https://img.shields.io/badge/author-karim.elshami-blue) ![Team trial](https://img.shields.io/badge/trial-Experience%20Squads-purple)

> **Experiment — July 2026.** Authored by [@karim.elshami](mailto:karim.elshami@sosafe.de) and being trialled by the Experience Squads team. Not production-hardened — expect rough edges. Feedback welcome: open an issue or ping `#dev-ai` in Slack.

---

A **role-aware team harness** for Claude Code — clone it, run `/setup`, and get safe, daily agentic workflows over Jira, GitHub, Slack, Calendar, Gmail, Confluence, and Compass, grounded in a profile the harness discovers about *you*.

It's an **abstraction for running your SDLC and managing your work** — plan → build → review → ship, plus standups, triage, meetings, monitoring, and follow-ups — that adapts to whoever runs it. Nothing personal is committed: the per-user profile (`~/.claude/sosafe-harness/profile.json`) and the private Obsidian knowledge vault live **outside** this repo. What ships here is the reusable machinery — skills, routing, evals, observability, and safety hooks — so any engineer or EM can clone it and make it their own.

It is **not** a separate runtime. It runs inside Claude Code and *consumes* the [`sosafe-claude-market`](https://github.com/sosafe-platform-engineering/dev-ai-claude-marketplace) marketplace for the heavy lifting (metrics, PR workflow, planning, reviews). The marketplace is the **library**; this repo is the curated **product** that assembles it into daily workflows.

> Design lineage: borrows patterns from the open-source [Hermes Agent](https://github.com/nousresearch/hermes-agent) (per-user home dir, distilled reusable knowledge, scoped tool exposure) and [NanoClaw](https://github.com/nanocoai/nanoclaw) ("skills over features" — you customize by talking to Claude Code, safe-by-default isolation) — without cloning either runtime.

## Prerequisites

Before `/setup`, make sure you have:

- **Claude Code** installed and working (`claude` on your PATH).
- **GitHub CLI** authenticated — `gh auth status` should show you logged in (`gh auth login` if not). `/setup` uses it to discover your repos.
- **Connectors** for the tools you use, added in Claude Code via `/mcp`: Atlassian (Jira/Confluence), Slack, and Google Calendar/Drive. Anything missing is skipped gracefully — add it later and re-run `/setup --field <section>`.
- **Obsidian** (optional) if you want to browse your knowledge vault visually; the vault works as plain Markdown either way.
- **Node.js** (optional) only for the `cli/` — see [cli/README.md](cli/README.md).

## Quick start

```bash
git clone <this-repo> dev-ai-harness
cd dev-ai-harness
claude          # start Claude Code in this folder, then run:
```
```
/setup
```

`/setup` walks you through, confirming each value before saving:
1. Adds the `sosafe-claude-market` marketplace and enables the plugins the harness reuses.
2. **Discovers who you are** — queries GitHub, Jira, Confluence, and Slack by your name/role (read-only), asks you only to confirm or fill gaps, and writes a profile to `~/.claude/sosafe-harness/profile.json`.
3. Offers to clone the repos you maintain into `workspace/` (so answers are grounded in real code).
4. Scaffolds your personal **[knowledge vault](#knowledge-vault-obsidian)** and installs the global `/notes` command.

Re-run `/setup --field repos` (or `person`/`team`/`jira`/`slack`) to refresh just one section later.

## Verify your setup

After `/setup`, confirm it worked (all read-only):

```bash
# 1. Profile exists and is the current schema
jq '{name: .person.name, role: .person.role_class, repos: (.repos|length)}' ~/.claude/sosafe-harness/profile.json

# 2. Knowledge vault was scaffolded and its path is recorded
VAULT=$(jq -r '.vaultPath // empty' ~/.claude/sosafe-harness/config.json); echo "vault: $VAULT"; ls "$VAULT"

# 3. The safety hook is present and executable (should print an -rwx… line)
ls -l .claude/hooks/confirm-outward-actions.sh
```

Then, inside Claude Code:
- Run **`/standup`** — you should get a role-ordered digest with links (read-only; changes nothing).
- Run **`/notes capture test note`** then **`/notes search test`** — confirms the vault round-trips.

If step 1 or 2 is empty, re-run `/setup` (or the specific `--field`).

## Daily use

| Command | What it does |
|---|---|
| `/standup` | Read-only daily driver: PM summary + support scan + today's meetings, ordered for your role. |
| `/triage` | Find unanswered support across Slack + Jira; draft grounded replies (you confirm before any send). |
| `/monitoring` | Read-only production health from Sentry / Datadog / Amplitude — whatever's configured (skips the rest). |
| `/meeting` | Prep an agenda from Calendar + Jira/PRs; **ingest the Gemini notes doc** of a finished meeting; capture notes; push action items (gated) to Jira/Slack. |
| `/self-improve` | Read-only reflection: propose improvements to skills/routing/knowledge as drafts (never auto-applied). |
| `/notes` | Capture, search, and organize notes in your Obsidian knowledge vault — works from **any** repo or session. |
| `/harness` | "What should I look at?" — routes by your role. |

From the CLI (`cli/`): `harness dashboard` renders a role-ordered dev dashboard (PRs/Jira/meetings/support), `harness followup` runs the meeting transcript → action-items flow, and `harness sync` self-updates and rebuilds the CLI.

Plain asks work too: "how's the team's sprint looking?", "anyone in #support-x waiting on a reply?", "prep my 2pm", "ingest my last meeting's Gemini notes and draft follow-ups".

## Knowledge vault (Obsidian)

Each dev gets a **personal, cross-session knowledge base** as an Obsidian vault — the *setup* is shared (it ships in this repo), the *content* is private (never committed). `/setup` scaffolds it from `definitions/vault-templates/` and records its path in `~/.claude/sosafe-harness/config.json` → `vaultPath`.

- **`/notes capture <text>`** — save a note (auto-filed into `memory/`, `meetings/`, `digests/`, `monitoring/`, or `knowledge/`).
- **`/notes search <query>`** — find and synthesize across your notes.
- It works from **any** repo or session, because the vault path is global, not tied to the current directory.
- `harness-meetings`, `/standup`, and `harness-monitoring` also write their notes here automatically.

Everything is plain Markdown with `[[wikilinks]]` and `type:` frontmatter, so Obsidian's graph and backlinks work with no plugins. Open the vault folder in Obsidian to browse it.

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
  skills/                # onboarding, workspace, pm, support-triage, meetings, monitoring, self-improve, router
  commands/              # setup, harness, standup, triage, meeting, monitoring, self-improve, notes
definitions/             # profile.schema.json, role-playbooks.json, discovery-queries.json, vault-templates/
knowledge/               # committed, shareable team memory (support FAQs, runbooks) — grows over time
cli/                     # optional `harness` CLI wrapper (persistent sessions, memory, context graph) — see cli/README.md
workspace/               # gitignored; your maintained repos, cloned by harness-workspace
CLAUDE.md                # the routing brain, loaded every session
```

Your **profile** (`~/.claude/sosafe-harness/profile.json`) and **knowledge vault** (Obsidian) live outside the repo and are never committed — only the shared setup is.

## Optional: scheduled runs

You can have `/standup` and a support sweep run on a schedule (e.g. each weekday morning) via Claude Code's scheduling, producing a read-only digest of drafts. It never auto-sends. See `.claude/commands/standup.md` for the opt-in recipe. Off by default.

## Design lineage & further reading

The harness is organized around the four things Lilian Weng's
[*Harness Engineering for Self-Improvement*](https://lilianweng.github.io/posts/2026-07-04-harness/)
(2026) says separate a *harness* from a bare agent — **workflow/loop
engineering, evaluation, permission controls, and persistent state management** —
and it takes her **seven bottlenecks** as a design checklist:

| Bottleneck (Weng) | Where the harness addresses it |
|---|---|
| Weak/fuzzy **evaluators** | `harness eval` replays `definitions/eval/golden-tasks.jsonl` and scores routing / read-only / citations / grounding — the signal `harness-self-improve` optimizes against. |
| Context/**memory lifecycle** | `harness memory audit` flags stale, duplicate, and (with `--deep`) contradictory memory across the CLI store, vault, and `knowledge/`. |
| **Observability / drift** | A `PostToolUse(Skill)` hook logs every skill run to a private `runs.jsonl`; `harness metrics` reports coverage, usage, success rate, staleness, and orphan-log drift. (Ported from the CMS Platform team vault.) |
| **Negative results** | `knowledge/anti-patterns/` records what *didn't* work; triage and self-improve check it first. |
| Reward hacking / diversity collapse | self-improve verifies each applied change actually moved the scorecard, and reverts + records the ones that didn't. |
| The **human role** | every outward action stays gated by the two-layer confirm (in-skill + `PreToolUse` hook); autonomous runs deny mutations outright. |

The measured signal → mine weaknesses → propose → apply → re-measure cycle is the
local, human-gated version of the `prompt → context → workflow → harness code`
optimization chain from the post.

## Contributing

- Team knowledge → add/curate Markdown in `knowledge/` (shared, committed). Personal notes → use `/notes` (private vault, not committed).
- New workflow → add a skill under `.claude/skills/<name>/SKILL.md` (kebab-case folder == frontmatter `name`) and, if it needs an entry point, a thin router in `.claude/commands/`.
- Reuse marketplace plugins by intent rather than reimplementing them.
