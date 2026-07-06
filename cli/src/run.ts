// Orchestrates a single context turn: resolve session → run claude → render →
// persist. Shared by `harness run`, the command sugar, and scheduled runs.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, memoryDir, digestsDir, ensureDir } from "./paths.js";
import { getOrCreate, recordRun } from "./sessions.js";
import { runClaude, type RunResult } from "./claude.js";
import { loadMemory } from "./memory.js";
import { header, footer, fail, ok } from "./ui.js";

export interface ExecuteOptions {
  context: string;
  prompt: string;
  /** Draft-only (default true for non-interactive CLI runs). */
  autonomous?: boolean;
  quiet?: boolean;
  /** Write the result to ~/.claude/sosafe-harness/digests/ (for scheduled runs). */
  digest?: boolean;
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
