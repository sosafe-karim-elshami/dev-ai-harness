// `harness ship <KEY>` — run /ship headless against a repo, autonomously.
//
// Autonomous means: contract from the ticket, implement, verify, review, and then
// STOP at features/<KEY>/pr.md. Nothing is pushed and no PR is opened — the guard
// hook denies outward actions under HARNESS_AUTONOMOUS=1 and the skill knows it.
// Jira is a claude.ai connector, so a headless run can only work from a ticket
// the caller pastes (--task) or from a repo whose features/<KEY>/contract.md
// already exists; otherwise the skill stops at orient and says so.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getHarnessRepo } from "./paths.js";
import { runClaude } from "./claude.js";
import { appendRun } from "./observability.js";
import { tierToModel } from "./registry.js";
import { banner, c, fail, info, ok, warn } from "./ui.js";

export async function ship(argv: string[]): Promise<number> {
  const key = argv.find((a) => /^[A-Z][A-Z0-9]+-\d+$/.test(a));
  if (!key) {
    fail("Usage: harness ship <KEY> [--repo <path>] [--until verify] [--max-budget-usd N] [--max-turns N]");
    return 1;
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : argv.find((a) => a.startsWith(`${name}=`))?.split("=")[1];
  };
  const harnessRepo = getHarnessRepo();
  const repoArg = flag("--repo");
  const repo = repoArg ? resolve(repoArg) : process.cwd();
  if (!existsSync(resolve(repo, ".git"))) {
    fail(`${repo} is not a git repository. Pass --repo <path>.`);
    return 1;
  }
  const until = flag("--until");
  const maxBudgetUsd = Number(flag("--max-budget-usd") ?? 15);
  const maxTurns = Number(flag("--max-turns") ?? 150);

  banner();
  info(`/ship ${key} in ${c.bold(repo)} — autonomous (${until ? `until ${until}` : "to pr.md"}), cap $${maxBudgetUsd}, ${maxTurns} turns.`);
  const prompt = `/ship ${key} --autonomous${until ? ` --until ${until}` : ""}`;
  const result = await runClaude({
    prompt,
    harnessRepo,
    cwd: repo,
    sessionId: randomUUID(),
    isNew: true,
    autonomous: true,
    model: tierToModel("opus"),
    maxBudgetUsd,
    maxTurns,
    addDirs: [harnessRepo],
    extraEnv: { HARNESS_SHIP_KEY: key },
  });
  appendRun({ event: "cli_run", skill: "harness-ship", ticket: key, success: !result.isError, cost_usd: result.costUsd ?? undefined, duration_ms: result.durationMs ?? undefined, turns: result.turns });
  const last = result.text.trim().split("\n").pop() ?? "";
  if (/SHIP_COMPLETE/.test(last)) ok(`${key}: ${last}`);
  else if (/SHIP_BLOCKED/.test(result.text)) warn(`${key}: ${result.text.split("\n").find((l) => l.includes("SHIP_BLOCKED")) ?? "blocked"}`);
  else warn(`${key}: run ended without a SHIP_ sentinel (${result.turns} turns, $${(result.costUsd ?? 0).toFixed(2)}).`);
  return result.isError ? 1 : 0;
}
