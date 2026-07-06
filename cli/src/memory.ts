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

const fileFor = (context: string): string =>
  join(memoryDir(), context === "global" ? GLOBAL : `${context}.md`);

/** Concatenated global + per-context memory, or null if there is none. */
export function loadMemory(context: string): string | null {
  const parts: string[] = [];
  const globalPath = join(memoryDir(), GLOBAL);
  if (existsSync(globalPath)) parts.push(readFileSync(globalPath, "utf8").trim());
  const ctxPath = fileFor(context);
  if (context !== "global" && existsSync(ctxPath)) parts.push(readFileSync(ctxPath, "utf8").trim());
  const joined = parts.filter(Boolean).join("\n\n");
  if (!joined) return null;
  return `# Persistent harness memory\n\nThe following are durable facts the user asked you to remember. Treat them as background context.\n\n${joined}`;
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
