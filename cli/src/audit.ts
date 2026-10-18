// Append-only audit trail for retention actions (~/.claude/sosafe-harness/compress.jsonl).
// One line per phase, dry runs included, so a scheduled job that moved nothing still
// leaves a trace saying why.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { configDir, ensureDir, compressLogPath } from "./paths.js";

export interface AuditEntry {
  ts: string;
  run_id: string;
  job: "compress" | "archive" | "links";
  phase: "plan" | "summarize" | "write" | "move" | "index" | "knowledge" | "done";
  folder?: string;
  strategy?: string;
  inputs?: string[];
  outputs?: string[];
  moves?: Array<{ from: string; to: string }>;
  children_hash?: string;
  model?: string;
  cost_usd?: number;
  duration_ms?: number;
  dry_run: boolean;
  skipped_reason?: string;
  error?: string;
  summary?: string;
}

export function audit(entry: Omit<AuditEntry, "ts">): void {
  try {
    ensureDir(configDir());
    appendFileSync(compressLogPath(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    /* telemetry never breaks a run */
  }
}

export function readAudit(): AuditEntry[] {
  const p = compressLogPath();
  if (!existsSync(p)) return [];
  const out: AuditEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch {
      /* tolerate */
    }
  }
  return out;
}
