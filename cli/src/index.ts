#!/usr/bin/env node
// harness — a thin CLI wrapper over Claude Code.
//
// Runs the dev-ai-harness's own skills/commands non-interactively, with a
// persistent session per context, injected memory, and a branded interface.

import { resolve as pathResolve } from "node:path";
import { existsSync as fsExists } from "node:fs";
import { createInterface } from "node:readline";
import { banner, info, ok, warn, fail, c, PROMPT } from "./ui.js";
import {
  readConfig,
  writeConfig,
  getHarnessRepo,
  memoryDir as memDir,
} from "./paths.js";
import { readSessions, resetContext } from "./sessions.js";
import { executeContext } from "./run.js";
import { showMemory, memoryFilePath, appendMemory } from "./memory.js";
import { sync } from "./sync.js";
import { installCron } from "./cron.js";
import {
  buildStructural,
  loadGraph,
  saveGraph,
  query as graphQuery,
  findNode,
  neighbors,
  shortestPath,
} from "./graph.js";
import { inferEdges } from "./graph-infer.js";
import { startMcp } from "./mcp.js";
import { dashboard } from "./dashboard.js";
import { selfImprove } from "./self-improve.js";
import { graphPath } from "./paths.js";

// Slash-command sugar: subcommand → the harness slash command it triggers.
const SLASH: Record<string, string> = {
  standup: "/standup",
  triage: "/triage",
  meeting: "/meeting",
  monitoring: "/monitoring",
  harness: "/harness",
  // Follow-up sugar: jump straight into the meetings follow-up flow (ingest the
  // Gemini transcript for the most recent/named meeting, then draft action items).
  followup: "/meeting follow up: ingest the most recent meeting's Gemini transcript and draft action items",
};

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd) return interactive();

  switch (cmd) {
    case "init":
      return cmdInit(rest);
    case "run":
      return cmdRun(rest);
    case "sessions":
      return cmdSessions();
    case "reset":
      return cmdReset(rest);
    case "memory":
      return cmdMemory(rest);
    case "sync":
      return sync();
    case "install-cron":
      return installCron(rest.includes("--apply"));
    case "graph":
      return cmdGraph(rest);
    case "dashboard":
      return dashboard(rest);
    case "self-improve":
      return selfImprove(rest);
    case "mcp":
      return startMcp();
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      if (cmd in SLASH) return cmdSugar(cmd, rest);
      // `harness <context> "<message>"` — core verb.
      if (rest.length) return cmdContext(cmd, rest.join(" "));
      fail(`Unknown command: ${cmd}`);
      usage();
      return 1;
  }
}

function cmdInit(rest: string[]): number {
  const repo = pathResolve(rest[0] ?? process.cwd());
  if (!fsExists(pathResolve(repo, "CLAUDE.md"))) {
    fail(`No CLAUDE.md at ${repo} — that doesn't look like the dev-ai-harness repo.`);
    info("Usage: harness init <path-to-dev-ai-harness>");
    return 1;
  }
  const cfg = readConfig() ?? { harnessRepo: repo };
  cfg.harnessRepo = repo;
  writeConfig(cfg);
  ok(`Harness repo set to ${c.bold(repo)}`);
  info("You can now run `harness standup`, `harness run \"...\"`, etc. from any directory.");
  return 0;
}

function splitFlags(rest: string[]): { digest: boolean; words: string[] } {
  const digest = rest.includes("--digest");
  return { digest, words: rest.filter((a) => a !== "--digest") };
}

async function cmdRun(rest: string[]): Promise<number> {
  const { digest, words } = splitFlags(rest);
  const prompt = words.join(" ").trim();
  if (!prompt) {
    fail('Nothing to ask. Usage: harness run "<your message>"');
    return 1;
  }
  const cfg = readConfig();
  const context = cfg?.defaultContext ?? "chat";
  await executeContext({ context, prompt, digest });
  return 0;
}

async function cmdSugar(cmd: string, rest: string[]): Promise<number> {
  // Each sugar command is its own context, so e.g. standup keeps its own thread.
  const { digest, words } = splitFlags(rest);
  const extra = words.join(" ").trim();
  const prompt = extra ? `${SLASH[cmd]} ${extra}` : SLASH[cmd];
  await executeContext({ context: cmd, prompt, digest });
  return 0;
}

async function cmdContext(context: string, prompt: string): Promise<number> {
  await executeContext({ context, prompt });
  return 0;
}

function cmdSessions(): number {
  const map = readSessions();
  const entries = Object.entries(map);
  if (!entries.length) {
    info("No sessions yet. Run `harness standup` or `harness run \"...\"` to start one.");
    return 0;
  }
  banner();
  for (const [ctx, r] of entries) {
    const last = r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "never";
    process.stdout.write(
      `${c.magenta("◆")} ${c.bold(ctx.padEnd(18))} ${c.dim(r.sessionId)}\n` +
        `  ${c.dim(`runs: ${r.runs}  ·  last: ${last}`)}\n`,
    );
  }
  return 0;
}

function cmdReset(rest: string[]): number {
  const ctx = rest[0];
  if (!ctx) {
    fail("Usage: harness reset <context>");
    return 1;
  }
  if (resetContext(ctx)) ok(`Forgot session for "${ctx}". Next run starts fresh.`);
  else warn(`No session named "${ctx}".`);
  return 0;
}

function cmdMemory(rest: string[]): number {
  const [sub, ...args] = rest;
  const context = (sub === "show" || sub === "edit" || sub === "add" ? args[0] : sub) ?? "global";
  switch (sub) {
    case "show":
    case undefined: {
      const content = showMemory(context);
      if (content) process.stdout.write(content + "\n");
      else info(`No memory for "${context}" yet. Add with: harness memory add ${context} "<fact>"`);
      return 0;
    }
    case "add": {
      const fact = args.slice(1).join(" ").trim();
      if (!fact) {
        fail('Usage: harness memory add <context> "<fact>"');
        return 1;
      }
      appendMemory(context, fact);
      ok(`Saved to ${memoryFilePath(context)}`);
      return 0;
    }
    case "edit": {
      info(`Memory file: ${memoryFilePath(context)}`);
      info("Open it in your editor to edit directly.");
      return 0;
    }
    default: {
      // `harness memory <context>` → show
      const content = showMemory(context);
      if (content) process.stdout.write(content + "\n");
      else info(`No memory for "${context}" yet.`);
      return 0;
    }
  }
}

async function cmdGraph(rest: string[]): Promise<number> {
  const [sub, ...args] = rest;
  switch (sub) {
    case "build": {
      const g = buildStructural();
      if (args.includes("--infer")) {
        info("Inferring semantic links (LLM pass)…");
        const added = await inferEdges(g);
        info(`Added ${added} inferred edge(s).`);
      }
      saveGraph(g);
      ok(`Built ${g.nodes.length} nodes, ${g.edges.length} edges → ${graphPath()}`);
      return 0;
    }
    case "query": {
      const g = ensureGraph();
      const hits = graphQuery(g, args.join(" "));
      if (!hits.length) { warn("No matching nodes."); return 0; }
      for (const n of hits) process.stdout.write(`${nodeLine(n)}\n`);
      return 0;
    }
    case "neighbors": {
      const g = ensureGraph();
      const node = findNode(g, args.join(" "));
      if (!node) { warn("Node not found."); return 1; }
      process.stdout.write(`${nodeLine(node)}\n`);
      for (const nb of neighbors(g, node.id)) {
        const arrow = nb.direction === "out" ? "→" : "←";
        const tag = nb.edge.confidence === "INFERRED" ? c.yellow(`~${nb.edge.type}`) : c.dim(nb.edge.type);
        process.stdout.write(`  ${arrow} ${tag} ${nodeLine(nb.node)}\n`);
      }
      return 0;
    }
    case "path": {
      const g = ensureGraph();
      const a = findNode(g, args[0] ?? "");
      const b = findNode(g, args[1] ?? "");
      if (!a || !b) { warn("Both endpoints must resolve. Usage: harness graph path <a> <b>"); return 1; }
      const path = shortestPath(g, a.id, b.id);
      if (!path) { warn("No path between those nodes."); return 0; }
      path.forEach((step, i) => {
        if (i > 0 && step.via) process.stdout.write(`  ${c.dim(`│ ${step.via.type}`)}\n`);
        process.stdout.write(`${i === 0 ? c.magenta("◆") : c.magenta("◇")} ${nodeLine(step.node)}\n`);
      });
      return 0;
    }
    case "explain": {
      const g = ensureGraph();
      const node = findNode(g, args.join(" "));
      if (!node) { warn("Node not found."); return 1; }
      process.stdout.write(`${nodeLine(node)}\n`);
      if (node.meta && Object.keys(node.meta).length)
        process.stdout.write(`  ${c.dim(JSON.stringify(node.meta))}\n`);
      const nbs = neighbors(g, node.id);
      process.stdout.write(c.dim(`  ${nbs.length} connection(s):\n`));
      for (const nb of nbs) {
        const verb = nb.direction === "out" ? nb.edge.type : `${nb.edge.type} (of)`;
        process.stdout.write(`    ${c.dim(verb)} ${nb.node.label}\n`);
      }
      return 0;
    }
    default:
      info("Usage: harness graph build [--infer] | query <text> | neighbors <node> | path <a> <b> | explain <node>");
      return 0;
  }
}

function ensureGraph() {
  const g = loadGraph();
  if (!g.nodes.length) {
    warn("Graph is empty. Run `harness graph build` first.");
  }
  return g;
}

function nodeLine(n: { type: string; label: string }): string {
  return `${c.cyan(`[${n.type}]`)} ${c.bold(n.label)}`;
}

async function interactive(): Promise<number> {
  // Verify config early so the prompt isn't a dead end.
  try {
    getHarnessRepo();
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }
  banner();
  let context = readConfig()?.defaultContext ?? "chat";
  info(`Interactive mode. Active context: ${c.bold(context)}.`);
  info(`Type a message, ${c.bold(":use <context>")} to switch, ${c.bold(":quit")} to exit.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    new Promise<string>((res) => rl.question(PROMPT(context), res));

  for (;;) {
    const line = (await ask()).trim();
    if (!line) continue;
    if (line === ":quit" || line === ":q" || line === "exit") break;
    if (line.startsWith(":use ")) {
      context = line.slice(5).trim() || context;
      info(`Switched to ${c.bold(context)}.`);
      continue;
    }
    try {
      await executeContext({ context, prompt: line });
    } catch (e) {
      fail((e as Error).message);
    }
    process.stdout.write("\n");
  }
  rl.close();
  return 0;
}

function usage(): number {
  banner();
  process.stdout.write(
    `${c.bold("Usage")}\n` +
      `  harness                         ${c.dim("interactive prompt")}\n` +
      `  harness init <repo-path>        ${c.dim("point the CLI at your dev-ai-harness clone")}\n` +
      `  harness run "<message>"         ${c.dim("one-off ask in the default context")}\n` +
      `  harness <context> "<message>"   ${c.dim("ask within a named, persistent context")}\n` +
      `  harness standup|triage|meeting  ${c.dim("run a harness slash command (its own context)")}\n` +
      `  harness monitoring [--digest]   ${c.dim("Sentry/Datadog/Amplitude health (read-only)")}\n` +
      `  harness followup ["<meeting>"]  ${c.dim("ingest a meeting transcript + draft action items")}\n` +
      `  harness dashboard [--digest]    ${c.dim("role-ordered dev dashboard (PRs/Jira/meetings/support)")}\n` +
      `  harness self-improve [--digest] ${c.dim("read-only reflection: propose harness improvements")}\n` +
      `  harness sessions                ${c.dim("list saved contexts + session ids")}\n` +
      `  harness reset <context>         ${c.dim("forget a context's session")}\n` +
      `  harness memory [show|add|edit]  ${c.dim("view/append durable memory")}\n` +
      `  harness sync                    ${c.dim("git pull harness + refresh marketplaces")}\n` +
      `  harness install-cron [--apply]  ${c.dim("schedule weekday digest runs")}\n` +
      `  harness graph build [--infer]   ${c.dim("build the context graph (+ inferred links)")}\n` +
      `  harness graph query|neighbors|path|explain   ${c.dim("query the context graph")}\n` +
      `  harness mcp                     ${c.dim("run the context-graph MCP server (stdio)")}\n`,
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    fail(err?.message ?? String(err));
    process.exit(1);
  });
