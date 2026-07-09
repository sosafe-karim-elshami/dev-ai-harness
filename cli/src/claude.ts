// Runs the `claude` binary in print/stream-json mode against the harness repo
// and renders a branded, readable transcript.
//
// Spawning with cwd = harness repo is what makes CLAUDE.md routing, the
// .claude/ skills, marketplace plugins, and the PreToolUse guard hook all apply
// — we never reimplement them here.

import { spawn } from "node:child_process";
import { c } from "./ui.js";

export interface RunOptions {
  prompt: string;
  harnessRepo: string;
  sessionId: string;
  /** First run for this context → use --session-id; otherwise --resume. */
  isNew: boolean;
  /** Inject these as additional system prompt (memory). */
  appendSystemPrompt?: string;
  /** Extra dirs to grant tool access to (e.g. the memory dir). */
  addDirs?: string[];
  /** Draft-only: sets HARNESS_AUTONOMOUS=1 so the guard hook denies mutations. */
  autonomous?: boolean;
  /** Suppress live rendering (used when capturing for digests/graph). */
  quiet?: boolean;
}

export interface RunResult {
  sessionId: string;
  text: string;
  costUsd: number | null;
  durationMs: number | null;
  isError: boolean;
  /**
   * Signatures of the tools the run invoked, in order. `Skill` calls are
   * recorded as `Skill:<name>` and `Bash` as `Bash:<command>` so the evaluator
   * can score routing (which skill ran) and read-only compliance (did anything
   * mutating get attempted). Best-effort: only populated from stream-json events.
   */
  toolsUsed: string[];
}

/** A compact, greppable signature for a tool_use block (for the evaluator). */
function signatureFor(block: any): string {
  const name: string = block?.name ?? "unknown";
  if (name === "Skill") return `Skill:${block?.input?.skill ?? "?"}`;
  if (name === "Bash") return `Bash:${String(block?.input?.command ?? "").slice(0, 120)}`;
  if (name === "Task") return `Task:${block?.input?.subagent_type ?? "?"}`;
  return name;
}

export function runClaude(opts: RunOptions): Promise<RunResult> {
  const args: string[] = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (opts.isNew) args.push("--session-id", opts.sessionId);
  else args.push("--resume", opts.sessionId);

  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);

  const env = { ...process.env };
  if (opts.autonomous) env.HARNESS_AUTONOMOUS = "1";

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.harnessRepo,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    let finalText = "";
    let costUsd: number | null = null;
    let durationMs: number | null = null;
    let resolvedSession = opts.sessionId;
    let isError = false;
    let stderr = "";
    const toolsUsed: string[] = [];

    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt: any;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        handleEvent(evt);
      }
    });

    function handleEvent(evt: any): void {
      if (evt.session_id) resolvedSession = evt.session_id;
      switch (evt.type) {
        case "assistant": {
          for (const block of evt.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              if (!opts.quiet) process.stdout.write(block.text);
              finalText += block.text;
            } else if (block.type === "tool_use") {
              toolsUsed.push(signatureFor(block));
              if (!opts.quiet) process.stdout.write(c.dim(`\n  · ${block.name}\n`));
            }
          }
          break;
        }
        case "result": {
          costUsd = typeof evt.total_cost_usd === "number" ? evt.total_cost_usd : null;
          durationMs = typeof evt.duration_ms === "number" ? evt.duration_ms : null;
          isError = evt.subtype !== "success" || evt.is_error === true;
          if (typeof evt.result === "string" && !finalText) finalText = evt.result;
          break;
        }
      }
    }

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("`claude` not found on PATH. Install Claude Code first."));
      } else reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0 && !finalText) {
        reject(new Error(`claude exited with code ${code}.\n${stderr.trim()}`));
        return;
      }
      resolve({
        sessionId: resolvedSession,
        text: finalText.trim(),
        costUsd,
        durationMs,
        isError,
        toolsUsed,
      });
    });
  });
}
