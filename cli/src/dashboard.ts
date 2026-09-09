// `harness dashboard` — a role-ordered developer dashboard, rendered in the
// terminal. It does not reimplement data-gathering: it composes the existing
// harness skills (harness-pm, harness-support-triage, harness-meetings) through
// the normal executeContext path, so CLAUDE.md routing and the guard hook apply.
//
// Read-only by construction: the run is autonomous (draft-only) and the prompt
// forbids any mutation. Borrows the "compact status board" idea from
// claude-code-team-builder (see knowledge/reuse-decisions.md) rather than its files.
//
// Two ideas adapted from the July 2026 "Jarvis" Show & Tell POC:
//   1. Every item is classified + ordered by definitions/urgency-matrix.json
//      (actionable/to_review/knowledge × P1/P2/P3 × leadership/external/overdue),
//      so the board is a real triage surface, not a raw dump.
//   2. Each fresh run also emits a machine-readable JSON snapshot that we cache.
//      `harness dashboard --cached` re-renders that snapshot instantly, without
//      calling the model — faster to load and resilient to model drift.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { executeContext } from "./run.js";
import { banner, info, ok, warn, c } from "./ui.js";
import { cacheDir, dashboardCachePath, ensureDir } from "./paths.js";

// How old a cached snapshot may be before `--cached` warns it's stale.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

interface DashItem {
  title: string;
  priority?: "P1" | "P2" | "P3";
  kind?: "actionable" | "to_review" | "knowledge";
  flags?: string[];
  url?: string;
  meta?: string;
}
interface DashSection {
  name: string;
  count?: number;
  items: DashItem[];
}
interface DashSnapshot {
  generatedAt: string;
  roleClass?: string;
  sections: DashSection[];
}

const PRIORITY_MARK: Record<string, string> = { P1: "🔴", P2: "🟡", P3: "⚪" };
const FLAG_MARK: Record<string, string> = { leadership: "⭐", external: "🌐", overdue: "⏰" };

const DASHBOARD_PROMPT = [
  "Produce my **developer dashboard** as a compact, scannable terminal report.",
  "This is strictly READ-ONLY: gather and summarize, never send, transition, comment, or create anything.",
  "",
  "Read ~/.claude/sosafe-harness/profile.json first (if missing, say so and continue with whatever is available).",
  "Order the sections by person.role_class using definitions/role-playbooks.json.",
  "Classify and order every item using definitions/urgency-matrix.json: assign each a kind (actionable | to_review | knowledge) and a priority (P1/P2/P3), set any flags (leadership/external/overdue), and apply the matrix's ordering rules within each section. Prefix each line with its priority marker and append flag markers per the matrix's rendering block.",
  "",
  "Scatter the gathering across subagents in ONE message so they run concurrently, then merge their JSON. Do not gather inline — the subagents are the scan; you are the merge:",
  "  - pm-scan (Task tool) — returns Jira hygiene + the PR sweep as JSON.",
  "  - support-scan (Task tool) — returns the unanswered Slack/Jira queue as JSON. Surface only; no drafting.",
  "  - prep-assess (Task tool) — one instance per meeting on today's calendar; returns prep signals as JSON.",
  "  - harness-monitoring (Skill tool) — only if profile.integrations has a monitoring tool configured; skip silently otherwise.",
  "Do NOT invoke harness-pm or harness-support-triage here: they would redo the same scan in this context.",
  "",
  "Sections (omit any that have no data, show counts in the headers):",
  "1. PRs — from pm-scan: open PRs across profile.repos needing review, or mine and stalled.",
  "2. Jira — from pm-scan: my in-progress, blocked, and due-soon items. Report only; apply no fixes.",
  "3. Meetings — from prep-assess, plus open follow-ups (unchecked action items) in the vault's meetings/ notes.",
  "4. Support — from support-scan: the current unanswered queue only.",
  "5. Monitoring — production health from whatever is configured. 'If available': skip any tool that isn't. Lead with anything firing or unresolved; link dashboards.",
  "",
  "If any scan reports an entry in its `unavailable` array, list those capabilities in one closing line using the degrade message from definitions/mcp-fallbacks.json. A thin dashboard must be distinguishable from a quiet day.",
  "",
  "Formatting: one line per item, prefixed with a terminal-friendly marker; group under bold section headers with counts, e.g. 'PRs (3)'.",
  "End the human-readable part with a single actionable line: 'Run `harness triage`, `harness followup`, `harness monitoring`, or ask me to fix Jira hygiene — I'll confirm before anything is sent.'",
  "",
  "THEN, as the very last thing in your reply, output exactly one fenced ```json block (nothing after it) with this shape so the CLI can cache and re-render it:",
  '```json',
  '{"generatedAt":"<ISO8601>","roleClass":"<ic|manager|staff>","sections":[{"name":"PRs","count":<n>,"items":[{"title":"<short>","priority":"P1|P2|P3","kind":"actionable|to_review|knowledge","flags":["leadership"],"url":"<url or omit>","meta":"<e.g. due today, blocked, 2d stale>"}]}]}',
  '```',
].join("\n");

/** Pull the last fenced ```json block out of the model's reply. */
function parseSnapshot(text: string): DashSnapshot | null {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][1].trim();
  try {
    const snap = JSON.parse(raw) as DashSnapshot;
    if (!Array.isArray(snap.sections)) return null;
    if (!snap.generatedAt) snap.generatedAt = new Date().toISOString();
    return snap;
  } catch {
    return null;
  }
}

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Render a cached snapshot to the terminal — no model call. */
function renderSnapshot(snap: DashSnapshot): void {
  banner();
  const role = snap.roleClass ? c.dim(` [${snap.roleClass}]`) : "";
  info(`Cached dashboard${role} · generated ${ageString(snap.generatedAt)}`);
  process.stdout.write("\n");
  for (const section of snap.sections) {
    const items = section.items ?? [];
    const count = section.count ?? items.length;
    if (!count) continue;
    process.stdout.write(`${c.bold(`${section.name} (${count})`)}\n`);
    for (const it of items) {
      const pri = it.priority ? PRIORITY_MARK[it.priority] ?? it.priority : "·";
      const flags = (it.flags ?? []).map((f) => FLAG_MARK[f] ?? `[${f}]`).join("");
      const meta = it.meta ? c.dim(` — ${it.meta}`) : "";
      const url = it.url ? c.dim(`  ${it.url}`) : "";
      process.stdout.write(`  ${pri} ${flags ? flags + " " : ""}${it.title}${meta}${url}\n`);
    }
    process.stdout.write("\n");
  }
  info("Stale? Run `harness dashboard` (no flag) to refresh from live sources.");
}

function writeCache(snap: DashSnapshot): void {
  ensureDir(cacheDir());
  writeFileSync(dashboardCachePath(), JSON.stringify(snap, null, 2) + "\n", "utf8");
}

function readCache(): DashSnapshot | null {
  const p = dashboardCachePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DashSnapshot;
  } catch {
    return null;
  }
}

export async function dashboard(rest: string[]): Promise<number> {
  const digest = rest.includes("--digest");
  const cached = rest.includes("--cached");
  const flags = new Set(["--digest", "--cached"]);
  const extra = rest.filter((a) => !flags.has(a)).join(" ").trim();

  // Fast path: render the last-known-good snapshot without touching the model.
  if (cached) {
    const snap = readCache();
    if (!snap) {
      warn("No cached dashboard yet. Running a fresh one to seed the cache…");
    } else {
      renderSnapshot(snap);
      if (Date.now() - new Date(snap.generatedAt).getTime() > CACHE_TTL_MS) {
        warn(`Snapshot is over ${Math.round(CACHE_TTL_MS / 3600000)}h old — consider refreshing.`);
      }
      return 0;
    }
  }

  const prompt = extra ? `${DASHBOARD_PROMPT}\n\nExtra focus for this run: ${extra}` : DASHBOARD_PROMPT;
  banner();
  const result = await executeContext({ context: "dashboard", prompt, digest });

  // Cache the structured snapshot so `--cached` can re-render it instantly.
  const snap = result.text ? parseSnapshot(result.text) : null;
  if (snap) {
    writeCache(snap);
    ok(`Snapshot cached → ${dashboardCachePath()} (re-render fast with \`harness dashboard --cached\`)`);
  } else {
    warn("Could not parse a JSON snapshot from this run — cache left unchanged.");
  }
  return 0;
}
