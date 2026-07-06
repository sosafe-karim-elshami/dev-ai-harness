// `harness sync` — keep the shared harness + marketplace current, and self-build.
//   1. git pull the harness repo            (skills, commands, knowledge/)
//   2. rebuild the CLI if its source changed (cli/ npm install + build)
//   3. claude plugin marketplace update     (refresh all marketplace sources)
// Read-only-ish: a fast-forward pull, a local rebuild, and a marketplace refresh.
// No remote state is changed. Safe to run on a schedule.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo } from "./paths.js";
import { info, ok, warn, c } from "./ui.js";

function run(cmd: string, args: string[], cwd?: string): { code: number; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { code: r.status ?? 1, out };
}

/** Rebuild the CLI in place so `harness sync` self-updates its own binary. */
function autoBuild(repo: string): number {
  const cliDir = join(repo, "cli");
  if (!existsSync(join(cliDir, "package.json"))) return 0; // nothing to build

  info(`Rebuilding harness CLI ${c.dim(cliDir)}`);
  const install = run("npm", ["install", "--no-audit", "--no-fund"], cliDir);
  if (install.code !== 0) {
    if (install.out) process.stdout.write("  " + install.out.replace(/\n/g, "\n  ") + "\n");
    warn("npm install for the CLI did not complete cleanly (see above).");
    return 1;
  }
  const build = run("npm", ["run", "build"], cliDir);
  if (build.out) process.stdout.write("  " + build.out.replace(/\n/g, "\n  ") + "\n");
  if (build.code === 0) {
    ok("Harness CLI rebuilt.");
    return 0;
  }
  warn("CLI build did not complete cleanly (see above).");
  return 1;
}

export function sync(): number {
  const repo = getHarnessRepo();

  info(`Pulling harness repo ${c.dim(repo)}`);
  const pull = run("git", ["-C", repo, "pull", "--ff-only"], repo);
  if (pull.out) process.stdout.write("  " + pull.out.replace(/\n/g, "\n  ") + "\n");
  if (pull.code === 0) ok("Harness repo up to date.");
  else warn("git pull did not complete cleanly (see above).");

  const build = autoBuild(repo);

  info("Refreshing marketplace sources");
  const plugins = run("claude", ["plugin", "marketplace", "update"], repo);
  if (plugins.out) process.stdout.write("  " + plugins.out.replace(/\n/g, "\n  ") + "\n");
  if (plugins.code === 0) ok("Marketplaces up to date (restart Claude Code to apply plugin changes).");
  else warn("`claude plugin marketplace update` did not complete cleanly (see above).");

  return pull.code === 0 && build === 0 && plugins.code === 0 ? 0 : 1;
}
