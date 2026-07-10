# dev-ai-harness

![Status: Experiment](https://img.shields.io/badge/status-experiment-orange) ![Author: karim.elshami](https://img.shields.io/badge/author-karim.elshami-blue) ![Team trial](https://img.shields.io/badge/trial-Learning%20Technology-purple)

> **Experiment — July 2026.** Authored by [@karim.elshami](mailto:karim.elshami@sosafe.de) and being trialled by the Learning Technology team. Not production-hardened — expect rough edges. Feedback welcome: open an issue or ping `#dev-ai` in Slack.

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

## Intellectual foundations

This harness is deliberately built on two complementary frameworks. Both articles are worth reading before contributing.

---

### Martin Fowler — [*Harness Engineering for Coding Agents*](https://martinfowler.com/articles/harness-engineering.html)

Fowler's framing: a harness is **everything surrounding the model** — the outer layer of controls that steer agent behaviour before problems reach human review. Two control mechanisms, applied at every skill boundary:

| Mechanism | What it means | How it appears here |
|---|---|---|
| **Guides (feedforward)** | Anticipatory controls that shape the agent *before* it acts | `CLAUDE.md` routing brain, `role-playbooks.json`, skill frontmatter triggers, profile-grounded context injected at session start |
| **Sensors (feedback)** | Observational controls that enable self-correction *after* acting | `PostToolUse` hook → `runs.jsonl`, `harness eval` scorecard, `harness metrics`, `harness-self-improve` reflection |

Fowler proposes three regulation dimensions. The harness targets all three:

| Dimension | Definition | Implementation |
|---|---|---|
| **Maintainability** | Internal code quality controls | `harness-self-improve` proposes skill edits; `harness eval` scores them before they're accepted |
| **Architecture fitness** | Structural constraints measured as fitness functions | Compass hygiene (ownership, security score, CD adoption) surfaced in every `/monitoring` run — these are H2 OKR inputs |
| **Behaviour** | Functional correctness | `definitions/eval/golden-tasks.jsonl` — recorded golden asks that `harness eval` replays to verify routing and grounding haven't drifted |

Two Fowler principles shape the safety model directly:

- **Ambient Affordances** — the environment should be legible to the agent without it having to re-derive context. The profile (`~/.claude/sosafe-harness/profile.json`) is the distilled, structured answer to "who is running this?"; `knowledge/` and the vault do the same for team knowledge. Neither is ever inferred on the fly.
- **Keep Quality Left** — checks run as early and cheaply as possible. The `PreToolUse` hook intercepts outward actions before they reach Slack, Jira, or GitHub; computational checks (hooks, linters) fire before inferential ones (Claude skill reasoning).

---

### Lilian Weng — [*Harness Engineering for Self-Improvement*](https://lilianweng.github.io/posts/2026-07-04-harness/) (2026)

Weng defines a harness as "the system surrounding a base model that orchestrates execution." Four properties distinguish a harness from a bare agent:

| Property | Implementation here |
|---|---|
| **Workflow design** | Per-role skill ordering (`role-playbooks.json`); goal-oriented plan → read → draft → confirm loops inside each skill |
| **Evaluation mechanisms** | `harness eval` replays golden tasks and scores routing correctness, read-only compliance, citation grounding |
| **Permission controls** | Two independent layers: in-skill confirmation batching + `PreToolUse` hook (the hook fires even if a skill's prose is bypassed) |
| **Persistent state management** | Profile, `knowledge/`, vault, `runs.jsonl` — all survive context resets and cross-session boundaries |

Weng's **optimization chain** describes how harnesses evolve as models get more capable. This repo maps to it directly:

```
profile + CLAUDE.md        →  structured context (what the agent knows about the user)
role-playbooks.json        →  workflow (how to order and route work by role)
skills + hooks             →  harness code (the executable policies)
harness-self-improve       →  optimizer (proposes edits to harness code itself, scored before applied)
```

**Seven bottlenecks** — and how each is addressed:

| Bottleneck | Response |
|---|---|
| Weak/fuzzy **evaluators** | `harness eval` replays `definitions/eval/golden-tasks.jsonl` and scores routing, read-only compliance, citations, and grounding — the signal `harness-self-improve` optimizes against |
| **Context / memory lifecycle** | `harness memory audit` flags stale, duplicate, and contradictory memory across the CLI store, vault, and `knowledge/` |
| **Negative results** | `knowledge/anti-patterns/` records what didn't work; triage and self-improve check it before answering |
| **Diversity collapse** | `harness-self-improve` verifies each applied change actually moved the scorecard; reverts and records those that didn't |
| **Reward hacking** | Self-improve requires a measured scorecard improvement before accepting any proposal — no credit for gaming the metric |
| **Long-term / observability** | `PostToolUse` hook logs every skill run to `runs.jsonl`; `harness metrics` reports coverage, usage, success rate, staleness, and orphan-log drift |
| **The human role** | Every outward action is gated by the two-layer confirm; autonomous scheduled runs deny mutations outright — the human stays in the loop at the right abstraction level |

The measured signal → mine weaknesses → propose → apply → re-measure cycle is the local, human-gated version of Weng's recursive self-improvement loop — without removing the human from the critical path.

---

### Tiago Forte — *Building a Second Brain* (2022) + Zettelkasten

The vault layer of this harness is built on Forte's second brain methodology and Luhmann's Zettelkasten linking philosophy. Both address the same problem: most engineering tooling is designed for *doing* (Jira, GitHub), not for *thinking*. The vault holds your thinking so your biological brain doesn't have to.

**The CODE workflow** — how knowledge moves through the system:

| Step | What it means | How the harness implements it |
|---|---|---|
| **Capture** | Collect anything useful, immediately, frictionlessly | `/notes capture <text>` from any session or repo; skills write to the vault automatically (meetings, digests, monitoring) |
| **Organise** | File by *actionability*, not by topic | PARA-mapped vault folders (see below); `type:` frontmatter for auto-filing |
| **Distil** | Compress to the core insight | `harness-support-triage` distils answers into `knowledge/` before closing; `/checkin` surfaces what's stale; digests summarise rather than dump |
| **Express** | Turn stored knowledge into visible output | `/growth` surfaces the visibility gap daily — notes that haven't become a Confluence page, talk, or team share yet |

**PARA → vault folder mapping:**

| PARA bucket | Definition | Vault folder |
|---|---|---|
| Projects | Active, deadline-bound | `meetings/` (date-stamped) + `digests/` (daily drivers) |
| Areas | Ongoing responsibility | `growth/` (career), `monitoring/` (production health) |
| Resources | Permanent reference | `knowledge/` (decisions, architecture, how-tos) |
| Archive | Inactive items | Digests older than 2 weeks (auto-dated) |

**Zettelkasten principles applied:** every note is atomic (one idea), links prolifically via `[[wikilinks]]`, and structure emerges from the link graph rather than from folder hierarchy. The Obsidian graph view makes your mental model visible over time.

**What makes the vault *active* rather than passive:**

| Static Obsidian setup | Harness vault |
|---|---|
| You write notes manually | Skills write automatically (meetings, digests, monitoring) |
| You search by keyword | Claude retrieves by intent across sessions |
| Notes accumulate silently | `/checkin` surfaces what's stale each evening |
| You remember to link | Skills link notes to Jira, PRs, calendar events on creation |
| You decide what to publish | `/growth` flags notes with no public artifact yet |

**Two-brain model** — personal and project layers stay deliberately separate:

```
Personal brain (harness vault / Obsidian)     Project brain (committed knowledge/)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per-dev, private, never committed             Shared, committed, team-owned
Cross-project, cross-context                  One repo scope
Thinking layer: process before publishing     Publishing layer: team decisions & artifacts
Feeds: career evidence, IDP, talk notes       Feeds: ADRs, runbooks, support FAQs
Written by: Claude skills + /notes            Written by: team commits + Claude sessions
```

Knowledge is designed to flow from private → shared → published: vault note → `knowledge/` entry → Confluence / Jira. The chain is intentional and traceable.

---

### What the harness fully implements vs. what's partial

Being honest about where the science is fully realised and where it isn't:

| Claim | Status | Notes |
|---|---|---|
| Guides + Sensors (Fowler) | ✅ Full | `CLAUDE.md` + role-playbooks as guides; PostToolUse hook + `runs.jsonl` as sensors |
| Maintainability regulation (Fowler) | ✅ Full | `harness-self-improve` proposes; `harness eval` scores before accepting |
| Architecture fitness (Fowler) | ✅ Full | Compass hygiene in every `/monitoring` run |
| Behaviour regulation (Fowler) | ⚠️ Partial | `golden-tasks.jsonl` tests routing only — functional correctness tests not yet written. Fowler calls this the hardest and least-mature dimension. |
| Ambient Affordances (Fowler) | ✅ Full | Profile + vault + `knowledge/` eliminate re-derivation at session start |
| Keep Quality Left (Fowler) | ✅ Full | `PreToolUse` hook fires before any outward action reaches the network |
| Four harness properties (Weng) | ✅ Full | Workflow, evaluation, permissions, persistent state all present |
| Seven bottlenecks (Weng) | ✅ Full | All seven are addressed — see table above |
| CODE workflow (Forte) | ⚠️ Partial | Capture/Organise/Distil are automated; Express is surfaced as a gap by `/growth` but the actual output (Confluence page, talk) is always manual — outward actions are gated by design |
| PARA structure (Forte) | ✅ Full | All four buckets are mapped to vault folders |
| Zettelkasten linking (Luhmann) | ✅ Full | `[[wikilinks]]` + backlinks; structure emerges from link graph |
| Two-brain separation | ✅ Full | Hard boundary: personal vault never committed; `knowledge/` always shared |

## Contributing

- Team knowledge → add/curate Markdown in `knowledge/` (shared, committed). Personal notes → use `/notes` (private vault, not committed).
- New workflow → add a skill under `.claude/skills/<name>/SKILL.md` (kebab-case folder == frontmatter `name`) and, if it needs an entry point, a thin router in `.claude/commands/`.
- Reuse marketplace plugins by intent rather than reimplementing them.
