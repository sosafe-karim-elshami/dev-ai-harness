// `harness registry` — the routing single source of truth, enforced.
//
// definitions/registry.json declares every skill: what triggers it, which model
// tier it runs at, what it reads/writes, what it delegates to, and which gates
// apply. Three things consume it:
//
//   1. definitions/registry.index.md — a compact routing index — is GENERATED
//      from it (`registry sync`). The router reads the index first and the full
//      entry only for the skill it picks; CLAUDE.md carries no table at all.
//   2. `registry check` fails on drift — a skill on disk with no entry, an entry
//      with no skill, a frontmatter tier that contradicts the registry, or a
//      SKILL.md over the 60-line contract cap. Runs as part of `harness eval`.
//   3. harness-find-skill and harness-router read it instead of scanning the
//      filesystem, which is what lets them run at a cheap tier.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo } from "./paths.js";
import { c, info, ok, warn, fail } from "./ui.js";

export const BEGIN_MARKER = "<!-- BEGIN GENERATED ROUTING (harness registry sync) -->";
export const END_MARKER = "<!-- END GENERATED ROUTING -->";

/**
 * Caps from definitions/output-contract.md — a SKILL.md is a contract, not a script.
 * The line cap measures the instruction BODY only: frontmatter carries the tool allowlist,
 * which is metadata the model doesn't read as instructions. The description cap keeps the
 * skill listing lean — Claude Code truncates description + when_to_use at 1,536 characters,
 * so anything approaching that is silently losing its own trigger phrases.
 */
export const SKILL_LINE_CAP = 60;
export const DESCRIPTION_CHAR_CAP = 1024;
/** CLAUDE.md is loaded into every session: total lines, blank ones included. */
export const CLAUDE_MD_LINE_CAP = 60;
/** Commands and agents: non-empty body lines after the frontmatter. */
export const COMMAND_LINE_CAP = 40;
export const AGENT_LINE_CAP = 40;
export const INDEX_FILE = join("definitions", "registry.index.md");

export type Tier = "haiku" | "sonnet" | "opus";

/**
 * The model each tier resolves to when a run is spawned headless. A tier is only
 * real if `--model` is passed; before this existed every CLI and cron run used the
 * session default regardless of what the registry declared.
 */
export function tierToModel(tier: Tier | string): string {
  switch (tier) {
    case "haiku":
      return process.env.HARNESS_MODEL_HAIKU ?? "claude-haiku-4-5-20251001";
    case "sonnet":
      return process.env.HARNESS_MODEL_SONNET ?? "claude-sonnet-5-5";
    case "opus":
      return process.env.HARNESS_MODEL_OPUS ?? "claude-opus-5-5";
    default:
      return tier; // already a model id
  }
}

export interface Subagent {
  name: string;
  tier: Tier;
  returns: "json" | "text";
  purpose: string;
}

export interface SkillEntry {
  name: string;
  purpose: string;
  entry: string[];
  tier: Tier;
  effort: "low" | "medium" | "high";
  triggers: string[];
  reads: string[];
  writes: string[];
  delegates_to: string[];
  gates: string[];
  subagents?: Subagent[];
}

export interface Composite {
  name: string;
  entry: string[];
  purpose: string;
  tier: Tier;
  scatter: string[];
  gather: string;
  writes: string[];
}

export interface Registry {
  schema_version: number;
  tiers: Record<string, string>;
  effort: Record<string, string>;
  skills: SkillEntry[];
  composites: Composite[];
  reuse: Record<string, string>;
  not_routable: { names: string[] };
}

export function registryPath(harnessRepo: string): string {
  return join(harnessRepo, "definitions", "registry.json");
}

export function loadRegistry(harnessRepo = getHarnessRepo()): Registry {
  const p = registryPath(harnessRepo);
  if (!existsSync(p)) throw new Error(`No registry at ${p}.`);
  const reg = JSON.parse(readFileSync(p, "utf8")) as Registry;
  if (reg.schema_version !== 1) {
    throw new Error(`Registry schema_version ${reg.schema_version} unsupported (expected 1).`);
  }
  return reg;
}

/** How a skill is invoked: its slash command if it has one, else the skill name. */
function invocation(e: SkillEntry): string {
  const cmd = e.entry[0];
  return cmd ? `${cmd} → ${e.name}` : e.name;
}

/**
 * Render definitions/registry.index.md. Deliberately terse: the router loads this
 * on every dispatch, so it carries triggers → destination → tier and nothing else.
 * Depth lives in registry.json, read only for the chosen skill.
 */
export function renderIndex(reg: Registry): string {
  const lines: string[] = [
    "<!-- Generated from definitions/registry.json by `harness registry sync`. Do not hand-edit. -->",
    "",
    "# Routing index",
    "",
    "| Route to | Tier | Triggers |",
    "|---|---|---|",
  ];
  for (const s of reg.skills) {
    if (s.name === "harness-router") continue; // the router is the thing reading this
    lines.push(`| ${invocation(s)} | ${s.tier} | ${s.triggers.slice(0, 5).join("; ")} |`);
  }
  for (const k of reg.composites) {
    lines.push(`| ${k.entry[0]} (scatter/gather) | ${k.tier} | ${k.purpose} |`);
  }
  lines.push("", "Reuse, never rebuild:");
  for (const [capability, target] of Object.entries(reg.reuse)) {
    if (capability.startsWith("$")) continue;
    lines.push(`- ${capability} → ${target}`);
  }
  lines.push("", `Never routable: ${reg.not_routable.names.join(", ")}.`, "");
  return lines.join("\n");
}

interface Finding {
  level: "error" | "warn";
  msg: string;
}

function skillDirs(harnessRepo: string): string[] {
  const dir = join(harnessRepo, ".claude", "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
    .map((d) => d.name);
}

interface Parsed {
  model?: string;
  effort?: string;
  /** Instruction lines after the frontmatter block — what the contract cap measures. */
  bodyLines: number;
  descriptionChars: number;
}

/** Non-empty lines after the frontmatter block — the cap for commands and agents. */
function bodyLineCount(file: string): number {
  const text = readFileSync(file, "utf8");
  const end = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
  const body = end === -1 ? text : text.slice(end + 4);
  return body.split("\n").filter((l) => l.trim()).length;
}

/** Split a SKILL.md into its frontmatter fields and its instruction body. */
function parseSkill(file: string): Parsed {
  const text = readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  const fm = end === -1 ? "" : text.slice(0, end);
  const body = end === -1 ? text : text.slice(end + 4);
  // `description:` may be a folded block (`>`), so take everything up to the next key.
  const desc = /^description:\s*>?-?\s*\n?([\s\S]*?)(?=\n[a-z-]+:|$)/m.exec(fm)?.[1] ?? "";
  return {
    model: /^model:\s*(\S+)/m.exec(fm)?.[1],
    effort: /^effort:\s*(\S+)/m.exec(fm)?.[1],
    bodyLines: body.split("\n").filter((l) => l.trim()).length,
    descriptionChars: desc.replace(/\s+/g, " ").trim().length,
  };
}

export function checkRegistry(harnessRepo = getHarnessRepo()): Finding[] {
  const reg = loadRegistry(harnessRepo);
  const findings: Finding[] = [];
  const onDisk = new Set(skillDirs(harnessRepo));
  const declared = new Map(reg.skills.map((s) => [s.name, s]));

  for (const name of onDisk) {
    if (!declared.has(name)) {
      findings.push({ level: "error", msg: `skill on disk with no registry entry: ${name}` });
    }
  }
  for (const name of declared.keys()) {
    if (!onDisk.has(name)) {
      findings.push({ level: "error", msg: `registry entry with no skill on disk: ${name}` });
    }
  }

  // Frontmatter must agree with the registry, and the contract cap must hold.
  for (const [name, entry] of declared) {
    if (!onDisk.has(name)) continue;
    const file = join(harnessRepo, ".claude", "skills", name, "SKILL.md");
    const fm = parseSkill(file);
    if (!fm.model) {
      findings.push({ level: "error", msg: `${name}: no \`model:\` in frontmatter (registry says ${entry.tier})` });
    } else if (!fm.model.includes(entry.tier)) {
      findings.push({
        level: "error",
        msg: `${name}: frontmatter model \`${fm.model}\` contradicts registry tier \`${entry.tier}\``,
      });
    }
    if (fm.effort && fm.effort !== entry.effort) {
      findings.push({
        level: "error",
        msg: `${name}: frontmatter effort \`${fm.effort}\` contradicts registry \`${entry.effort}\``,
      });
    }
    if (fm.bodyLines > SKILL_LINE_CAP) {
      findings.push({
        level: "error",
        msg: `${name}: ${fm.bodyLines} body lines, over the ${SKILL_LINE_CAP}-line contract cap — move detail to a sibling file`,
      });
    }
    if (fm.descriptionChars > DESCRIPTION_CHAR_CAP) {
      findings.push({
        level: "warn",
        msg: `${name}: description is ${fm.descriptionChars} chars (soft cap ${DESCRIPTION_CHAR_CAP}); the listing truncates at 1536`,
      });
    }
  }

  // Declared subagents must exist on disk with a matching `name:`, and their model
  // must match the tier the registry allocated them. A skill that spawns a
  // non-existent agent fails at runtime, in the middle of a user's workflow.
  const agentDir = join(harnessRepo, ".claude", "agents");
  const onDiskAgents = new Map<string, { model?: string }>();
  if (existsSync(agentDir)) {
    for (const f of readdirSync(agentDir).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(join(agentDir, f), "utf8");
      const end = text.indexOf("\n---", 3);
      const fm = end === -1 ? text : text.slice(0, end);
      const name = /^name:\s*(\S+)/m.exec(fm)?.[1];
      if (name) onDiskAgents.set(name, { model: /^model:\s*(\S+)/m.exec(fm)?.[1] });
    }
  }
  const declaredAgents = new Set<string>();
  for (const s of reg.skills) {
    for (const sub of s.subagents ?? []) {
      declaredAgents.add(sub.name);
      const agent = onDiskAgents.get(sub.name);
      if (!agent) {
        findings.push({ level: "error", msg: `${s.name}: declares subagent \`${sub.name}\`, missing from .claude/agents/` });
      } else if (agent.model && !agent.model.includes(sub.tier)) {
        findings.push({
          level: "error",
          msg: `agent ${sub.name}: model \`${agent.model}\` contradicts registry tier \`${sub.tier}\` (declared by ${s.name})`,
        });
      }
    }
  }
  for (const name of onDiskAgents.keys()) {
    if (!declaredAgents.has(name)) {
      findings.push({ level: "warn", msg: `agent ${name} exists on disk but no skill declares it` });
    }
  }

  // A composite's scatter list is what /standup and the dashboard actually execute,
  // so every entry must resolve to an agent on disk or a registered skill. Entries
  // may name a skill mode as `skill:mode` — only the skill part is resolvable here.
  for (const k of reg.composites) {
    for (const target of k.scatter) {
      const base = target.split(":")[0];
      if (!onDiskAgents.has(base) && !declared.has(base)) {
        findings.push({
          level: "error",
          msg: `composite ${k.name}: scatter target \`${target}\` is neither an agent nor a registered skill`,
        });
      }
    }
  }

  // Every slash command should map to a skill entry or a composite.
  const cmdDir = join(harnessRepo, ".claude", "commands");
  const entries = new Set<string>();
  for (const s of reg.skills) for (const e of s.entry) entries.add(e);
  for (const k of reg.composites) for (const e of k.entry) entries.add(e);
  if (existsSync(cmdDir)) {
    for (const f of readdirSync(cmdDir).filter((f) => f.endsWith(".md"))) {
      const slash = `/${f.replace(/\.md$/, "")}`;
      if (!entries.has(slash) && slash !== "/notes") {
        findings.push({ level: "warn", msg: `command ${slash} has no registry entry or composite` });
      }
    }
  }

  // The generated index must match what the registry renders, and CLAUDE.md must
  // not carry a routing table of its own (it used to; the index replaced it).
  const indexFile = join(harnessRepo, INDEX_FILE);
  if (!existsSync(indexFile)) {
    findings.push({ level: "error", msg: `${INDEX_FILE} missing — run \`harness registry sync\`` });
  } else if (readFileSync(indexFile, "utf8").trim() !== renderIndex(reg).trim()) {
    findings.push({ level: "error", msg: `${INDEX_FILE} has drifted — run \`harness registry sync\`` });
  }
  const claudeMd = join(harnessRepo, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const text = readFileSync(claudeMd, "utf8");
    if (text.includes(BEGIN_MARKER)) {
      findings.push({ level: "error", msg: "CLAUDE.md still carries a generated routing block — delete it; the index replaced it" });
    }
    const n = text.split("\n").length;
    if (n > CLAUDE_MD_LINE_CAP) {
      findings.push({ level: "error", msg: `CLAUDE.md is ${n} lines, over the ${CLAUDE_MD_LINE_CAP}-line always-on cap` });
    }
  }

  // Commands and agents are loaded whole when invoked; keep them to contracts.
  for (const [dirName, cap] of [["commands", COMMAND_LINE_CAP], ["agents", AGENT_LINE_CAP]] as const) {
    const dir = join(harnessRepo, ".claude", dirName);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const n = bodyLineCount(join(dir, f));
      if (n > cap) findings.push({ level: "error", msg: `${dirName}/${f}: ${n} body lines, over the ${cap}-line cap` });
    }
  }

  return findings;
}

/** Regenerate definitions/registry.index.md from the registry. */
export function syncRegistry(harnessRepo = getHarnessRepo()): boolean {
  const reg = loadRegistry(harnessRepo);
  const file = join(harnessRepo, INDEX_FILE);
  const next = renderIndex(reg);
  if (existsSync(file) && readFileSync(file, "utf8") === next) {
    info(`${INDEX_FILE} already up to date.`);
    return true;
  }
  writeFileSync(file, next, "utf8");
  ok(`${INDEX_FILE} regenerated from definitions/registry.json.`);
  return true;
}

export function registry(argv: string[]): number {
  const sub = argv[0] ?? "check";
  const harnessRepo = getHarnessRepo();

  if (sub === "sync") return syncRegistry(harnessRepo) ? 0 : 1;

  if (sub === "show") {
    const reg = loadRegistry(harnessRepo);
    for (const s of reg.skills) {
      const subs = s.subagents?.length ? c.dim(`  (+${s.subagents.length} subagent)`) : "";
      console.log(`${c.magenta(s.tier.padEnd(7))} ${s.name.padEnd(28)} ${c.dim(s.effort.padEnd(7))}${subs}`);
    }
    for (const k of reg.composites) {
      console.log(`${c.magenta(k.tier.padEnd(7))} ${k.name.padEnd(28)} ${c.dim(`scatter:${k.scatter.length}`)}`);
    }
    return 0;
  }

  if (sub === "check") {
    const findings = checkRegistry(harnessRepo);
    const errors = findings.filter((f) => f.level === "error");
    for (const f of findings) (f.level === "error" ? fail : warn)(f.msg);
    if (!errors.length) ok(`registry check passed (${loadRegistry(harnessRepo).skills.length} skills).`);
    return errors.length ? 1 : 0;
  }

  fail(`Unknown subcommand: ${sub}. Use check | sync | show.`);
  return 1;
}
