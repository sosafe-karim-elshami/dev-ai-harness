// `harness graph build --system` — the derived system map.
//
// The profile records what the user SAID they maintain: a repo list with a
// hand-picked `role` and a language, captured once during onboarding. That goes
// stale the moment ownership moves, and it can't answer "what would this change
// break?" at all.
//
// This derives the answer instead, from GitHub via `gh` (the one capability with a
// real headless path — see definitions/mcp-fallbacks.json): CODEOWNERS for declared
// ownership, commit authorship for actual ownership, and manifest names for the
// dependency graph between the user's own repos. Output is
// ~/.claude/sosafe-harness/system.json, refreshed on `harness sync`.
//
// Strictly read-only: every call is a `gh api` GET.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, profilePath, ensureDir } from "./paths.js";
import { c, info, ok, warn } from "./ui.js";

export const systemPath = (): string => join(configDir(), "system.json");

/** Declared ownership from CODEOWNERS, versus ownership evidenced by commits. */
export type Ownership = "codeowner" | "primary-author" | "contributor" | "observer";

export interface RepoFacts {
  full_name: string;
  default_branch: string | null;
  archived: boolean;
  primary_language: string | null;
  last_push: string | null;
  open_prs: number | null;
  /** Raw CODEOWNERS owners (teams and users), deduped. */
  codeowners: string[];
  /** Top commit authors in the window, most commits first. */
  top_authors: { login: string; commits: number }[];
  my_commits: number;
  ownership: Ownership;
  /** Package/module name this repo publishes, used to resolve dependency edges. */
  manifest_name: string | null;
  depends_on: string[];
}

export interface SystemMap {
  schema_version: 1;
  generated_at: string;
  source: string;
  window_days: number;
  repos: RepoFacts[];
  dependencies: { from: string; to: string; via: string }[];
  /** Capabilities that could not be derived here, with the reason. */
  unresolved: string[];
}

function gh(args: string[]): string | null {
  try {
    // stderr is silenced deliberately: a 404 on CODEOWNERS or package.json is the
    // normal case for most repos, not an error worth showing the user.
    return execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function ghJson<T>(path: string): T | null {
  const out = gh(["api", "-H", "Accept: application/vnd.github+json", path]);
  if (!out) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

/** Fetch a file's decoded contents, trying each candidate path in order. */
function fileContents(repo: string, candidates: string[]): string | null {
  for (const p of candidates) {
    const res = ghJson<{ content?: string; encoding?: string }>(`repos/${repo}/contents/${p}`);
    if (res?.content && res.encoding === "base64") {
      return Buffer.from(res.content, "base64").toString("utf8");
    }
  }
  return null;
}

/** Owners named in a CODEOWNERS file, across every rule. */
function parseCodeowners(text: string): string[] {
  const owners = new Set<string>();
  for (const line of text.split("\n")) {
    const stripped = line.replace(/#.*$/, "").trim();
    if (!stripped) continue;
    for (const tok of stripped.split(/\s+/).slice(1)) {
      if (tok.startsWith("@") || tok.includes("@")) owners.add(tok);
    }
  }
  return [...owners];
}

/** The package/module name a repo publishes, for dependency resolution. */
function manifestName(repo: string): { name: string | null; deps: string[] } {
  const pkg = fileContents(repo, ["package.json"]);
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      return {
        name: parsed.name ?? null,
        deps: [
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
          ...Object.keys(parsed.peerDependencies ?? {}),
        ],
      };
    } catch {
      /* fall through */
    }
  }
  // Python: name from pyproject, deps left to the manifest text.
  const py = fileContents(repo, ["pyproject.toml"]);
  if (py) {
    const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(py)?.[1] ?? null;
    const deps = [...py.matchAll(/^\s*["']?([A-Za-z0-9._-]+)["']?\s*[=><~]/gm)].map((m) => m[1]);
    return { name, deps };
  }
  return { name: null, deps: [] };
}

function classify(login: string, codeowners: string[], top: { login: string; commits: number }[], mine: number): Ownership {
  const me = login.toLowerCase();
  if (codeowners.some((o) => o.toLowerCase() === `@${me}`)) return "codeowner";
  if (top.length && top[0].login.toLowerCase() === me) return "primary-author";
  if (mine > 0) return "contributor";
  return "observer";
}

export function buildSystemMap(windowDays = 90): SystemMap {
  if (!existsSync(profilePath())) {
    throw new Error("No profile at ~/.claude/sosafe-harness/profile.json. Run `/setup` first.");
  }
  const profile = JSON.parse(readFileSync(profilePath(), "utf8")) as {
    person?: { github_login?: string };
    repos?: { full_name: string }[];
    team?: { compass_alias?: string };
  };

  const login = profile.person?.github_login ?? "";
  const repoNames = (profile.repos ?? []).map((r) => r.full_name).filter(Boolean);
  const unresolved: string[] = [];

  if (!gh(["auth", "status"])) {
    throw new Error("`gh` is not authenticated. Run `gh auth login`.");
  }
  if (!login) unresolved.push("person.github_login is empty — ownership cannot be attributed to you.");
  if (!repoNames.length) unresolved.push("profile.repos is empty — nothing to derive. Run `/setup --field repos`.");

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const repos: RepoFacts[] = [];
  const noCodeowners: string[] = [];

  for (const full_name of repoNames) {
    info(`  deriving ${full_name}…`);
    const meta = ghJson<{
      default_branch?: string;
      archived?: boolean;
      language?: string | null;
      pushed_at?: string;
    }>(`repos/${full_name}`);
    if (!meta) {
      unresolved.push(`${full_name}: not readable via gh (renamed, private, or no access).`);
      continue;
    }

    const co = fileContents(full_name, ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]);
    const codeowners = co ? parseCodeowners(co) : [];
    if (!co) {
      // Worth surfacing: without CODEOWNERS, ownership below is inferred from commit
      // authorship alone, which is weaker evidence than a declared owner.
      noCodeowners.push(full_name);
    }

    const commits =
      ghJson<{ author?: { login?: string } | null }[]>(
        `repos/${full_name}/commits?per_page=100&since=${since}`,
      ) ?? [];
    const tally = new Map<string, number>();
    for (const cm of commits) {
      const a = cm.author?.login;
      if (a) tally.set(a, (tally.get(a) ?? 0) + 1);
    }
    const top_authors = [...tally.entries()]
      .map(([l, n]) => ({ login: l, commits: n }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 5);
    const my_commits = login ? (tally.get(login) ?? 0) : 0;

    const prs = ghJson<unknown[]>(`repos/${full_name}/pulls?state=open&per_page=100`);
    const { name, deps } = manifestName(full_name);

    repos.push({
      full_name,
      default_branch: meta.default_branch ?? null,
      archived: Boolean(meta.archived),
      primary_language: meta.language ?? null,
      last_push: meta.pushed_at ?? null,
      open_prs: prs ? prs.length : null,
      codeowners,
      top_authors,
      my_commits,
      ownership: classify(login, codeowners, top_authors, my_commits),
      manifest_name: name,
      depends_on: deps, // resolved to repos below
    });
  }

  // Resolve dependency edges: a repo depends on another when it requires the
  // package name that other repo publishes. Only edges INSIDE the user's set are
  // meaningful here — third-party deps aren't part of their system map.
  const byPackage = new Map<string, string>();
  for (const r of repos) if (r.manifest_name) byPackage.set(r.manifest_name, r.full_name);

  const dependencies: { from: string; to: string; via: string }[] = [];
  for (const r of repos) {
    const internal = new Set<string>();
    for (const d of r.depends_on) {
      const target = byPackage.get(d);
      if (target && target !== r.full_name) {
        internal.add(target);
        dependencies.push({ from: r.full_name, to: target, via: d });
      }
    }
    r.depends_on = [...internal];
  }

  if (noCodeowners.length) {
    unresolved.push(
      `No CODEOWNERS in ${noCodeowners.length} of ${repos.length} repos (${noCodeowners.join(", ")}) — ` +
        `ownership there is inferred from commit authorship only, which is weaker evidence than a declared owner.`,
    );
  }

  if (profile.team?.compass_alias) {
    unresolved.push(
      "Compass ownership and security scores are session-only (compass-analyst) — not derivable headless.",
    );
  } else {
    unresolved.push("team.compass_alias is empty — Compass hygiene unavailable. Run `/setup --field team`.");
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "github via gh CLI (read-only GETs)",
    window_days: windowDays,
    repos,
    dependencies,
    unresolved,
  };
}

export function writeSystemMap(map: SystemMap): void {
  ensureDir(configDir());
  writeFileSync(systemPath(), JSON.stringify(map, null, 2) + "\n", "utf8");
}

/** Build, persist, and summarize. */
export function system(argv: string[]): number {
  const windowArg = argv.find((a) => a.startsWith("--days="));
  const windowDays = windowArg ? Number(windowArg.split("=")[1]) : 90;

  info(`Deriving the system map from GitHub (last ${windowDays} days)…`);
  const map = buildSystemMap(windowDays);
  writeSystemMap(map);

  console.log("");
  for (const r of map.repos) {
    const dep = r.depends_on.length ? c.dim(` → ${r.depends_on.join(", ")}`) : "";
    const arch = r.archived ? c.yellow(" [archived]") : "";
    console.log(
      `  ${c.magenta(r.ownership.padEnd(15))} ${r.full_name.padEnd(34)} ` +
        `${c.dim(`${r.my_commits} of ${r.top_authors.reduce((n, a) => n + a.commits, 0)} commits`)}${arch}${dep}`,
    );
  }
  console.log("");
  for (const u of map.unresolved) warn(u);
  ok(`system.json written — ${map.repos.length} repos, ${map.dependencies.length} internal dependency edges.`);
  return 0;
}
