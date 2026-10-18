// Orchestrates a single context turn: resolve session → run claude → render →
// persist. Shared by `harness run`, the command sugar, and scheduled runs.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, memoryDir, digestsDir, ensureDir } from "./paths.js";
import { getOrCreate, recordRun } from "./sessions.js";
import { runClaude, type RunResult } from "./claude.js";
import { loadMemory } from "./memory.js";
import { loadRegistry, tierToModel } from "./registry.js";
import { appendRun } from "./observability.js";
import { header, footer, fail, ok } from "./ui.js";

export interface ExecuteOptions {
  context: string;
  prompt: string;
  /** Draft-only (default true for non-interactive CLI runs). */
  autonomous?: boolean;
  quiet?: boolean;
  /** Write the result to ~/.claude/sosafe-harness/digests/ (for scheduled runs). */
  digest?: boolean;
  /** Registry tier or model id; default: the tier the registry declares for this context. */
  model?: string;
  /** Dollar cap for the run; scheduled runs always set one. */
  maxBudgetUsd?: number;
  maxTurns?: number;
}

/**
 * The tier a context should run at: the skill or composite whose entry is
 * `/<context>` (standup, groom, self-improve, …). Unknown contexts get no
 * override and use the session default.
 */
export function tierForContext(context: string, harnessRepo: string): string | undefined {
  try {
    const reg = loadRegistry(harnessRepo);
    const hit =
      reg.skills.find((s) => s.entry.includes(`/${context}`) || s.name === context) ??
      reg.composites.find((k) => k.entry.includes(`/${context}`) || k.name === context);
    return hit ? tierToModel(hit.tier) : undefined;
  } catch {
    return undefined;
  }
}

export async function executeContext(opts: ExecuteOptions): Promise<RunResult> {
  const harnessRepo = getHarnessRepo();
  const { record, isNew } = getOrCreate(opts.context);
  const memory = loadMemory(opts.context);

  if (!opts.quiet) header(opts.context, isNew);

  const result = await runClaude({
    prompt: opts.prompt,
    harnessRepo,
    sessionId: record.sessionId,
    isNew,
    appendSystemPrompt: memory ?? undefined,
    addDirs: existsSync(memoryDir()) ? [memoryDir()] : [],
    autonomous: opts.autonomous ?? true,
    quiet: opts.quiet,
    model: opts.model ? tierToModel(opts.model) : tierForContext(opts.context, harnessRepo),
    maxBudgetUsd: opts.maxBudgetUsd,
    maxTurns: opts.maxTurns,
  });

  appendRun({
    event: "cli_run",
    skill: opts.context,
    success: !result.isError,
    cost_usd: result.costUsd ?? undefined,
    duration_ms: result.durationMs ?? undefined,
    turns: result.turns,
  });

  // Persist using the session id claude actually used (it echoes ours back).
  recordRun(opts.context, { ...record, sessionId: result.sessionId }, opts.prompt);

  if (!opts.quiet) footer(result.costUsd, result.durationMs);
  if (result.isError) fail("Run reported an error (see output above).");

  if (opts.digest && result.text) {
    ensureDir(digestsDir());
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = join(digestsDir(), `${opts.context}-${stamp}.md`);
    writeFileSync(
      file,
      `# ${opts.context} — ${new Date().toLocaleString()}\n\n${result.text}\n`,
      "utf8",
    );
    if (!opts.quiet) ok(`Digest written to ${file}`);
  }
  return result;
}
