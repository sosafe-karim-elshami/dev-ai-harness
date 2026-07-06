// `harness dashboard` — a role-ordered developer dashboard, rendered in the
// terminal. It does not reimplement data-gathering: it composes the existing
// harness skills (harness-pm, harness-support-triage, harness-meetings) through
// the normal executeContext path, so CLAUDE.md routing and the guard hook apply.
//
// Read-only by construction: the run is autonomous (draft-only) and the prompt
// forbids any mutation. Borrows the "compact status board" idea from
// claude-code-team-builder (see knowledge/reuse-decisions.md) rather than its files.

import { executeContext } from "./run.js";
import { banner } from "./ui.js";

const DASHBOARD_PROMPT = [
  "Produce my **developer dashboard** as a compact, scannable terminal report.",
  "This is strictly READ-ONLY: gather and summarize, never send, transition, comment, or create anything.",
  "",
  "Read ~/.claude/sosafe-harness/profile.json first (if missing, say so and continue with whatever is available).",
  "Order the sections by person.role_class using definitions/role-playbooks.json.",
  "",
  "Sections (omit any that have no data, show counts in the headers):",
  "1. PRs — open PRs across profile.repos that need review or are mine and stalled (invoke harness-pm, PR-tracking part only).",
  "2. Jira — my in-progress, blocked, and due-soon items (harness-pm status part; do not apply fixes).",
  "3. Meetings — today's calendar events + any open follow-ups found in .scratch/meetings/*.md (unchecked action items).",
  "4. Support — the current unanswered queue only (harness-support-triage step 1; do not draft unless asked).",
  "5. Monitoring — invoke harness-monitoring for production health from whatever is configured in profile.integrations (Sentry issues/alerts/cron monitors, Datadog monitors, Amplitude). 'If available': skip any tool that isn't configured. Lead with anything firing/unresolved; link dashboards.",
  "",
  "Formatting: one line per item, prefixed with a terminal-friendly marker; group under bold section headers with counts, e.g. 'PRs (3)'.",
  "End with a single actionable line: 'Run `harness triage`, `harness followup`, `harness monitoring`, or ask me to fix Jira hygiene — I'll confirm before anything is sent.'",
].join("\n");

export async function dashboard(rest: string[]): Promise<number> {
  const digest = rest.includes("--digest");
  const extra = rest.filter((a) => a !== "--digest").join(" ").trim();
  const prompt = extra ? `${DASHBOARD_PROMPT}\n\nExtra focus for this run: ${extra}` : DASHBOARD_PROMPT;

  banner();
  await executeContext({ context: "dashboard", prompt, digest });
  return 0;
}
