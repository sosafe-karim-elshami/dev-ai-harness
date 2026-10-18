// Runs the `claude` binary in print mode and renders a branded, readable transcript.
//
// Spawning with cwd = harness repo is what makes CLAUDE.md routing, the
// .claude/ skills, marketplace plugins, and the PreToolUse guard hook all apply
// — we never reimplement them here. Every unattended run carries an explicit
// model, a turn cap, and a dollar cap: tiers are only real if the flag is passed.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
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
  /** Working directory override (default: harnessRepo). */
  cwd?: string;
  /** `--model`; a registry tier resolved via tierToModel(), or a full model id. */
  model?: string;
  /** `--max-turns`; hitting it is a signal to look into, never hidden. */
  maxTurns?: number;
  /** `--max-budget-usd`; every scheduled run must carry one. */
  maxBudgetUsd?: number;
  /** Extra environment for the child (e.g. HARNESS_JOB). */
  extraEnv?: Record<string, string>;
  /**
   * Minimal session for tool-less structured calls: `--setting-sources ""` (no user /
   * project settings, hooks, or plugins) plus `--disable-slash-commands`. Not `--bare`:
   * bare never reads the keychain, so an OAuth-authenticated install gets "Not logged in".
   */
  minimal?: boolean;
  /** `--tools`; an empty array disables every built-in tool. */
  tools?: string[];
  /** `--json-schema`; the result's `structured_output` is parsed by runClaudeStructured. */
  jsonSchema?: object | string;
  /** Piped to the child's stdin — Claude Code appends it to the prompt. */
  stdinBody?: string;
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
  /** Parsed `structured_output` when a --json-schema was given. */
  structured?: unknown;
  /** Number of assistant turns observed. */
  turns: number;
}

/** A compact, greppable signature for a tool_use block (for the evaluator). */
function signatureFor(block: any): string {
  const name: string = block?.name ?? "unknown";
  if (name === "Skill") return `Skill:${block?.input?.skill ?? "?"}`;
  if (name === "Bash") return `Bash:${String(block?.input?.command ?? "").slice(0, 120)}`;
  if (name === "Task") return `Task:${block?.input?.subagent_type ?? "?"}`;
  return name;
}

export function buildArgs(opts: RunOptions): string[] {
  const args: string[] = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];

  if (opts.minimal) args.push("--setting-sources", "", "--disable-slash-commands");
  else if (opts.isNew) args.push("--session-id", opts.sessionId);
  else args.push("--resume", opts.sessionId);

  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);
  if (opts.model) args.push("--model", opts.model);
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  if (opts.maxBudgetUsd) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  if (opts.tools) args.push("--tools", opts.tools.length ? opts.tools.join(",") : "");
  if (opts.jsonSchema) {
    args.push("--json-schema", typeof opts.jsonSchema === "string" ? opts.jsonSchema : JSON.stringify(opts.jsonSchema));
  }
  return args;
}

export function runClaude(opts: RunOptions): Promise<RunResult> {
  const args = buildArgs(opts);

  const env = { ...process.env, ...(opts.extraEnv ?? {}) };
  if (opts.autonomous) env.HARNESS_AUTONOMOUS = "1";

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd ?? opts.harnessRepo,
      env,
      stdio: [opts.stdinBody !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    if (opts.stdinBody !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(opts.stdinBody);
    }

    let buf = "";
    let finalText = "";
    let costUsd: number | null = null;
    let durationMs: number | null = null;
    let resolvedSession = opts.sessionId;
    let isError = false;
    let stderr = "";
    let structured: unknown;
    let turns = 0;
    const toolsUsed: string[] = [];

    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.stdout?.on("data", (chunk) => {
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
          turns++;
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
          if (evt.structured_output !== undefined) structured = evt.structured_output;
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
      if (code !== 0 && !finalText && structured === undefined) {
        reject(new Error(`claude exited with code ${code}.\n${stderr.trim()}`));
        return;
      }
      resolve({ sessionId: resolvedSession, text: finalText.trim(), costUsd, durationMs, isError, toolsUsed, structured, turns });
    });
  });
}

export interface StructuredOptions {
  /** Short instruction; the heavy input goes on stdin. */
  prompt: string;
  /** Registry tier or full model id. */
  model: string;
  /** JSON Schema the result must satisfy. */
  schema: object;
  /** Rules for this call, sent as --append-system-prompt. */
  systemPrompt: string;
  /** The material to process (note bodies, tables). Never passed as argv — ARG_MAX. */
  stdinBody: string;
  maxBudgetUsd: number;
  maxTurns?: number;
}

export interface StructuredResult<T> {
  data: T;
  costUsd: number | null;
  durationMs: number | null;
  model: string;
}

export type StructuredRunner = <T>(o: StructuredOptions) => Promise<StructuredResult<T>>;

/**
 * A tool-less, minimal, single-turn structured call: the model reads stdin and returns
 * JSON matching the schema. It never touches disk — the caller writes every file.
 * cwd is the OS temp dir and setting sources are empty, so no CLAUDE.md, hook, or
 * plugin loads; the call costs the schema, the rules, and the input — nothing else.
 */
export async function runClaudeStructured<T>(o: StructuredOptions): Promise<StructuredResult<T>> {
  const r = await runClaude({
    prompt: o.prompt,
    harnessRepo: tmpdir(),
    cwd: tmpdir(),
    sessionId: "",
    isNew: true,
    minimal: true,
    tools: [],
    model: o.model,
    maxTurns: o.maxTurns ?? 1,
    maxBudgetUsd: o.maxBudgetUsd,
    appendSystemPrompt: o.systemPrompt,
    jsonSchema: o.schema,
    stdinBody: o.stdinBody,
    quiet: true,
  });
  let data: unknown = r.structured;
  if (data === undefined) {
    // Older CLIs put the JSON in `result`; tolerate a fenced block too.
    const m = /\{[\s\S]*\}/.exec(r.text);
    if (!m) throw new Error(`structured call returned no JSON (model ${o.model}).`);
    data = JSON.parse(m[0]);
  }
  if (r.isError) throw new Error(`structured call reported an error (model ${o.model}).`);
  return { data: data as T, costUsd: r.costUsd, durationMs: r.durationMs, model: o.model };
}
