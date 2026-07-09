// `harness memory audit` — the memory lifecycle Weng's essay says a harness
// needs. Memory that only grows becomes noise: stale facts get recalled and
// trusted, and near-duplicates crowd out signal. This is a READ-ONLY detector.
// It scans the three memory stores the harness keeps —
//
//   ~/.claude/sosafe-harness/memory/  (CLI injected memory)
//   <vaultPath>/memory/               (the private Obsidian vault, if set)
//   <harnessRepo>/knowledge/          (committed team memory + anti-patterns)
//
// — and flags entries that are STALE (old `updated:` / mtime) or NEAR-DUPLICATE
// (high token overlap). It never deletes: it surfaces candidates and tells you
// how to act, matching the harness's confirm-before-you-change philosophy.
// `--deep` adds an optional LLM pass to spot likely contradictions.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getHarnessRepo, memoryDir, readConfig } from "./paths.js";
import { runClaude } from "./claude.js";
import { banner, c, info, ok, warn } from "./ui.js";

const DEFAULT_STALE_DAYS = 120;
const DUPE_THRESHOLD = 0.6;

interface Entry {
  path: string;      // display path
  abs: string;
  updated: Date;     // from `updated:` frontmatter, else mtime
  hasExplicitDate: boolean;
  tokens: Set<string>;
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listMarkdown(p));
    else if (name.endsWith(".md") && name !== "MEMORY.md") out.push(p);
  }
  return out;
}

function tokenize(body: string): Set<string> {
  return new Set(
    body
      .toLowerCase()
      .replace(/^---[\s\S]*?---/, "") // drop frontmatter
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function parseUpdated(body: string, abs: string): { date: Date; explicit: boolean } {
  const m = body.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
  if (m) return { date: new Date(m[1]), explicit: true };
  return { date: statSync(abs).mtime, explicit: false };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function collect(label: string, dir: string): Entry[] {
  return listMarkdown(dir).map((abs) => {
    const body = readFileSync(abs, "utf8");
    const { date, explicit } = parseUpdated(body, abs);
    return {
      path: `${label}/${abs.slice(dir.length + 1)}`,
      abs,
      updated: date,
      hasExplicitDate: explicit,
      tokens: tokenize(body),
    };
  });
}

export async function memoryAudit(rest: string[]): Promise<number> {
  const deep = rest.includes("--deep");
  const daysArg = rest.find((a) => a.startsWith("--stale="));
  const staleDays = daysArg ? Number(daysArg.split("=")[1]) || DEFAULT_STALE_DAYS : DEFAULT_STALE_DAYS;

  const cfg = readConfig();
  let harnessRepo: string | null = null;
  try {
    harnessRepo = getHarnessRepo();
  } catch {
    harnessRepo = null;
  }

  const entries: Entry[] = [
    ...collect("cli-memory", memoryDir()),
    ...(cfg?.vaultPath ? collect("vault", join(cfg.vaultPath, "memory")) : []),
    ...(harnessRepo ? collect("knowledge", join(harnessRepo, "knowledge")) : []),
  ];

  banner();
  if (!entries.length) {
    info("No memory files found yet — nothing to audit.");
    return 0;
  }
  info(`Auditing ${entries.length} memory entr${entries.length === 1 ? "y" : "ies"} (stale > ${staleDays}d, near-dup ≥ ${DUPE_THRESHOLD}).\n`);

  // Staleness.
  const now = Date.now();
  const stale = entries
    .filter((e) => now - e.updated.getTime() > staleDays * 864e5)
    .sort((a, b) => a.updated.getTime() - b.updated.getTime());

  process.stdout.write(c.bold("Stale entries\n"));
  if (!stale.length) process.stdout.write(c.dim("  none\n"));
  for (const e of stale) {
    const age = Math.floor((now - e.updated.getTime()) / 864e5);
    const src = e.hasExplicitDate ? "updated" : "mtime";
    process.stdout.write(`  ${c.yellow("⧗")} ${e.path} ${c.dim(`(${age}d, by ${src})`)}\n`);
  }

  // Near-duplicates.
  const dupes: [Entry, Entry, number][] = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const sim = jaccard(entries[i].tokens, entries[j].tokens);
      if (sim >= DUPE_THRESHOLD) dupes.push([entries[i], entries[j], sim]);
    }
  dupes.sort((a, b) => b[2] - a[2]);

  process.stdout.write("\n" + c.bold("Near-duplicates\n"));
  if (!dupes.length) process.stdout.write(c.dim("  none\n"));
  for (const [a, b, sim] of dupes)
    process.stdout.write(`  ${c.yellow("≈")} ${(sim * 100).toFixed(0)}%  ${a.path}  ↔  ${b.path}\n`);

  // Contradictions (optional, LLM-backed).
  if (deep && harnessRepo) {
    process.stdout.write("\n" + c.bold("Possible contradictions (LLM pass)\n"));
    const manifest = entries.map((e) => `## ${e.path}\n${readFileSync(e.abs, "utf8").slice(0, 1500)}`).join("\n\n");
    const prompt =
      "You are auditing my personal memory files for CONTRADICTIONS ONLY (facts that conflict with each other). " +
      "List each contradiction as one bullet naming the two files and the conflict. If none, say 'none found'. " +
      "Do not use any tools; answer from the text below.\n\n" +
      manifest;
    try {
      const res = await runClaude({ prompt, harnessRepo, sessionId: randomUUID(), isNew: true, autonomous: true, quiet: true });
      process.stdout.write("  " + res.text.replace(/\n/g, "\n  ") + "\n");
    } catch (e) {
      warn(`  contradiction pass failed: ${(e as Error).message}`);
    }
  } else if (!deep) {
    process.stdout.write("\n" + c.dim("Run with --deep to add an LLM contradiction pass.\n"));
  }

  process.stdout.write("\n");
  ok(`Audit complete: ${stale.length} stale, ${dupes.length} near-duplicate pair(s).`);
  info("This is read-only. Review, then edit or remove entries yourself (e.g. `harness memory edit <ctx>` or delete the file).");
  return 0;
}
