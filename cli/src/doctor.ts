// `harness doctor` — which capabilities does this environment actually have?
//
// The harness leans on `mcp__claude_ai_*` connectors that are authenticated
// interactively through claude.ai. They are frequently ABSENT in headless and
// cron runs, and a skill that only knows the connector loses that capability
// silently — an autonomous digest missing Calendar reads exactly like a day with
// no meetings. This walks definitions/mcp-fallbacks.json and reports, per
// capability, what is reachable from *here*.
//
// CLI-backed capabilities (github, sentry, datadog, jira-via-acli) are probed for
// real. claude.ai connectors can't be probed from outside a session, so they're
// reported as "session-only" rather than guessed at — that distinction is the
// whole point of the command.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { getHarnessRepo, memoryDir, readConfig, profilePath } from "./paths.js";
import { scheduleReport } from "./launchd.js";
import { loadMemory, memoryOverBudget } from "./memory.js";
import { banner, c, ok, warn, info, fail } from "./ui.js";

interface Chain {
  kind: string;
  tools?: string;
  probe?: string;
  read?: string;
  note?: string;
}

interface Capability {
  preferred: Chain;
  fallback: Chain;
  note?: string;
  degrade: string;
}

interface Fallbacks {
  capabilities: Record<string, Capability>;
  rules: string[];
}

type Status = "ok" | "session-only" | "missing";

/** Run a probe command; true if it exits 0. */
function probe(cmd: string): boolean {
  const [bin, ...args] = cmd.split(/\s+/);
  try {
    execFileSync(bin, args, { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk the WHOLE chain rather than stopping at the first link. A capability whose
 * preferred link is a claude.ai connector may still have a CLI further down that
 * works headless — Jira via `acli` is exactly that case, and it's the difference
 * between a cron run that degrades and one that doesn't.
 */
function evaluate(cap: Capability): { status: Status; headless: string | null; session: string | null } {
  let headless: string | null = null;
  let session: string | null = null;

  for (const link of [cap.preferred, cap.fallback]) {
    if (link.kind === "cli" && link.probe) {
      if (!headless && probe(link.probe)) headless = link.probe.split(/\s+/)[0];
    } else if ((link.kind === "mcp" || link.kind === "skill") && !session) {
      // Can't verify a claude.ai connector from outside a session.
      session = link.tools ?? link.kind;
    } else if (link.kind === "user-supplied" && !session) {
      session = "pasted input";
    }
  }

  const status: Status = headless ? "ok" : session ? "session-only" : "missing";
  return { status, headless, session };
}

type Probe = { name: string; status: "ok" | "missing" | "session-only"; detail?: string; critical: boolean };

function has(cmd: string, args: string[] = ["--version"]): boolean {
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

/** Where task-to-pr's verify script lives (plugin cache first, marketplace clone second). */
export function verifyScriptPath(): string | null {
  const cache = join(homedir(), ".claude", "plugins", "cache", "sosafe-claude-market", "sosafe-ai-harness");
  if (existsSync(cache)) {
    for (const v of readdirSync(cache)) {
      const p = join(cache, v, "task-to-pr", "scripts", "harness-verify.mjs");
      if (existsSync(p)) return p;
    }
  }
  const mkt = join(homedir(), ".claude", "plugins", "marketplaces", "sosafe-claude-market", "plugins", "sosafe-ai-harness", "task-to-pr", "scripts", "harness-verify.mjs");
  return existsSync(mkt) ? mkt : null;
}

/** `harness doctor --ship [repo]`: can /ship actually run its gates here? */
function shipDoctor(harnessRepo: string, repoArg?: string): number {
  const probes: Probe[] = [];
  const push = (name: string, okay: boolean, critical: boolean, detail?: string, sessionOnly = false): void => {
    probes.push({ name, status: okay ? "ok" : sessionOnly ? "session-only" : "missing", detail, critical });
  };

  // Harness-side invariants.
  const settings = JSON.parse(readFileSync(join(harnessRepo, ".claude", "settings.json"), "utf8"));
  const hooksJson = JSON.parse(readFileSync(join(harnessRepo, ".claude", "hooks", "hooks.json"), "utf8"));
  push("plugin hooks.json has PostToolUse logger", Boolean(hooksJson.hooks?.PostToolUse), true);
  push("deny-destructive hook registered", JSON.stringify(settings.hooks?.PreToolUse ?? []).includes("deny-destructive"), true);
  push("settings deny rules (merge/push main/reset --hard)", (settings.permissions?.deny ?? []).some((d: string) => d.includes("gh pr merge")), true);
  for (const a of ["ac-contract", "browser-smoke", "contract-reviewer"]) push(`agent ${a}`, existsSync(join(harnessRepo, ".claude", "agents", `${a}.md`)), true);
  const enabled = Object.keys(settings.enabledPlugins ?? {});
  for (const p of ["sosafe-ai-harness", "sosafe-pr-workflow", "sosafe-security", "sosafe-ticket-loop"]) push(`plugin ${p} enabled`, enabled.some((e) => e.startsWith(`${p}@`)), true);
  const env = settings.env ?? {};
  for (const k of ["JIRA_URL", "JIRA_PROJECT_KEY", "GITHUB_DEFAULT_LABEL"]) push(`env ${k}`, Boolean(env[k]), false, env[k]);
  const verify = verifyScriptPath();
  push("harness-verify.mjs resolvable", Boolean(verify), true, verify ?? "install sosafe-ai-harness");

  // Local tooling.
  push("gh authenticated", spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0, true);
  push("semgrep CLI", has("semgrep"), false, has("semgrep") ? undefined : "brew install semgrep — Semgrep rows report as unverified without it");
  push("node ≥ 20", Number(process.versions.node.split(".")[0]) >= 20, true, process.versions.node);
  push("Chrome DevTools MCP", false, false, "mcp__chrome-devtools__* — verified in-session only", true);
  push("Jira (Atlassian MCP)", false, true, "session-only; headless runs stop at orient", true);

  // Target repos.
  let repos: string[] = [];
  if (repoArg) repos = [resolve(repoArg)];
  else if (existsSync(profilePath())) {
    const prof = JSON.parse(readFileSync(profilePath(), "utf8"));
    repos = (prof.repos ?? []).filter((r: any) => r.role === "maintainer" && r.local_path).map((r: any) => r.local_path);
  }
  for (const repo of repos) {
    const tag = repo.split("/").pop();
    if (!existsSync(join(repo, "package.json"))) {
      push(`${tag}: package.json`, false, true, repo);
      continue;
    }
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    const have = (names: string[]): string | undefined => names.find((n) => scripts[n]);
    push(`${tag}: lint`, Boolean(have(["harness:lint", "lint"])), true, have(["harness:lint", "lint"]));
    push(`${tag}: test`, Boolean(have(["harness:test", "test:ci", "test"])), true, have(["harness:test", "test:ci", "test"]));
    push(`${tag}: build`, Boolean(have(["harness:build", "build"])), true, have(["harness:build", "build"]));
    push(`${tag}: typecheck`, Boolean(have(["harness:typecheck", "typecheck"])), false, have(["harness:typecheck", "typecheck"]) ?? "N/A — upstream ask: add \"typecheck\": \"tsc --noEmit\"");
    push(`${tag}: install:secure`, Boolean(scripts["install:secure"]), false);
    const gi = existsSync(join(repo, ".gitignore")) ? readFileSync(join(repo, ".gitignore"), "utf8") : "";
    const ex = existsSync(join(repo, ".git", "info", "exclude")) ? readFileSync(join(repo, ".git", "info", "exclude"), "utf8") : "";
    const ignored = /\.claude\/worktrees/.test(gi) || /\.claude\/worktrees/.test(ex);
    push(`${tag}: .claude/worktrees/ ignored`, ignored, false, ignored ? undefined : "/ship adds it to .git/info/exclude on first run; upstream ask: .gitignore");
  }
  if (!repos.length) push("target repos", false, true, "no maintainer repos in profile.json and no --ship <repo> given");

  banner();
  info("Ship readiness:\n");
  for (const p of probes) {
    const mark = p.status === "ok" ? c.green("✓") : p.status === "session-only" ? c.yellow("?") : p.critical ? c.red("✗") : c.yellow("!");
    console.log(`  ${mark} ${p.name}${p.detail ? c.dim(`  ${p.detail}`) : ""}`);
  }
  const blocking = probes.filter((p) => p.status === "missing" && p.critical);
  console.log("");
  if (blocking.length) warn(`${blocking.length} gate-critical probe(s) missing — /ship would stop early.`);
  else ok("Every gate-critical probe passes; session-only ones need an interactive session.");
  return blocking.length ? 1 : 0;
}

export function doctor(argv: string[]): number {
  const harnessRepo = getHarnessRepo();
  const shipIdx = argv.indexOf("--ship");
  if (shipIdx !== -1) return shipDoctor(harnessRepo, argv[shipIdx + 1] && !argv[shipIdx + 1].startsWith("--") ? argv[shipIdx + 1] : undefined);
  const file = join(harnessRepo, "definitions", "mcp-fallbacks.json");
  if (!existsSync(file)) {
    fail(`No fallback map at ${file}.`);
    return 1;
  }
  const fb = JSON.parse(readFileSync(file, "utf8")) as Fallbacks;
  const json = argv.includes("--json");

  const rows = Object.entries(fb.capabilities).map(([name, cap]) => {
    const { status, headless, session } = evaluate(cap);
    return { capability: name, status, headless, session, degrade: cap.degrade };
  });

  if (json) {
    console.log(JSON.stringify({ capabilities: rows }, null, 2));
    return rows.some((r) => r.status === "missing") ? 1 : 0;
  }

  banner();
  info("Capability probe — reachable in-session vs. headless (cron, eval):\n");
  console.log(`  ${c.dim("capability".padEnd(12))} ${c.dim("headless".padEnd(12))} in-session`);
  for (const r of rows) {
    const mark = r.status === "ok" ? c.green("✓") : r.status === "session-only" ? c.yellow("?") : c.red("✗");
    const head = r.headless ? c.green(r.headless.padEnd(12)) : c.yellow("—".padEnd(12));
    console.log(`  ${mark} ${r.capability.padEnd(12)} ${head} ${c.dim(r.session ?? "none")}`);
  }

  const missing = rows.filter((r) => r.status === "missing");
  const sessionOnly = rows.filter((r) => r.status === "session-only");

  console.log("");
  for (const m of missing) warn(`${m.capability}: ${m.degrade}`);
  if (sessionOnly.length) {
    info(
      `${sessionOnly.length} of ${rows.length} capabilities have NO headless path — they depend on claude.ai ` +
        `connectors: ${sessionOnly.map((r) => r.capability).join(", ")}. Cron runs (\`harness checkin\`) and ` +
        `\`harness eval\` degrade without them, so skills must report the degradation rather than omit it ` +
        `silently. Chains and messages: definitions/mcp-fallbacks.json.`,
    );
  }
  if (!missing.length && !sessionOnly.length) ok("Every capability has a headless path.");

  // Schedule health: are the launchd jobs installed, did they run, could they read the vault?
  console.log("");
  info("Schedule (launchd):");
  const sched = scheduleReport();
  for (const l of sched.lines) console.log(`  ${l}`);
  for (const w of sched.warnings) warn(w);
  if (!sched.warnings.length) ok("Every scheduled job is installed and ran on time.");

  // Injected memory budget.
  const mem = loadMemory("global");
  const over = mem ? memoryOverBudget(mem) : null;
  if (over) warn(`Injected memory is ${over}; runs get a truncated head. Prune ${memoryDir()} or run \`harness memory audit\`.`);

  return missing.length ? 1 : 0;
}
