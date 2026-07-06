---
title: Reuse-vs-build decisions for the meetings loop, dashboard, and self-improving harness
tags: [decisions, harness, meetings, dashboard, self-improve]
sources: []
updated: 2026-07-03
---

## Situation

Building three capabilities on top of the existing `dev-ai-harness`:
meetings loop (Gemini transcript -> follow-ups), a CLI dev dashboard, and an
auto-build / self-improving / self-documenting loop. The harness principle is
*reuse the marketplace, don't rebuild it* (`CLAUDE.md`). This note records what
we evaluated and what we adopted, so the choices are visible to the team.

## Decisions

### Meeting transcription — REUSE the Gemini Google Doc, build nothing
- Primary path: Google Meet's "Gemini takes notes" writes a Google Doc; the
  harness only reads it (Drive connector) and acts on it. No transcription code.
- Optional local fallback: [Meetily](https://github.com/Zackriya-Solutions/meetily)
  (self-hosted Whisper/Ollama, diarization, action items). Adopt **only if**
  Google Drive access is unavailable or vendor-independence is required. The
  harness consumes Meetily's exported transcript; we do not fork it.
- Rejected for now: `meeting-scribe`, `meetscribe` — capable but redundant once
  Gemini Docs or Meetily covers capture.

### Dashboard + self-heal + autonomy modes — BORROW PATTERNS, not the package
- [claude-code-team-builder](https://github.com/azadmotala/claude-code-team-builder)
  has the closest model (orchestrator + progress-log/dashboard + self-healing +
  supervised/autonomous/strict modes). We **copy the concepts** (a compact
  status dashboard, a draft-only self-heal/reflection loop, explicit autonomy
  gating) into the harness CLI rather than adopting its generated `.claude/`
  wholesale — the harness already has its own routing, guard hook, and CLI.
- Reason: adopting its files as-is would duplicate/conflict with our existing
  `CLAUDE.md` routing and `PreToolUse` guard. Patterns transfer; files do not.

### Self-improve — ADAPT the pattern into a local, gated skill
- [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)
  ships a `self-improving-agent` skill (auto-memory curation). We implement an
  **adapted local skill** (`harness-self-improve`) instead of installing the
  plugin, so it composes with our guard hook and stays draft-only (proposes
  edits to skills/`knowledge/`; never auto-commits, never auto-sends).
- Revisit installing the upstream plugin directly once we confirm it respects
  `HARNESS_AUTONOMOUS` and our confirmation gate.

### Future scaffolding — KEEP as an option
- [revfactory/harness](https://github.com/revfactory/harness) meta-skill can
  generate new agent teams/skills on demand. Not wired in now; noted for when we
  need to scaffold a new workflow family.

### Runtime — STAY on Claude Code
- [earendil-works/pi](https://github.com/earendil-works/pi/) ("PI") is a strong
  model-agnostic alternative runtime, but adopting it is a pivot away from Claude
  Code (loses our connectors, guard hook, marketplace). Out of scope; documented
  as the escape hatch if we ever need local models / vendor independence.

### Monitoring (Sentry / Datadog / Amplitude) — REUSE CLIs/connectors, "if available"
- New read-only skill `harness-monitoring` surfaces production health, scoped by
  `profile.integrations`. It does **not** wrap or reimplement any vendor:
  - **Sentry:** reuse the existing `sentry-cli` skill / `sentry` CLI (issues,
    alerts, cron monitors, releases, dashboards).
  - **Datadog:** use a Datadog MCP connector (`mcp__claude_ai_Datadog__*`) or a
    `datadog-ci`/API path **if present**; skip silently otherwise.
  - **Amplitude:** use a connector or the API **if configured**; skip otherwise.
- "If available" is the contract: probe each tool, use what's connected, skip the
  rest with a one-line note. Wired into `harness dashboard` and `/standup` (via
  `monitoring_scan` in role-playbooks). Sentry write commands are gated by the
  guard hook; scheduled/autonomous runs stay read-only.
- Rejected: building a custom metrics store or a bespoke Datadog/Sentry client.

### Self-document / team-private — REUSE `knowledge/`
- The committed `knowledge/` folder is already the team-private, PR-reviewed
  memory. Self-documentation lands here (like this note); optional publish to a
  private Confluence space stays gated. No new tooling.

## Net

Build nothing that already exists. New code is limited to glue: transcript
ingestion in `harness-meetings`, a `harness dashboard` CLI aggregator, sync
auto-build, and a gated `harness-self-improve` skill.
