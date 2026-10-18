// `harness eval` — the harness's honest signal.
//
// Weng's "Harness Engineering for Self-Improvement" names weak/fuzzy evaluators
// as the bottleneck that should worry builders most: without a fast, precise
// verifier a self-improvement loop has nothing to optimize and drifts into
// hacking whatever proxy it's handed. This replays a small set of recorded
// golden tasks (definitions/eval/golden-tasks.jsonl) headless — through the same
// CLAUDE.md routing and guard hook as any run — and scores three things the
// harness actually promises:
//
//   routing   — did the ask reach the skill it should have?
//   readonly  — did the run avoid attempting any outward/mutating tool?
//   citations — did the answer ground itself in a source?
//   grounding — (opt-in) do the repo paths the answer cites actually exist?
//
// It is strictly read-only: every task runs with autonomous=true, so the guard
// hook DENIES any mutation. The scorecard is written to digests/ and consumed by
// harness-self-improve as its optimization signal.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, digestsDir, ensureDir } from "./paths.js";
import { runClaude } from "./claude.js";
import { banner, c, info, ok, warn, fail } from "./ui.js";
import { checkRegistry } from "./registry.js";

interface GoldenTask {
  id: string;
  prompt: string;
  expect?: {
    /** toolsUsed signature must match at least one of these (substring match). */
    route?: string[];
    /** Answer must contain a citation (Jira key, URL, or repo path). */
    cite?: boolean;
    /** Run must not attempt any outward/mutating tool. Defaults to true. */
    readonly?: boolean;
    /** Verify every repo path the answer cites actually exists. */
    grounding?: boolean;
    /** Fail if any tool signature contains one of these (substring). */
    forbid?: string[];
    /** These signatures must appear in this relative order (first occurrence each). */
    order?: string[];
    /** The answer text must match this regex. */
    answer_matches?: string;
    /** The answer must mention each of these repo paths. */
    cites?: string[];
    /** The answer must contain each of these words (case-insensitive). */
    mentions?: string[];
    /** Reply ceiling from the output contract; default 8 unless `scan` is true. */
    max_lines?: number;
    /** A scan may use one line per item; skip the verbosity check. */
    scan?: boolean;
  };
  note?: string;
}

interface TaskScore {
  id: string;
  note?: string;
  checks: { name: string; pass: boolean; detail?: string }[];
  pass: boolean;
  costUsd: number | null;
  durationMs: number | null;
  tools: number;
}

// Tool signatures that mean the run tried to change remote/outward state.
const MUTATION_TOOL = /(slack_send_message|slack_schedule_message|slack_create_canvas|slack_update_canvas|transitionJiraIssue|editJiraIssue|addCommentToJiraIssue|createJiraIssue|createConfluencePage|updateConfluencePage|createConfluenceFooterComment|createConfluenceInlineComment|Gmail__(?!.*draft))/;
// Mutating shell inside a Bash signature (Bash:<command>).
const MUTATION_BASH = /Bash:.*(git\s+push|gh\s+pr\s+(create|merge|ready)|gh\s+issue\s+create|git\s+reset\s+--hard|git\s+clean\s+-|sentry\s+(issue\s+(resolve|unresolve|archive|merge)|alert\s+\S+\s+(create|edit|delete)|release\s+(create|finalize|delete)|project\s+(create|delete)))/;

// A citation: a Jira key, any URL, a markdown link, or a known repo path.
const CITATION = /(\b[A-Z][A-Z0-9]+-\d+\b|https?:\/\/|\]\(|(?:\.claude|cli|definitions|knowledge|workspace)\/[\w./-]+|\bCLAUDE\.md\b|\bREADME\.md\b)/;
// Repo-relative paths we can resolve on disk (for the grounding check).
// `~/.claude/...` is the user's home config, not a repo path — exclude it from grounding.
const REPO_PATH = /(?<![\w~/.])(?:\.claude|cli|definitions|knowledge|workspace)\/[\w./-]+|\bCLAUDE\.md\b|\bREADME\.md\b/g;

function loadTasks(harnessRepo: string, filter?: string): GoldenTask[] {
  const file = join(harnessRepo, "definitions", "eval", "golden-tasks.jsonl");
  if (!existsSync(file)) throw new Error(`No golden tasks at ${file}.`);
  const tasks = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l) as GoldenTask;
      } catch {
        throw new Error(`golden-tasks.jsonl line ${i + 1} is not valid JSON.`);
      }
    });
  return filter ? tasks.filter((t) => t.id.includes(filter) || t.prompt.includes(filter)) : tasks;
}

function scoreTask(task: GoldenTask, text: string, toolsUsed: string[], harnessRepo: string): TaskScore {
  const exp = task.expect ?? {};
  const checks: TaskScore["checks"] = [];
  const sigs = toolsUsed.join("   ");

  if (exp.route?.length) {
    const hit = exp.route.find((r) => sigs.includes(r));
    checks.push({
      name: "routing",
      pass: Boolean(hit),
      detail: hit ? `→ ${hit}` : `expected one of [${exp.route.join(", ")}]; saw [${toolsUsed.map(shortSig).join(", ") || "none"}]`,
    });
  }

  if (exp.readonly !== false) {
    const offender = toolsUsed.find((t) => MUTATION_TOOL.test(t) || MUTATION_BASH.test(t));
    checks.push({
      name: "readonly",
      pass: !offender,
      detail: offender ? `attempted mutation: ${shortSig(offender)}` : undefined,
    });
  }

  if (exp.cite) {
    const cited = CITATION.test(text);
    checks.push({ name: "citations", pass: cited, detail: cited ? undefined : "no source cited in answer" });
  }

  if (exp.grounding) {
    const missing = [...text.matchAll(REPO_PATH)]
      .map((m) => m[0].replace(/[.,;:)\]]+$/, ""))
      .filter((p, i, a) => a.indexOf(p) === i)
      .filter((p) => !existsSync(join(harnessRepo, p)));
    checks.push({
      name: "grounding",
      pass: missing.length === 0,
      detail: missing.length ? `cites nonexistent path(s): ${missing.join(", ")}` : undefined,
    });
  }

  if (exp.forbid?.length) {
    const hit = exp.forbid.find((f) => toolsUsed.some((t) => t.includes(f)));
    checks.push({ name: "forbid", pass: !hit, detail: hit ? `forbidden signature seen: ${hit}` : undefined });
  }

  if (exp.order?.length) {
    const idx = exp.order.map((o) => toolsUsed.findIndex((t) => t.includes(o)));
    const okOrder = idx.every((i) => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]);
    checks.push({ name: "order", pass: okOrder, detail: okOrder ? undefined : `expected order [${exp.order.join(" → ")}]; indices ${idx.join(",")}` });
  }

  if (exp.answer_matches) {
    // Accept a leading `(?i)` (Python/PCRE style) by turning it into the JS `i` flag.
    const ci = exp.answer_matches.startsWith("(?i)");
    const re = new RegExp(ci ? exp.answer_matches.slice(4) : exp.answer_matches, ci ? "i" : "");
    checks.push({ name: "answer", pass: re.test(text), detail: re.test(text) ? undefined : `answer does not match /${exp.answer_matches}/` });
  }

  if (exp.cites?.length) {
    const missing = exp.cites.filter((p) => !text.includes(p));
    checks.push({ name: "cites", pass: !missing.length, detail: missing.length ? `not cited: ${missing.join(", ")}` : undefined });
  }

  if (exp.mentions?.length) {
    const lower = text.toLowerCase();
    const missing = exp.mentions.filter((w) => !lower.includes(w.toLowerCase()));
    checks.push({ name: "mentions", pass: !missing.length, detail: missing.length ? `not mentioned: ${missing.join(", ")}` : undefined });
  }

  if (!exp.scan) {
    // definitions/output-contract.md: 8 lines is the default ceiling for a reply.
    const cap = exp.max_lines ?? 8;
    const lines = text.split("\n").filter((l) => l.trim() && !/^```/.test(l)).length;
    checks.push({ name: "verbosity", pass: lines <= cap, detail: lines > cap ? `${lines} non-empty lines, cap ${cap}` : undefined });
  }

  return { id: task.id, note: task.note, checks, pass: checks.every((ch) => ch.pass), costUsd: null, durationMs: null, tools: toolsUsed.length };
}

function shortSig(sig: string): string {
  return sig.length > 48 ? sig.slice(0, 45) + "…" : sig;
}

export async function evaluate(rest: string[]): Promise<number> {
  const save = !rest.includes("--no-save");
  const filter = rest.filter((a) => !a.startsWith("--"))[0];
  const harnessRepo = getHarnessRepo();

  let tasks: GoldenTask[];
  try {
    tasks = loadTasks(harnessRepo, filter);
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }
  if (!tasks.length) {
    warn(filter ? `No golden tasks match "${filter}".` : "No golden tasks defined.");
    return 1;
  }

  banner();

  // Static invariants first. Replaying golden tasks costs real tokens, and routing
  // drift makes every routing score meaningless — so fail fast and cheap instead of
  // scoring a harness whose routing table doesn't match the skills on disk.
  const drift = checkRegistry(harnessRepo).filter((f) => f.level === "error");
  if (drift.length) {
    for (const d of drift) fail(d.msg);
    fail(`Registry check failed (${drift.length} error(s)) — fix routing before scoring. Nothing was replayed.`);
    return 1;
  }
  ok("Registry check passed.");

  info(`Replaying ${tasks.length} golden task(s) headless (read-only, guard denies mutations)…\n`);

  const scores: TaskScore[] = [];
  for (const [i, task] of tasks.entries()) {
    process.stdout.write(c.dim(`  [${i + 1}/${tasks.length}] ${task.id} … `));
    try {
      const result = await runClaude({
        prompt: task.prompt,
        harnessRepo,
        sessionId: randomUUID(),
        isNew: true,
        autonomous: true,
        quiet: true,
      });
      const score = scoreTask(task, result.text, result.toolsUsed, harnessRepo);
      score.costUsd = result.costUsd;
      score.durationMs = result.durationMs;
      scores.push(score);
      process.stdout.write((score.pass ? c.green("pass") : c.red("FAIL")) + "\n");
    } catch (e) {
      scores.push({ id: task.id, note: task.note, checks: [{ name: "run", pass: false, detail: (e as Error).message }], pass: false, costUsd: null, durationMs: null, tools: 0 });
      process.stdout.write(c.red("ERROR") + "\n");
    }
  }

  const report = renderReport(scores);
  process.stdout.write("\n" + report + "\n");

  if (save) {
    ensureDir(digestsDir());
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = join(digestsDir(), `eval-${stamp}.md`);
    writeFileSync(file, `# harness eval — ${new Date().toLocaleString()}\n\n${report}\n`, "utf8");
    ok(`Scorecard written to ${file}`);
    info("harness-self-improve reads the latest eval-*.md as its optimization signal.");
  }

  const passed = scores.filter((s) => s.pass).length;
  return passed === scores.length ? 0 : 1;
}

function renderReport(scores: TaskScore[]): string {
  const passed = scores.filter((s) => s.pass).length;
  const dims: Record<string, { pass: number; total: number }> = {};
  for (const s of scores) {
    for (const ch of s.checks) {
      const d = (dims[ch.name] ??= { pass: 0, total: 0 });
      d.total++;
      if (ch.pass) d.pass++;
    }
  }

  const cost = scores.reduce((a, s) => a + (s.costUsd ?? 0), 0);
  const secs = scores.reduce((a, s) => a + (s.durationMs ?? 0), 0) / 1000;
  const lines: string[] = [];
  lines.push(`**${passed}/${scores.length} tasks passed**  ·  $${cost.toFixed(2)}  ·  ${Math.round(secs)}s  ·  ${scores.reduce((a, s) => a + s.tools, 0)} tool calls`);
  lines.push("");
  lines.push("| dimension | score |");
  lines.push("|---|---|");
  for (const [name, d] of Object.entries(dims)) lines.push(`| ${name} | ${d.pass}/${d.total} |`);
  lines.push("");
  lines.push("| task | result | $ | tools | failing checks |");
  lines.push("|---|---|---|---|---|");
  for (const s of scores) {
    const fails = s.checks.filter((ch) => !ch.pass).map((ch) => `${ch.name}${ch.detail ? ` (${ch.detail})` : ""}`);
    lines.push(`| ${s.id} | ${s.pass ? "✓" : "✗"} | ${s.costUsd === null ? "—" : s.costUsd.toFixed(2)} | ${s.tools} | ${fails.join("; ") || "—"} |`);
  }
  return lines.join("\n");
}
