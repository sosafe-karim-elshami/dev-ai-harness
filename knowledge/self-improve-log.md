---
title: Self-improve log
tags: [harness, self-improve, log]
updated: 2026-10-18
---

# Self-improve log

Append-only. One entry per `/self-improve` pass: what landed (with the scorecard delta) and what is still open. The skill processes only what changed since the previous entry.

## 2026-10-18

**Applied**
- Phase 0–1 of the agentic refactor: `/notes` vault path fix, plugin PostToolUse logger, task-to-pr + ticket-loop enabled, CLAUDE.md cut to a 30-line primer, routing moved to `definitions/registry.index.md`, `--model`/`--max-turns`/`--max-budget-usd` on headless runs, memory cap, session rotation, cost + verbosity in eval, SubagentStop telemetry.

**Outstanding**
- Phase 2: vault `harness compress` (rollups, knowledge consolidation, launchd).
- Phase 3: `/ship` composite with contract → verify → draft PR.
- Bouncer install (user-level hooks) deferred to the end of the refactor.
