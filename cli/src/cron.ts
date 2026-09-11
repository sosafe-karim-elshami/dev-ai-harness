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

/** Escape a literal for safe use inside a RegExp. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Job {
  schedule: string;
  args: string;
  comment: string;
  /**
   * True when the job needs nothing beyond the filesystem, git, and gh — i.e. it
   * actually succeeds under cron. False when it drives the model against
   * claude.ai connectors that are session-only (see definitions/mcp-fallbacks.json),
   * which currently means a degraded digest. `harness doctor` reports the split.
   */
  headless: boolean;
}

/** The scheduled jobs. Times are local. */
function jobs(): Job[] {
  return [
    // Monday 07:50, ahead of the 08:30 sync and the 09:00 standup, so the week starts
    // with a scannable `## Recent`. Moves files only — never deletes.
    { schedule: "50 7 * * 1", args: "archive --apply", comment: "weekly (Mon) retire dated notes past the cutoff", headless: true },
    { schedule: "30 8 * * 1-5", args: "sync", comment: "refresh harness + plugins + self-build", headless: true },
    { schedule: "0 16 * * 5", args: "self-improve --digest", comment: "weekly (Fri) self-improve reflection", headless: true },
    { schedule: "0 9 * * 1-5", args: "standup --digest", comment: "weekday standup digest", headless: false },
    { schedule: "10 9 * * 1-5", args: "dashboard --digest", comment: "weekday dev dashboard digest", headless: false },
    { schedule: "15 9 * * 1-5", args: "triage --digest", comment: "weekday support sweep", headless: false },
    // harness-checkin's description promises a 2-hourly weekday run. Without this
    // line that promise was never kept — the skill had no schedule and no CLI
    // subcommand, so it only ever ran when invoked by hand.
    { schedule: "0 8-18/2 * * 1-5", args: "checkin --digest", comment: "2-hourly weekday check-in (draft-only)", headless: false },
  ];
}

function buildBlock(bin: string, headlessOnly: boolean): string {
  const selected = jobs().filter((j) => !headlessOnly || j.headless);
  const width = Math.max(...selected.map((j) => j.args.length));
  const lines = selected.map((j) => `${j.schedule} ${bin} ${j.args.padEnd(width)} # ${j.comment}`);
  return [MARKER_BEGIN, ...lines, MARKER_END].join("\n") + "\n";
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

export function installCron(apply: boolean, headlessOnly = false): number {
  const bin = resolveBin();
  const block = buildBlock(bin, headlessOnly);
  const omitted = headlessOnly ? jobs().filter((j) => !j.headless) : [];

  if (!apply) {
    info("Proposed crontab entries (run with --apply to install):\n");
    process.stdout.write(block + "\n");
    info(`Digests will be written to ${c.dim("~/.claude/sosafe-harness/digests/")}`);
    if (omitted.length) {
      info(`Omitted ${omitted.length} connector-dependent job(s): ${omitted.map((j) => j.args.split(" ")[0]).join(", ")}.`);
    }
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
  // Strip any previously-managed block. The markers must be regex-escaped: they
  // contain `(managed)`, which an unescaped interpolation parses as a capture group,
  // so the pattern silently never matched and every --apply appended a duplicate
  // block instead of replacing it.
  const re = new RegExp(`${escapeRe(MARKER_BEGIN)}[\\s\\S]*?${escapeRe(MARKER_END)}\\n?`, "g");
  existing = existing.replace(re, "").replace(/\n{3,}/g, "\n\n");
  const next = (existing.trim() ? existing.trim() + "\n\n" : "") + block;

  const write = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
  if (write.status === 0) {
    ok("Installed managed crontab entries.");
    process.stdout.write(block + "\n");
    if (omitted.length) {
      info(
        `Omitted ${omitted.length} job(s) that need session-only connectors: ` +
          `${omitted.map((j) => j.args.split(" ")[0]).join(", ")}. ` +
          `Re-run without --headless-only once \`harness doctor\` shows those capabilities reachable.`,
      );
    }
    return 0;
  }
  warn("Could not write crontab (see error). On macOS, grant `cron` Full Disk Access if needed.");
  if (write.stderr) process.stderr.write(write.stderr + "\n");
  return 1;
}
