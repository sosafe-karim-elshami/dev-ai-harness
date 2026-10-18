// Durable, injected memory.
//
// Two layers, both plain Markdown under ~/.claude/sosafe-harness/memory/:
//   global.md        — facts that apply to every context
//   <context>.md     — facts specific to one context (standup, support-#x, …)
// Loaded and concatenated into the system prompt on every run, so durable facts
// survive even when a session is reset. (Session history is the other half;
// see sessions.ts.)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, memoryDir } from "./paths.js";

const GLOBAL = "global.md";
/** Mirror Claude Code's own MEMORY.md rule: an index past this is no longer an index. */
export const MEMORY_MAX_BYTES = 25 * 1024;
export const MEMORY_MAX_LINES = 200;

const fileFor = (context: string): string =>
  join(memoryDir(), context === "global" ? GLOBAL : `${context}.md`);

/** Concatenated global + per-context memory, or null if there is none. */
export function loadMemory(context: string): string | null {
  const parts: string[] = [];
  const globalPath = join(memoryDir(), GLOBAL);
  if (existsSync(globalPath)) parts.push(readFileSync(globalPath, "utf8").trim());
  const ctxPath = fileFor(context);
  if (context !== "global" && existsSync(ctxPath)) parts.push(readFileSync(ctxPath, "utf8").trim());
  let joined = parts.filter(Boolean).join("\n\n");
  if (!joined) return null;
  const over = memoryOverBudget(joined);
  if (over) {
    // Inject only the head and a pointer: the rest is retrievable on demand, and
    // an uncapped injection pays for every stale bullet on every single run.
    const head = joined.split("\n").slice(0, MEMORY_MAX_LINES).join("\n").slice(0, MEMORY_MAX_BYTES);
    joined = `${head}\n\n_(memory truncated: ${over}; run \`harness memory audit\` and prune ${memoryDir()})_`;
  }
  return `# Persistent harness memory\n\nThe following are durable facts the user asked you to remember. Treat them as background context.\n\n${joined}`;
}

/** Why the memory is over budget, or null when it fits. Used by loadMemory and doctor. */
export function memoryOverBudget(text: string): string | null {
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = text.split("\n").length;
  if (bytes > MEMORY_MAX_BYTES) return `${Math.round(bytes / 1024)} KB over the ${MEMORY_MAX_BYTES / 1024} KB cap`;
  if (lines > MEMORY_MAX_LINES) return `${lines} lines over the ${MEMORY_MAX_LINES}-line cap`;
  return null;
}

export function memoryFilePath(context: string): string {
  return fileFor(context);
}

export function showMemory(context: string): string | null {
  const p = fileFor(context);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Append a fact to a context's memory file (used by `harness memory add`). */
export function appendMemory(context: string, fact: string): void {
  ensureDir(memoryDir());
  const p = fileFor(context);
  const prefix = existsSync(p) ? readFileSync(p, "utf8").replace(/\s*$/, "") + "\n" : `# ${context} memory\n`;
  writeFileSync(p, `${prefix}- ${fact.trim()}\n`, "utf8");
}
