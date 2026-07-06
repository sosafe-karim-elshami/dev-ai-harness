// Filesystem layout for the harness CLI.
//
// Everything per-user lives under ~/.claude/sosafe-harness/ (alongside the
// existing profile.json). The harness *repo* path is recorded in config.json by
// `harness init` so the tool works from ANY directory — the current working
// directory is never used to locate the harness.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface HarnessConfig {
  /** Absolute path to the cloned dev-ai-harness repo. */
  harnessRepo: string;
  /** Default context used by `harness run` when none is named. */
  defaultContext?: string;
}

export const configDir = (): string => join(homedir(), ".claude", "sosafe-harness");
export const configPath = (): string => join(configDir(), "config.json");
export const profilePath = (): string => join(configDir(), "profile.json");
export const sessionsPath = (): string => join(configDir(), "sessions.json");
export const memoryDir = (): string => join(configDir(), "memory");
export const digestsDir = (): string => join(configDir(), "digests");
export const graphPath = (): string => join(configDir(), "graph.json");

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readConfig(): HarnessConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as HarnessConfig;
  } catch {
    return null;
  }
}

export function writeConfig(cfg: HarnessConfig): void {
  ensureDir(configDir());
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** Resolve the harness repo, or throw a helpful error pointing at `harness init`. */
export function getHarnessRepo(): string {
  const cfg = readConfig();
  if (!cfg?.harnessRepo) {
    throw new Error(
      "Harness repo not configured. Run `harness init <path-to-dev-ai-harness>` first.",
    );
  }
  if (!existsSync(join(cfg.harnessRepo, "CLAUDE.md"))) {
    throw new Error(
      `Configured harness repo looks wrong (no CLAUDE.md at ${cfg.harnessRepo}). Re-run \`harness init <path>\`.`,
    );
  }
  return cfg.harnessRepo;
}
