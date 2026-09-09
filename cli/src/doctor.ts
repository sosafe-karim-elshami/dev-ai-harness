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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getHarnessRepo } from "./paths.js";
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

export function doctor(argv: string[]): number {
  const harnessRepo = getHarnessRepo();
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

  return missing.length ? 1 : 0;
}
