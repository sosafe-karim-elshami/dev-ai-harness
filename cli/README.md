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

## Commands

| Command | What it does |
|---|---|
| `harness` | Branded interactive prompt (`:use <ctx>` to switch, `:quit` to exit). |
| `harness run "<msg>"` | One-off ask in the default context. |
| `harness <context> "<msg>"` | Ask within a named, persistent context. |
| `harness standup \| triage \| meeting` | Run a harness slash command — each its own resumable context. |
| `harness monitoring [--digest]` | Read-only production health: Sentry / Datadog / Amplitude (whatever's configured). |
| `harness followup ["<meeting>"]` | Ingest a meeting's Gemini transcript and draft action items (meetings follow-up flow). |
| `harness dashboard [--digest]` | Role-ordered dev dashboard: PRs, Jira, meetings + open follow-ups, support. Read-only. |
| `harness self-improve [--digest]` | Read-only reflection that proposes harness improvements as drafts. |
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
