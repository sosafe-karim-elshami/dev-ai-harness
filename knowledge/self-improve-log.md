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

## 2026-10-18 (reflection pass)

**Applied**
- Nothing new since the previous entry (HEAD 75c0024 is a gitignore fix). No scorecard newer than the 21/26 baseline, so no delta to report.

**Outstanding** (red confirmed from the 2026-10-18-12-20 scorecard; `harness registry check` is green, 15 skills)
- Full 38-task eval still not run; 12 tasks added since the baseline have never been seen failing.
- launchd: compress/sync/eval/self-improve all "not installed"; the old crontab block is still live (`harness doctor`).
- Baseline failures: route-standup, route-monitoring, route-find-skill, cite-mcp-degradation, cite-system-map.
- Telemetry: 28% of runs are "unregistered" (compress, archive, checkin, standup) and cost is only recorded for CLI runs; 6 skills never invoked.

## 2026-10-18 — final eval of the refactor

**Measured** (`eval-2026-10-18-13-14.md`, 38 tasks, $16.02, 676 s): 20/38. Against the pre-refactor baseline (`eval-2026-10-18-12-20.md`, 26 tasks, 21/26): routing 11/13 vs 10/12, readonly 34/36 vs 25/26, citations 11/13 vs 8/10, grounding 10/11 vs 8/8 — the old promises held or improved. The drop is the new, stricter dimensions: **verbosity 11/23** (12 replies over the 8-line ceiling), plus four eval-harness bugs fixed the same day (`(?i)` regex, `rm -rf` false positive, `~/.claude` counted as a repo path, `/harness` missing from the standup route list) — after the fix, the five affected tasks were re-run and all pass (`route-standup`, `cite-output-contract`, `readonly-ship-merge`, `ship-draft-not-ready`, `route-review`), so the effective score is 25/38.

**Red, on purpose (seen failing first):**
- `verbosity` — replies to factual asks run 13–23 non-empty lines. Candidate fix: move the "8 lines" rule from CLAUDE.md prose into a Stop-hook check or a `.claude/rules/reply.md`; measure before trusting. Do NOT add a strong prohibition to CLAUDE.md (see `anti-patterns/never-answer-from-memory-instruction.md`).
- `route-find-skill` — the model answers "which skill handles X" from memory with no tool call and no citation. Same anti-pattern family.
- `cite-system-map` — still no citation (failed in the baseline too).
- `cite-ship-verify-gate` — cites the skill but not `verify-gate.md` by path.

**Cost note:** the two `/review` golden tasks cost $5.14 and $4.23 each (84–88 tool calls) — the review fan-out is the most expensive thing the eval runs; consider a smaller fixture diff for those tasks.
