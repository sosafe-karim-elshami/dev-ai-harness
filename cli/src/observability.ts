// `harness metrics` — the observability layer.
//
// Weng's essay: "without observability there is no way to tell whether the agent
// is doing well or quietly drifting." Ported from the CMS Platform vault. Reads
// the append-only run log written by .claude/hooks/log-skill-run.sh (one line
// per Skill invocation) and reports which skills run, how often, with what
// success rate, and which have gone stale or drifted (logged but gone from disk).
//
// Read-only. The log lives in the PER-USER private dir, never in the repo.

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, configDir, ensureDir } from "./paths.js";
import { banner, c, info, warn } from "./ui.js";
import { loadRegistry, type Tier } from "./registry.js";

export interface Run {
  ts?: number;
  event?: string;
  skill?: string;
  success?: boolean;
  /** Jira key the run was about, when the hook or CLI could attribute one. */
  ticket?: string;
  /** Present for CLI-spawned runs (claude -p reports it); absent for in-session hooks. */
  cost_usd?: number;
  duration_ms?: number;
  turns?: number;
  agent?: string;
  session_id?: string;
}

/** Append one record to runs.jsonl. Non-fatal: telemetry must never break a run. */
export function appendRun(run: Omit<Run, "ts"> & { ts?: number }): void {
  try {
    ensureDir(configDir());
    appendFileSync(runsPath(), JSON.stringify({ ts: Math.floor(Date.now() / 1000), ...run }) + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

interface SkillRow {
  skill: string;
  exists: boolean;
  /** Declared model tier from definitions/registry.json, if the skill is registered. */
  tier: Tier | null;
  runs_total: number;
  runs_window: number;
  failures: number;
  success_rate: number | null;
  last_seen_days_ago: number | null;
  /** Sum of cost_usd over runs that reported one (CLI runs only). */
  cost_usd: number;
}

/**
 * Runs grouped by the tier the registry says they should run at. This is the
 * check on model allocation: if most invocations land on opus-tier skills, the
 * allocation is aspirational rather than real, and the cheap tiers aren't earning
 * their keep.
 */
function tierSpend(rows: SkillRow[]): Record<Tier | "unregistered", number> {
  const out: Record<Tier | "unregistered", number> = { haiku: 0, sonnet: 0, opus: 0, unregistered: 0 };
  for (const r of rows) out[r.tier ?? "unregistered"] += r.runs_total;
  return out;
}

/** Dollars by declared tier, from the runs that reported a cost. */
function tierCost(rows: SkillRow[]): Record<Tier | "unregistered", number> {
  const out: Record<Tier | "unregistered", number> = { haiku: 0, sonnet: 0, opus: 0, unregistered: 0 };
  for (const r of rows) out[r.tier ?? "unregistered"] += r.cost_usd;
  return out;
}

const runsPath = (): string => join(configDir(), "runs.jsonl");

function loadRuns(path: string): Run[] {
  if (!existsSync(path)) return [];
  const runs: Run[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const run = JSON.parse(t) as Run;
      // log-skill-run.sh strips the plugin namespace, but only for runs logged
      // after that fix. Normalize here too so historical `dev-ai-harness:foo`
      // entries fold into `foo` instead of masquerading as a separate skill.
      if (run.skill) run.skill = run.skill.replace(/^dev-ai-harness:/, "");
      runs.push(run);
    } catch {
      // Tolerate a corrupt line rather than crash the report.
    }
  }
  return runs;
}

function existingSkills(skillsDir: string): Set<string> {
  if (!existsSync(skillsDir)) return new Set();
  const names = new Set<string>();
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(skillsDir, e.name, "SKILL.md"))) names.add(e.name);
  }
  return names;
}

const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function metrics(rest: string[]): number {
  const asJson = rest.includes("--json");
  const wIdx = rest.indexOf("--window-days");
  const windowDays = wIdx !== -1 && rest[wIdx + 1] ? parseInt(rest[wIdx + 1], 10) || 7 : 7;

  let skillsDir: string;
  try {
    skillsDir = join(getHarnessRepo(), ".claude", "skills");
  } catch (e) {
    warn((e as Error).message);
    return 1;
  }

  const runs = loadRuns(runsPath());
  const skills = existingSkills(skillsDir);
  const now = Date.now() / 1000;
  const cutoff = now - windowDays * 86400;

  const total = new Map<string, number>();
  const recent = new Map<string, number>();
  const fails = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  const cost = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of runs) {
    if (!r.skill) continue;
    if (r.event === "subagent_stop") continue; // attributed to the parent skill's run
    const ts = r.ts ?? 0;
    bump(total, r.skill);
    if (typeof r.cost_usd === "number") cost.set(r.skill, (cost.get(r.skill) ?? 0) + r.cost_usd);
    if (ts >= cutoff) bump(recent, r.skill);
    if (r.success === false) bump(fails, r.skill);
    lastSeen.set(r.skill, Math.max(lastSeen.get(r.skill) ?? 0, ts));
  }

  const seen = new Set(total.keys());
  const neverUsed = [...skills].filter((s) => !seen.has(s)).sort();

  // A logged name that isn't a skill dir is not automatically drift. It may be a
  // harness slash command or composite (both legitimately logged), or a global /
  // marketplace skill from outside this repo. Only the remainder is real drift —
  // a renamed or deleted harness skill still being invoked.
  let known = new Set<string>();
  try {
    const reg = loadRegistry();
    known = new Set([
      ...reg.skills.map((s) => s.name),
      ...reg.composites.map((k) => k.name),
      ...reg.skills.flatMap((s) => s.entry.map((e) => e.replace(/^\//, ""))),
      ...reg.composites.flatMap((k) => k.entry.map((e) => e.replace(/^\//, ""))),
    ]);
  } catch {
    /* no registry; everything unknown falls to external */
  }
  const unmatched = [...seen].filter((s) => !skills.has(s)).sort();
  const harnessComposites = unmatched.filter((s) => known.has(s));
  // Namespaced (`plugin:skill`) or absent from the registry → owned elsewhere.
  const external = unmatched.filter((s) => !known.has(s) && (s.includes(":") || !s.startsWith("harness-")));
  const orphanLogs = unmatched.filter((s) => !known.has(s) && !external.includes(s));

  // Declared tiers, so run counts can be reported against the allocation they were
  // supposed to follow. A missing registry is non-fatal — tiers just read as null.
  let tiers = new Map<string, Tier>();
  try {
    tiers = new Map(loadRegistry().skills.map((s) => [s.name, s.tier]));
  } catch {
    /* registry absent or unreadable; report without tiers */
  }

  const perSkill: SkillRow[] = [...new Set([...skills, ...seen])].sort().map((name) => {
    const runsN = total.get(name) ?? 0;
    const f = fails.get(name) ?? 0;
    const ls = lastSeen.get(name);
    return {
      skill: name,
      exists: skills.has(name),
      tier: tiers.get(name) ?? null,
      runs_total: runsN,
      runs_window: recent.get(name) ?? 0,
      failures: f,
      success_rate: runsN ? round(1 - f / runsN, 3) : null,
      last_seen_days_ago: ls !== undefined ? round((now - ls) / 86400, 1) : null,
      cost_usd: round(cost.get(name) ?? 0, 4),
    };
  });

  const everInvoked = [...seen].filter((s) => skills.has(s)).length;
  const totals = {
    skills_on_disk: skills.size,
    skills_ever_invoked: everInvoked,
    instrumentation_coverage: skills.size ? round(everInvoked / skills.size, 3) : 0,
    runs_logged: [...total.values()].reduce((a, b) => a + b, 0),
    runs_in_window: [...recent.values()].reduce((a, b) => a + b, 0),
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generated_at: Math.floor(now),
          window_days: windowDays,
          totals,
          tier_spend: tierSpend(perSkill),
          tier_cost_usd: tierCost(perSkill),
          never_used: neverUsed,
          harness_composites: harnessComposites,
          external_skills: external,
          orphan_logs: orphanLogs,
          per_skill: perSkill.map(({ runs_window, ...rest }) => ({ ...rest, [`runs_${windowDays}d`]: runs_window })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  banner();
  process.stdout.write(c.bold("Harness Observability\n"));
  process.stdout.write(
    `  ${c.dim("skills on disk")}      ${totals.skills_on_disk}\n` +
      `  ${c.dim("ever invoked")}        ${totals.skills_ever_invoked}\n` +
      `  ${c.dim("coverage")}            ${pct(totals.instrumentation_coverage)}\n` +
      `  ${c.dim("runs (all time)")}     ${totals.runs_logged}\n` +
      `  ${c.dim(`runs (last ${windowDays}d)`)}     ${totals.runs_in_window}\n\n`,
  );

  const spend = tierSpend(perSkill);
  const dollars = tierCost(perSkill);
  const spendTotal = Object.values(spend).reduce((a, b) => a + b, 0);
  if (spendTotal) {
    process.stdout.write(c.bold("Runs by declared tier") + c.dim("   (cost: CLI runs only — in-session hooks report no cost)\n"));
    for (const t of ["haiku", "sonnet", "opus", "unregistered"] as const) {
      if (!spend[t]) continue;
      process.stdout.write(
        `  ${c.dim(t.padEnd(14))}${String(spend[t]).padStart(5)}  ${c.dim(pct(spend[t] / spendTotal))}  ${c.dim(`$${dollars[t].toFixed(2)}`)}\n`,
      );
    }
    process.stdout.write("\n");
  }

  const active = perSkill.filter((s) => s.runs_total).sort((a, b) => b.runs_total - a.runs_total);
  if (active.length) {
    const NAME_W = 32;
    const fit = (s: string) => (s.length > NAME_W - 1 ? s.slice(0, NAME_W - 2) + "…" : s).padEnd(NAME_W);
    process.stdout.write(
      c.dim(
        "skill".padEnd(NAME_W) + "tier".padEnd(8) + "runs".padStart(6) + `${windowDays}d`.padStart(6) + "ok".padStart(6) + "age(d)".padStart(9),
      ) + "\n",
    );
    for (const s of active) {
      const ok = s.success_rate === null ? "" : pct(s.success_rate);
      const age = s.last_seen_days_ago === null ? "" : String(s.last_seen_days_ago);
      const okCol = s.failures > 0 ? c.yellow(ok.padStart(6)) : ok.padStart(6);
      const tier = s.tier ? c.magenta(s.tier.padEnd(8)) : c.dim("—".padEnd(8));
      process.stdout.write(
        fit(s.skill) + tier + String(s.runs_total).padStart(6) + String(s.runs_window).padStart(6) + okCol + age.padStart(9) + "\n",
      );
    }
    process.stdout.write("\n");
  }

  const unregistered = perSkill.filter((s) => s.exists && !s.tier).map((s) => s.skill);
  if (unregistered.length) {
    warn(`Not in the registry (no declared tier): ${unregistered.join(", ")}. Run \`harness registry check\`.`);
  }

  if (neverUsed.length) info(`Never invoked (${neverUsed.length}): ${neverUsed.join(", ")}`);
  if (harnessComposites.length) info(`Commands/composites (no skill dir by design): ${harnessComposites.join(", ")}`);
  if (external.length) info(`External skills (outside this repo): ${external.join(", ")}`);
  if (orphanLogs.length) warn(`Orphan logs — harness skill gone from disk (rename/drift): ${orphanLogs.join(", ")}`);
  if (!runs.length) {
    info("No runs logged yet. The PostToolUse hook logs skill invocations going forward.");
    info("Coverage climbs as you use the harness in Claude Code.");
  } else if (totals.instrumentation_coverage < 0.5) {
    info("Low coverage — most skills have no run data yet; it accrues as skills get used.");
  }
  return 0;
}
