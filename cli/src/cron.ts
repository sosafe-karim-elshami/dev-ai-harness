// `harness install-cron` — schedule autonomous, read-only digest runs.
//
// No daemon: we just write crontab lines that call this very CLI. Each run is
// draft-only (HARNESS_AUTONOMOUS via the run path) and writes its output to
// ~/.claude/sosafe-harness/digests/. By default we PRINT the block; --apply
// installs it into the user crontab (idempotent, fenced by marker comments).

import { spawnSync } from "node:child_process";
import { info, ok, warn, c } from "./ui.js";

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
  ];
}

function buildBlock(bin: string): string {
  return [MARKER_BEGIN, ...jobs(bin), MARKER_END].join("\n") + "\n";
}

function resolveBin(): string {
  // Prefer an absolute path so cron (minimal PATH) can find it.
  const which = spawnSync("which", ["harness"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : "harness";
}

export function installCron(apply: boolean): number {
  const bin = resolveBin();
  const block = buildBlock(bin);

  if (!apply) {
    info("Proposed crontab entries (run with --apply to install):\n");
    process.stdout.write(block + "\n");
    info(`Digests will be written to ${c.dim("~/.claude/sosafe-harness/digests/")}`);
    return 0;
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
