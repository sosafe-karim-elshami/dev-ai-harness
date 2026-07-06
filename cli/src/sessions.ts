// Per-context session registry.
//
// The persistence mechanism in one place: each "context" (standup, triage, a
// support channel, …) owns a stable Claude Code session UUID. The first run
// creates it (`claude --session-id <uuid>`); every later run resumes it
// (`claude --resume <uuid>`), so the conversation — and its memory — continues
// across separate CLI invocations.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDir, configDir, sessionsPath } from "./paths.js";

export interface SessionRecord {
  sessionId: string;
  createdAt: string;
  lastRunAt: string | null;
  runs: number;
  lastCommand: string | null;
}

export type SessionMap = Record<string, SessionRecord>;

export function readSessions(): SessionMap {
  const p = sessionsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionMap;
  } catch {
    return {};
  }
}

export function writeSessions(map: SessionMap): void {
  ensureDir(configDir());
  writeFileSync(sessionsPath(), JSON.stringify(map, null, 2) + "\n", "utf8");
}

/**
 * Return the session for a context, creating (but not persisting) a fresh UUID
 * if it does not yet exist. `isNew` tells the caller whether to use
 * `--session-id` (first run) or `--resume` (continuation).
 */
export function getOrCreate(context: string): { record: SessionRecord; isNew: boolean } {
  const map = readSessions();
  const existing = map[context];
  if (existing) return { record: existing, isNew: existing.runs === 0 };
  return {
    record: {
      sessionId: randomUUID(),
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      runs: 0,
      lastCommand: null,
    },
    isNew: true,
  };
}

/** Persist a record after a run, bumping counters. */
export function recordRun(context: string, record: SessionRecord, command: string): void {
  const map = readSessions();
  map[context] = {
    ...record,
    lastRunAt: new Date().toISOString(),
    runs: record.runs + 1,
    lastCommand: command,
  };
  writeSessions(map);
}

export function resetContext(context: string): boolean {
  const map = readSessions();
  if (!(context in map)) return false;
  delete map[context];
  writeSessions(map);
  return true;
}
