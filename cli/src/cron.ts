// `harness install-cron` — schedule autonomous, read-only digest runs.
//
// No daemon: we just write crontab lines that call this very CLI. Each run is
// draft-only (HARNESS_AUTONOMOUS via the run path) and writes its output to
// ~/.claude/sosafe-harness/digests/. By default we PRINT the block; --apply
// installs it into the user crontab (idempotent, fenced by marker comments).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo } from "./paths.js";
import { info, ok, warn, fail, c } from "./ui.js";

const MARKER_BEGIN = "# >>> dev-ai-harness (managed) >>>";
const MARKER_END = "# <<< dev-ai-harness (managed) <<<";

/** The scheduled jobs. Times are local. Each writes a digest. */
function jobs(bin: string): string[] {
  return [
    `30 8 * * 1-5 ${bin} sync                 # refresh harness + plugins + self-build`,
    `0 9 * * 1-5 ${bin} standup --digest     # weekday standup digest`,
    `10 9 * * 1-5 ${bin} dashboard --digest  # weekday dev dashboard digest`,
    `15 9 * * 1-5 ${bin} triage --digest      # weekday support sweep`,
    `0 16 * * 5 ${bin} self-improve --digest # weekly (Fri) self-improve reflection`,
    // harness-checkin's own description promises a 2-hourly weekday run. Without
    // this line that promise was never kept — the skill had no schedule and no CLI
    // subcommand, so it only ever ran when invoked by hand.
    `0 8-18/2 * * 1-5 ${bin} checkin --digest # 2-hourly weekday check-in (draft-only)`,
    // Monday 07:50, before the 08:30 sync and the 09:00 standup, so the week starts
    // with a scannable `## Recent`. Moves files only — never deletes.
    `50 7 * * 1 ${bin} archive --apply       # weekly (Mon) retire dated notes past the cutoff`,
  ];
}

function buildBlock(bin: string): string {
  return [MARKER_BEGIN, ...jobs(bin), MARKER_END].join("\n") + "\n";
}

function resolveBin(): string {
  // cron runs with a minimal PATH, so a bare `harness` is very likely to fail at
  // 07:50 with nobody watching. Prefer the resolved absolute path; if the CLI isn't
  // linked onto PATH at all, fall back to invoking the built entry point directly by
  // absolute path — which always exists, because it's what's running right now.
  const which = spawnSync("which", ["harness"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();

  try {
    const entry = join(getHarnessRepo(), "cli", "dist", "index.js");
    if (existsSync(entry)) {
      const node = spawnSync("which", ["node"], { encoding: "utf8" });
      const nodeBin = node.status === 0 && node.stdout.trim() ? node.stdout.trim() : process.execPath;
      return `${nodeBin} ${entry}`;
    }
  } catch {
    /* fall through to the bare name */
  }
  return "harness";
}

/** True when we had to fall back to a bare name cron probably can't resolve. */
function binIsRisky(bin: string): boolean {
  return bin === "harness";
}

export function installCron(apply: boolean): number {
  const bin = resolveBin();
  const block = buildBlock(bin);

  if (!apply) {
    info("Proposed crontab entries (run with --apply to install):\n");
    process.stdout.write(block + "\n");
    info(`Digests will be written to ${c.dim("~/.claude/sosafe-harness/digests/")}`);
    if (binIsRisky(bin)) {
      warn(
        "Could not resolve an absolute path for the CLI, so these lines call a bare `harness`. " +
          "cron's PATH usually can't find it — link the CLI (`npm link` in cli/) before installing.",
      );
    }
    return 0;
  }

  if (binIsRisky(bin)) {
    fail(
      "Refusing to install: the CLI isn't resolvable by absolute path, so every job would " +
        "silently fail under cron's minimal PATH. Run `npm link` in cli/ first, then re-run.",
    );
    return 1;
  }

  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  let existing = current.status === 0 ? current.stdout : "";
  // Strip any previously-managed block.
  const re = new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`, "g");
  existing = existing.replace(re, "").replace(/\n{3,}/g, "\n\n");
  const next = (existing.trim() ? existing.trim() + "\n\n" : "") + block;

  const write = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
  if (write.status === 0) {
    ok("Installed managed crontab entries.");
    process.stdout.write(block + "\n");
    return 0;
  }
  warn("Could not write crontab (see error). On macOS, grant `cron` Full Disk Access if needed.");
  if (write.stderr) process.stderr.write(write.stderr + "\n");
  return 1;
}
