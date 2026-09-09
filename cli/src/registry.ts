// `harness registry` — the routing single source of truth, enforced.
//
// definitions/registry.json declares every skill: what triggers it, which model
// tier it runs at, what it reads/writes, what it delegates to, and which gates
// apply. Three things consume it:
//
//   1. CLAUDE.md's routing table is GENERATED from it (`registry sync`), so the
//      table can't drift from the skills that actually exist.
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

export type Tier = "haiku" | "sonnet" | "opus";

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
  return cmd ? `\`${cmd}\` → \`${e.name}\`` : `\`${e.name}\``;
}

/**
 * Render the routing block injected into CLAUDE.md. Deliberately terse: this is
 * loaded into every session, so it carries intent → destination → tier and
 * nothing else. Depth lives in the registry, read on demand.
 */
export function renderRoutingBlock(reg: Registry): string {
  const lines: string[] = [
    BEGIN_MARKER,
    "",
    "<!-- Generated from definitions/registry.json. Do not hand-edit: `harness registry sync` overwrites it. -->",
    "",
    "| Intent | Route to | Tier |",
    "|---|---|---|",
  ];

  for (const s of reg.skills) {
    if (s.name === "harness-router") continue; // the router is the thing reading this
    const triggers = s.triggers.slice(0, 4).join(", ");
    lines.push(`| ${triggers} | ${invocation(s)} | ${s.tier} |`);
  }
  for (const k of reg.composites) {
    lines.push(`| ${k.purpose} | \`${k.entry[0]}\` (scatter/gather) | ${k.tier} |`);
  }

  lines.push("", "**Reuse, never rebuild** — route by intent:", "");
  for (const [capability, target] of Object.entries(reg.reuse)) {
    if (capability.startsWith("$")) continue;
    lines.push(`- ${capability} → \`${target}\``);
  }

  lines.push(
    "",
    `**Never routable** (internal sub-agents of \`sosafe-ai-harness-task-to-pr\`): ${reg.not_routable.names
      .map((n) => `\`${n}\``)
      .join(", ")}.`,
    "",
    END_MARKER,
  );
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

  // CLAUDE.md's generated block must match what the registry renders.
  const claudeMd = join(harnessRepo, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const text = readFileSync(claudeMd, "utf8");
    const start = text.indexOf(BEGIN_MARKER);
    const stop = text.indexOf(END_MARKER);
    if (start === -1 || stop === -1) {
      findings.push({ level: "error", msg: "CLAUDE.md has no generated routing block — run `harness registry sync`" });
    } else {
      const current = text.slice(start, stop + END_MARKER.length);
      if (current.trim() !== renderRoutingBlock(reg).trim()) {
        findings.push({ level: "error", msg: "CLAUDE.md routing block has drifted — run `harness registry sync`" });
      }
    }
  }

  return findings;
}

/** Rewrite CLAUDE.md's generated routing block from the registry. */
export function syncRegistry(harnessRepo = getHarnessRepo()): boolean {
  const reg = loadRegistry(harnessRepo);
  const claudeMd = join(harnessRepo, "CLAUDE.md");
  const text = readFileSync(claudeMd, "utf8");
  const start = text.indexOf(BEGIN_MARKER);
  const stop = text.indexOf(END_MARKER);
  if (start === -1 || stop === -1) {
    fail("CLAUDE.md has no BEGIN/END GENERATED ROUTING markers — add them first.");
    return false;
  }
  const next = text.slice(0, start) + renderRoutingBlock(reg) + text.slice(stop + END_MARKER.length);
  if (next === text) {
    info("CLAUDE.md routing block already up to date.");
    return true;
  }
  writeFileSync(claudeMd, next, "utf8");
  ok("CLAUDE.md routing block regenerated from definitions/registry.json.");
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
