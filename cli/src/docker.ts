// `harness docker build|login|run` — the sandboxed runner for jobs that touch the vault.
//
// The host launchd job only needs the `docker` CLI; Docker Desktop's file sharing
// bind-mounts the vault, so no process on the host needs Full Disk Access. Inside the
// container the harness sees: /harness (repo, read-only), /vault (the vault),
// /root/.claude/sosafe-harness (state dir: audit log, last-run.json, compress cache),
// and /root/.claude (a named volume with the container's own Claude login).

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { configDir, getHarnessRepo, readConfig } from "./paths.js";
import { c, fail, info, ok, warn } from "./ui.js";

export const IMAGE = "sosafe-harness-runner";
export const VOLUME = "sosafe-harness-claude";
export const ENV_FILE = (): string => join(configDir(), "docker.env");

export function dockerBin(): string {
  const which = spawnSync("which", ["docker"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  for (const p of ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"]) if (existsSync(p)) return p;
  return "docker";
}

export function dockerAvailable(): boolean {
  return spawnSync(dockerBin(), ["info"], { stdio: "ignore", timeout: 15_000 }).status === 0;
}

export function imageBuilt(): boolean {
  return spawnSync(dockerBin(), ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;
}

export function volumeExists(): boolean {
  return spawnSync(dockerBin(), ["volume", "inspect", VOLUME], { stdio: "ignore" }).status === 0;
}

/** The `docker run` argv for a job: mounts, env, image. No shell involved. */
export function runArgs(harnessRepo: string, vault: string, job: string | undefined, args: string[], interactive = false): string[] {
  const out = [dockerBin(), "run", "--rm"];
  if (interactive) out.push("-it");
  out.push(
    "-v", `${VOLUME}:/root/.claude`,
    "-v", `${configDir()}:/root/.claude/sosafe-harness`,
    "-v", `${harnessRepo}:/harness:ro`,
    "-v", `${vault}:/vault`,
  );
  if (job) out.push("-e", `HARNESS_JOB=${job}`);
  if (existsSync(ENV_FILE())) out.push("--env-file", ENV_FILE());
  out.push(IMAGE, ...args);
  return out;
}

export function docker(argv: string[]): number {
  const sub = argv[0];
  const harnessRepo = getHarnessRepo();
  const vault = readConfig()?.vaultPath;
  if (!dockerAvailable()) {
    fail("Docker is not reachable (`docker info` failed). Start Docker Desktop and retry.");
    return 1;
  }
  switch (sub) {
    case "build": {
      info(`Building ${IMAGE} from docker/Dockerfile…`);
      const r = spawnSync(dockerBin(), ["build", "-t", IMAGE, join(harnessRepo, "docker")], { stdio: "inherit" });
      if (r.status !== 0) return 1;
      ok(`${IMAGE} built. Next: \`harness docker login\` once, then \`harness docker run compress\`.`);
      return 0;
    }
    case "login": {
      if (!vault) { fail("No vault configured (config.json → vaultPath)."); return 1; }
      if (existsSync(ENV_FILE()) && /ANTHROPIC_API_KEY=/.test(readFileSync(ENV_FILE(), "utf8"))) {
        info(`${ENV_FILE()} sets ANTHROPIC_API_KEY — the container uses it; no OAuth login needed.`);
      }
      info("Opening Claude Code inside the container. Type /login, finish the browser flow, then /exit. The login persists in the named volume.");
      const args = runArgs(harnessRepo, vault, undefined, [], true);
      // Override the entrypoint: we want the interactive `claude`, not the harness CLI.
      args.splice(args.indexOf(IMAGE), 0, "--entrypoint", "claude");
      const r = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
      return r.status ?? 1;
    }
    case "run": {
      if (!vault) { fail("No vault configured (config.json → vaultPath)."); return 1; }
      if (!imageBuilt()) { fail(`Image ${IMAGE} not built — run \`harness docker build\`.`); return 1; }
      const rest = argv.slice(1);
      const job = rest[0] && !rest[0].startsWith("-") ? rest[0] : undefined;
      const args = runArgs(harnessRepo, vault, job, rest);
      info(c.dim(args.join(" ")));
      const r = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
      return r.status ?? 1;
    }
    case "status": {
      console.log(`docker: ${dockerAvailable() ? "ok" : "missing"}  image: ${imageBuilt() ? "built" : "not built"}  login volume: ${volumeExists() ? "present" : "absent"}  env file: ${existsSync(ENV_FILE()) ? "present" : "none"}`);
      return 0;
    }
    default:
      warn("Usage: harness docker build | login | run <harness args…> | status");
      return 1;
  }
}
