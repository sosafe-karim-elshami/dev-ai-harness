// `harness metrics` — the observability layer.
//
// Weng's essay: "without observability there is no way to tell whether the agent
// is doing well or quietly drifting." Ported from the CMS Platform vault. Reads
// the append-only run log written by .claude/hooks/log-skill-run.sh (one line
// per Skill invocation) and reports which skills run, how often, with what
// success rate, and which have gone stale or drifted (logged but gone from disk).
//
// Read-only. The log lives in the PER-USER private dir, never in the repo.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, configDir } from "./paths.js";
import { banner, c, info, warn } from "./ui.js";

interface Run {
  ts?: number;
  skill?: string;
  success?: boolean;
}

interface SkillRow {
  skill: string;
  exists: boolean;
  runs_total: number;
  runs_window: number;
  failures: number;
  success_rate: number | null;
  last_seen_days_ago: number | null;
}

const runsPath = (): string => join(configDir(), "runs.jsonl");

function loadRuns(path: string): Run[] {
  if (!existsSync(path)) return [];
  const runs: Run[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      runs.push(JSON.parse(t) as Run);
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
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of runs) {
    if (!r.skill) continue;
    const ts = r.ts ?? 0;
    bump(total, r.skill);
    if (ts >= cutoff) bump(recent, r.skill);
    if (r.success === false) bump(fails, r.skill);
    lastSeen.set(r.skill, Math.max(lastSeen.get(r.skill) ?? 0, ts));
  }

  const seen = new Set(total.keys());
  const neverUsed = [...skills].filter((s) => !seen.has(s)).sort();
  const orphanLogs = [...seen].filter((s) => !skills.has(s)).sort();

  const perSkill: SkillRow[] = [...new Set([...skills, ...seen])].sort().map((name) => {
    const runsN = total.get(name) ?? 0;
    const f = fails.get(name) ?? 0;
    const ls = lastSeen.get(name);
    return {
      skill: name,
      exists: skills.has(name),
      runs_total: runsN,
      runs_window: recent.get(name) ?? 0,
      failures: f,
      success_rate: runsN ? round(1 - f / runsN, 3) : null,
      last_seen_days_ago: ls !== undefined ? round((now - ls) / 86400, 1) : null,
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
          never_used: neverUsed,
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

  const active = perSkill.filter((s) => s.runs_total).sort((a, b) => b.runs_total - a.runs_total);
  if (active.length) {
    process.stdout.write(
      c.dim("skill".padEnd(26) + "runs".padStart(6) + `${windowDays}d`.padStart(6) + "ok".padStart(6) + "age(d)".padStart(9)) + "\n",
    );
    for (const s of active) {
      const ok = s.success_rate === null ? "" : pct(s.success_rate);
      const age = s.last_seen_days_ago === null ? "" : String(s.last_seen_days_ago);
      const okCol = s.failures > 0 ? c.yellow(ok.padStart(6)) : ok.padStart(6);
      process.stdout.write(
        s.skill.padEnd(26) + String(s.runs_total).padStart(6) + String(s.runs_window).padStart(6) + okCol + age.padStart(9) + "\n",
      );
    }
    process.stdout.write("\n");
  }

  if (neverUsed.length) info(`Never invoked (${neverUsed.length}): ${neverUsed.join(", ")}`);
  if (orphanLogs.length) warn(`Orphan logs (skill gone from disk — rename/drift): ${orphanLogs.join(", ")}`);
  if (!runs.length) {
    info("No runs logged yet. The PostToolUse hook logs skill invocations going forward.");
    info("Coverage climbs as you use the harness in Claude Code.");
  } else if (totals.instrumentation_coverage < 0.5) {
    info("Low coverage — most skills have no run data yet; it accrues as skills get used.");
  }
  return 0;
}
