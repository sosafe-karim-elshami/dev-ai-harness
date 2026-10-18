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

## 2026-10-18 (later)

**Applied**
- Phase 2: `harness compress` v2 landed and ran on the real vault (W39 + W40 rolled up for $0.31, 9 originals archived, 112 pre-archive links repaired, 0 ambiguous, file count 208 → 211). launchd replaces the dead cron; `harness doctor` reports schedule health and Full Disk Access.
- Phase 3: `/ship` composite, three new agents, always-on `deny-destructive.sh`, `ship-stop-gate.sh`, `harness ship` + `harness doctor --ship`. Course-builder readiness: lint/test/build ✓, typecheck N/A (upstream ask), worktrees ignore handled locally.
- Phase 4: all nine agents reply sentinel + JSON per `definitions/agent-output-contract.md`.

**Outstanding**
- Run the full 38-task eval and compare with the 2026-10-18 baseline (21/26). New tasks must be seen failing before they are trusted.
- `harness install-launchd --apply` from the main checkout, then grant Full Disk Access to the nvm node binary.
- `sosafe-ai-bouncer` install (user-level hooks).
- Upstream: `typecheck` script + `.claude/worktrees/` gitignore in `fe-lib-course-builder` / `fe-mf-course-engine`; browser-smoke gate → task-to-pr; compress → sosafe-claude-productivity; LT config for ticket-loop.
