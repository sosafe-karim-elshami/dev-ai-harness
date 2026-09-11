# `harness` — a thin CLI wrapper over Claude Code

Runs the dev-ai-harness's own skills/commands non-interactively, with a
**persistent session per context**, **injected memory**, a **context graph** of
your working world, and a **sync** command — installable on `PATH` and runnable
from any directory.

It is a *wrapper*, not a runtime: every command shells out to
`claude -p "<prompt>"` **from inside the harness repo**, so `CLAUDE.md` routing,
the `.claude/` skills, marketplace plugins, and the `PreToolUse` guard hook all
apply unchanged. The wrapper only manages which session to resume, what memory
to inject, and how to render output.

> Optional. The harness works entirely through Claude Code's slash commands
> without this. Install it only if you want to run workflows from your terminal,
> on a schedule, or across sessions with persistent memory.

## Prerequisites

- **Node.js 18+** and npm.
- The **`claude`** CLI on your PATH (the wrapper shells out to it).
- A working harness (run `/setup` once in the repo first).

## Install

```bash
cd cli
npm install
npm run build
npm link            # puts `harness` on your PATH
harness init /path/to/dev-ai-harness   # record the repo location (once)
```

`harness init` writes the repo path to `~/.claude/sosafe-harness/config.json`,
so the tool never depends on your current directory.

**Verify:** `harness sessions` should run without error (an empty list is fine),
and `harness run "say hi"` should return a reply.

## Commands

| Command | What it does |
|---|---|
| `harness` | Branded interactive prompt (`:use <ctx>` to switch, `:quit` to exit). |
| `harness run "<msg>"` | One-off ask in the default context. |
| `harness <context> "<msg>"` | Ask within a named, persistent context. |
| `harness standup \| triage \| meeting \| groom` | Run a harness slash command — each its own resumable context. |
| `harness groom ["<scope>"]` | Backlog grooming pass: sweep (harness-pm hygiene) → quality-check → size → split, ordered by the urgency matrix. Reuses `sosafe-ticket-loop` + `sosafe-planning`. Read-only; Jira writes are batched + confirmed. Scope by board/epic/sprint/ticket. |
| `harness monitoring [--digest]` | Read-only production health: Sentry / Datadog / Amplitude (whatever's configured). |
| `harness followup ["<meeting>"]` | Ingest a meeting's Gemini transcript and draft action items (meetings follow-up flow). |
| `harness dashboard [--digest] [--cached]` | Role-ordered dev dashboard: PRs, Jira, meetings + open follow-ups, support. Read-only. Items are classified + ordered by `definitions/urgency-matrix.json`. Each fresh run caches a structured JSON snapshot; `--cached` re-renders that snapshot instantly without calling the model (fast + resilient to model drift). |
| `harness self-improve [--digest]` | Read-only reflection that proposes harness improvements as drafts. |
| `harness eval [id] [--no-save]` | Runs `registry check` first (fails fast on routing drift, before spending tokens), then replays the golden tasks in `definitions/eval/golden-tasks.jsonl` headless and scores routing / read-only / citations / grounding. Writes a scorecard to `digests/`; exit code is non-zero if any task fails. Optional `id` runs a subset. |
| `harness registry check\|sync\|show` | The routing single source of truth (`definitions/registry.json`). `check` fails on drift — a skill on disk with no entry, an entry with no skill, frontmatter contradicting the declared tier, or a SKILL.md body over the 60-line contract cap. `sync` regenerates CLAUDE.md's routing table. `show` prints the model-tier allocation. |
| `harness doctor [--json]` | Probes which capabilities this environment can actually reach, separating **headless** paths (CLI-backed, work in cron) from **session-only** ones (claude.ai connectors). Chains and degrade messages live in `definitions/mcp-fallbacks.json`. |
| `harness archive [--apply] [--days=N]` | Retention for the harness's own output, per `definitions/retention.json`. Moves date-stamped vault notes past their cutoff into a flat `<folder>/archive/`, prunes their links from `index.md`, and regenerates an archive index so nothing is orphaned. **Dry run unless `--apply`; never deletes.** Undated, pinned (`pinned: true`), and today's notes are exempt; `knowledge/` and `memory/` are keep-forever. |
| `harness graph build --system` | Derives the system map from GitHub — CODEOWNERS, commit authorship, and manifest dependencies between your own repos — into `system.json`. Answers "what do I actually own, and what depends on it" without asking you. Read-only `gh api` GETs; refreshed on every `harness sync`. |
| `harness memory audit [--deep] [--stale=N]` | Read-only lifecycle scan of CLI memory + vault + `knowledge/`: flags stale (default > 120d) and near-duplicate entries; `--deep` adds an LLM contradiction pass. Never deletes. |
| `harness metrics [--json] [--window-days N]` | Observability: skill usage, instrumentation coverage, success rate, staleness, and drift from `runs.jsonl`, plus **runs by declared tier** so model allocation can be checked against intent rather than assumed. Read-only. |
| `harness sessions` | List saved contexts + session ids. |
| `harness reset <context>` | Forget a context's session (next run starts fresh). |
| `harness memory [show\|add\|edit] <ctx>` | View/append durable, injected memory. |
| `harness sync` | `git pull` the harness repo, **rebuild the CLI**, + `claude plugin marketplace update`. |
| `harness install-cron [--apply]` | Schedule weekday digest runs + weekly self-improve (no daemon). |
| `harness graph build [--infer]` | Build the context graph from your profile + wikilinks (+ LLM-inferred links). |
| `harness graph query\|neighbors\|path\|explain` | Query the graph. |
| `harness mcp` | Run the context-graph MCP server (stdio). |

## Memory & persistence

- **Session continuity** — each context owns a stable Claude session UUID
  (`sessions.json`); first run uses `--session-id`, later runs `--resume`. Your
  conversation and its memory continue across separate invocations.
- **Injected memory** — `~/.claude/sosafe-harness/memory/global.md` and
  `memory/<context>.md` are appended to the system prompt on every run, so
  durable facts survive even a session reset.
- **Lifecycle** — memory that only grows becomes noise. `harness memory audit`
  is a read-only scan that flags stale and near-duplicate entries (and, with
  `--deep`, likely contradictions) across the CLI store, the Obsidian vault, and
  the repo's `knowledge/`, so you can prune deliberately. It never deletes.

## Evaluation

`harness eval` is the harness's honest signal. It replays the recorded golden
tasks in `definitions/eval/golden-tasks.jsonl` through the same CLAUDE.md routing
and guard hook as any run (headless, `HARNESS_AUTONOMOUS=1`, so every mutation is
denied) and scores four things the harness promises:

- **routing** — did the ask reach the skill it should have?
- **read-only** — did the run avoid *attempting* any outward/mutating tool?
- **citations** — did the answer ground itself in a source?
- **grounding** — do the repo paths the answer cites actually exist on disk?

It writes a scorecard to `digests/eval-*.md`, and `harness self-improve` reads
the newest one as the thing it optimizes against — closing the
measure → improve → re-measure loop. Run it in a configured harness (profile +
connectors present); tasks that need data you haven't connected will show up as
routing/citation failures, which is the point.

## Observability

`harness eval` scores *quality*; `harness metrics` tracks *usage and drift* — the
two together are what `harness self-improve` mines. A `PostToolUse(Skill)` hook
(`.claude/hooks/log-skill-run.sh`) appends one line per skill invocation to
`~/.claude/sosafe-harness/runs.jsonl` (private, per-user — never in the repo).
`harness metrics` aggregates it into:

- **coverage** — distinct skills invoked / skills on disk,
- **usage** — runs per skill, all-time and windowed,
- **success rate** — from the tool response,
- **staleness** — never-invoked skills and last-seen age,
- **drift** — *orphan logs*: a skill logged but no longer on disk (a rename that
  broke a reference).

Ported from the CMS Platform vault's observability layer. Honest scope: hooks
can't see token/cost from inside a session, so this tracks invocation, success,
and staleness — not cost.

## Context graph (semantic links)

`harness graph build` maps **you** — not a codebase — as a typed property graph
in a git-friendly `graph.json`: `Person MAINTAINS Repo`, `Person MEMBER_OF Team`,
`Team HAS_PROJECT JiraProject`, plus `[[wikilink]]` edges from `knowledge/` and
`memory/`. `--infer` adds LLM-inferred, confidence-tagged edges (`DEPENDS_ON`,
`RELATES_TO`, `BLOCKS`, …) — `EXTRACTED` vs `INFERRED`, à la graphify.

Expose it to Claude Code so skills can traverse it:

```bash
claude mcp add harness-graph -- harness mcp
```

Tools: `query_graph`, `get_neighbors`, `shortest_path`.

## Safety

Non-interactive runs set `HARNESS_AUTONOMOUS=1`; the harness guard hook then
**denies** (rather than asks) any outward/mutating action (Slack send, Jira
transition, `git push`, PR create/merge, …). Autonomous runs are strictly
read-only / draft-only — real sends happen in an interactive Claude Code session.
