// `harness install-launchd` — scheduled runs via launchd instead of cron.
//
// Why not cron: on macOS cron has no Full Disk Access to ~/Documents (where the
// vault lives), so the Monday archive silently moved nothing for weeks; and cron
// skips a run the laptop slept through, whereas launchd fires a missed
// StartCalendarInterval on wake. Each job also gets a log file, a HARNESS_JOB env
// var (so index.ts records last-run.json), PATH with the nvm node, and a dollar cap.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getHarnessRepo, lastRunPath, logsDir, readConfig } from "./paths.js";
import { dockerAvailable, dockerBin, imageBuilt, runArgs, volumeExists } from "./docker.js";
import { c, fail, info, ok, warn } from "./ui.js";

export type Requires = "fs" | "claude" | "connectors";

export interface Job {
  name: string;
  /** launchd StartCalendarInterval fields. */
  when: { Weekday?: number | number[]; Hour: number; Minute: number };
  args: string[];
  comment: string;
  requires: Requires[];
  /** Expected cadence in days; doctor warns when last-run is older than this + 1. */
  cadenceDays: number;
  /** "docker": run inside the sandbox image (needed for anything that reads the vault under ~/Documents). */
  runner?: "docker";
}

export const LABEL_PREFIX = "de.sosafe.harness";

/** The scheduled jobs. Times are local. Only jobs that work without claude.ai connectors. */
export function jobs(): Job[] {
  return [
    {
      name: "compress",
      when: { Weekday: 1, Hour: 7, Minute: 50 },
      args: ["compress", "--apply", "--max-budget-usd", "3"],
      comment: "weekly (Mon): roll up dailies, distil meetings, archive dated notes; never deletes (runs in Docker — no Full Disk Access)",
      requires: ["fs", "claude"],
      cadenceDays: 7,
      runner: "docker",
    },
    {
      name: "sync",
      when: { Weekday: [1, 2, 3, 4, 5], Hour: 8, Minute: 30 },
      args: ["sync"],
      comment: "weekdays: refresh harness + plugins + self-build",
      requires: ["fs"],
      cadenceDays: 1,
    },
    {
      name: "eval",
      when: { Weekday: 0, Hour: 9, Minute: 0 },
      args: ["eval"],
      comment: "weekly (Sun): replay golden tasks so self-improve has a fresh scorecard",
      requires: ["claude"],
      cadenceDays: 7,
    },
    {
      name: "self-improve",
      when: { Weekday: 5, Hour: 16, Minute: 0 },
      args: ["self-improve", "--digest"],
      comment: "weekly (Fri): read-only reflection, capped at $2",
      requires: ["claude"],
      cadenceDays: 7,
    },
  ];
}

export const label = (j: Job): string => `${LABEL_PREFIX}.${j.name}`;
export const plistPath = (j: Job): string => join(homedir(), "Library", "LaunchAgents", `${label(j)}.plist`);

function nodeBin(): string {
  return process.execPath;
}

function pathEnv(): string {
  const parts = [dirname(nodeBin()), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const claude = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (claude.status === 0 && claude.stdout.trim()) parts.unshift(dirname(claude.stdout.trim()));
  return [...new Set(parts)].join(":");
}

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ProgramArguments for a job: the host node + CLI, or `docker run …` for sandboxed jobs. */
export function programArgs(j: Job, entry: string): string[] {
  if (j.runner === "docker") {
    const vault = readConfig()?.vaultPath ?? "";
    return runArgs(getHarnessRepo(), vault, j.name, j.args);
  }
  return [nodeBin(), entry, ...j.args];
}

export function renderPlist(j: Job, entry: string): string {
  const cal = (w: number | undefined): string =>
    `    <dict>${w !== undefined ? `<key>Weekday</key><integer>${w}</integer>` : ""}<key>Hour</key><integer>${j.when.Hour}</integer><key>Minute</key><integer>${j.when.Minute}</integer></dict>`;
  const weekdays = Array.isArray(j.when.Weekday) ? j.when.Weekday : [j.when.Weekday];
  const intervals = weekdays.length > 1 ? `  <array>\n${weekdays.map(cal).join("\n")}\n  </array>` : cal(weekdays[0]).trim();
  const logs = logsDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label(j)}</string>
  <key>Comment</key><string>${xml(j.comment)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs(j, entry).map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>StartCalendarInterval</key>
${intervals}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pathEnv())}</string>
    <key>HOME</key><string>${xml(homedir())}</string>
    <key>HARNESS_JOB</key><string>${j.name}</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(join(logs, `${j.name}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, `${j.name}.err.log`))}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

function launchctl(args: string[]): { ok: boolean; err: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, err: (r.stderr || "").trim() };
}

const CRON_BEGIN = "# >>> dev-ai-harness (managed) >>>";
const CRON_END = "# <<< dev-ai-harness (managed) <<<";

/** Remove the crontab block install-cron used to manage. */
export function removeCronBlock(): boolean {
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (current.status !== 0 || !current.stdout.includes(CRON_BEGIN)) return false;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc(CRON_BEGIN)}[\\s\\S]*?${esc(CRON_END)}\\n?`, "g");
  const next = current.stdout.replace(re, "").replace(/\n{3,}/g, "\n\n");
  const write = spawnSync("crontab", ["-"], { input: next.trim() ? next : "\n", encoding: "utf8" });
  return write.status === 0;
}

export function cronBlockPresent(): boolean {
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  return current.status === 0 && current.stdout.includes(CRON_BEGIN);
}

export function installLaunchd(argv: string[]): number {
  const apply = argv.includes("--apply");
  const uninstall = argv.includes("--uninstall");
  const entry = join(getHarnessRepo(), "cli", "dist", "index.js");
  if (!existsSync(entry)) {
    fail(`CLI entry not built: ${entry}. Run \`npm run build\` in cli/ first.`);
    return 1;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;

  if (uninstall) {
    for (const j of jobs()) {
      const p = plistPath(j);
      if (!existsSync(p)) continue;
      if (apply) {
        launchctl(["bootout", `gui/${uid}`, p]);
        unlinkSync(p);
        ok(`removed ${label(j)}`);
      } else info(`would remove ${label(j)} (${p})`);
    }
    return 0;
  }

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(logsDir(), { recursive: true });

  for (const j of jobs()) {
    const p = plistPath(j);
    const body = renderPlist(j, entry);
    if (!apply) {
      info(`${c.bold(label(j))}  ${j.comment}`);
      console.log(c.dim(`  ${p}\n  ${programArgs(j, entry).join(" ")}`));
      continue;
    }
    writeFileSync(p, body, "utf8");
    launchctl(["bootout", `gui/${uid}`, p]); // ignore: may not be loaded yet
    const r = launchctl(["bootstrap", `gui/${uid}`, p]);
    if (r.ok) ok(`loaded ${label(j)}`);
    else warn(`${label(j)}: launchctl bootstrap failed — ${r.err}`);
  }

  if (apply) {
    if (removeCronBlock()) ok("Removed the managed crontab block (cron is retired).");
    info(`Logs: ${logsDir()}. The vault job runs in Docker (no Full Disk Access needed); the others never read ~/Documents.`);
    if (!imageBuilt()) warn("Docker image not built yet — run `harness docker build` and `harness docker login` before Monday.");
  } else {
    info("Dry run. Re-run with --apply to write the plists, load them, and remove the crontab block.");
  }
  return 0;
}

export interface LastRun {
  ts: string;
  exit: number;
  duration_ms: number;
  summary?: string;
  vault_readable?: boolean;
}

export function readLastRuns(): Record<string, LastRun> {
  const p = lastRunPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, LastRun>;
  } catch {
    return {};
  }
}

export function recordLastRun(job: string, run: LastRun): void {
  const all = readLastRuns();
  all[job] = run;
  mkdirSync(dirname(lastRunPath()), { recursive: true });
  writeFileSync(lastRunPath(), JSON.stringify(all, null, 2) + "\n", "utf8");
}

/** Can this process list the vault? Under launchd without FDA this is false. */
export function vaultReadable(): boolean | undefined {
  const v = process.env.HARNESS_VAULT ?? readConfig()?.vaultPath;
  if (!v) return undefined;
  try {
    execFileSync("ls", [v], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Schedule health for `harness doctor`: returns warning lines (empty = healthy). */
export function scheduleReport(): { lines: string[]; warnings: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];
  const last = readLastRuns();
  const now = Date.now();
  for (const j of jobs()) {
    const p = plistPath(j);
    const installed = existsSync(p);
    const lr = last[j.name];
    const age = lr ? (now - new Date(lr.ts).getTime()) / 86_400_000 : null;
    const ageTxt = age === null ? "never ran" : `last ran ${age.toFixed(1)}d ago (exit ${lr!.exit})`;
    lines.push(`${installed ? "✓" : "✗"} ${j.name.padEnd(13)} ${installed ? "launchd" : "not installed"}  ${ageTxt}`);
    if (!installed) warnings.push(`${j.name}: not scheduled — run \`harness install-launchd --apply\``);
    else if (age === null || age > j.cadenceDays + 1) warnings.push(`${j.name}: overdue (${ageTxt}); check ${join(logsDir(), `${j.name}.err.log`)}`);
    if (lr && lr.vault_readable === false) {
      warnings.push(j.runner === "docker"
        ? `${j.name}: the container could not read /vault — check Docker Desktop › Settings › Resources › File sharing includes the vault's parent folder`
        : `${j.name}: could not read the vault — move this job to the Docker runner; the harness never asks for Full Disk Access`);
    }
    if (installed) {
      const plist = readFileSync(p, "utf8");
      const expected = j.runner === "docker" ? dockerBin() : nodeBin();
      if (!plist.includes(expected)) warnings.push(`${j.name}: plist points at a different ${j.runner === "docker" ? "docker" : "node"} than ${expected} — re-run \`harness install-launchd --apply\``);
    }
    if (j.runner === "docker") {
      if (!dockerAvailable()) warnings.push(`${j.name}: Docker is not reachable — start Docker Desktop (the job runs \`docker run\`)`);
      else if (!imageBuilt()) warnings.push(`${j.name}: image not built — \`harness docker build\``);
      else if (!volumeExists()) warnings.push(`${j.name}: no container login yet — \`harness docker login\` once (or set ANTHROPIC_API_KEY in ~/.claude/sosafe-harness/docker.env)`);
    }
  }
  if (cronBlockPresent()) warnings.push("a managed crontab block is still installed; `harness install-launchd --apply` removes it");
  return { lines, warnings };
}
