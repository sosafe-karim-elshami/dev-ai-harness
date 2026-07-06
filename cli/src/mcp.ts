// Minimal MCP server (stdio, newline-delimited JSON-RPC) exposing the context
// graph to any LLM client — so the harness skills can traverse the graph
// ("who owns this repo?", "what's blocking X?") instead of re-querying every
// source. Mirrors graphify/GitNexus's query_graph / get_neighbors /
// shortest_path tools. Dependency-free to keep the CLI thin.
//
// stdout is the protocol channel — never write anything but JSON-RPC there.
// All diagnostics go to stderr.

import { createInterface } from "node:readline";
import { loadGraph, query, findNode, neighbors, shortestPath } from "./graph.js";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "query_graph",
    description: "Search the person's context graph for nodes (people, teams, repos, Jira projects, Slack channels, docs) matching free text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Search text" } },
      required: ["text"],
    },
  },
  {
    name: "get_neighbors",
    description: "List everything directly connected to a node (by id or label), with the relationship type and direction.",
    inputSchema: {
      type: "object",
      properties: { node: { type: "string", description: "Node id or label" } },
      required: ["node"],
    },
  },
  {
    name: "shortest_path",
    description: "Find how two entities in the person's context are connected (shortest relationship path).",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
];

function callTool(name: string, args: any): string {
  const g = loadGraph();
  if (!g.nodes.length) return "Graph is empty. Run `harness graph build` first.";
  switch (name) {
    case "query_graph": {
      const hits = query(g, String(args?.text ?? ""));
      return hits.length
        ? hits.map((n) => `${n.id} (${n.type}: ${n.label})`).join("\n")
        : "No matching nodes.";
    }
    case "get_neighbors": {
      const node = findNode(g, String(args?.node ?? ""));
      if (!node) return "Node not found.";
      const nbs = neighbors(g, node.id);
      return (
        `${node.id} (${node.type}: ${node.label})\n` +
        nbs
          .map((nb) => `  ${nb.direction === "out" ? "->" : "<-"} ${nb.edge.type}${nb.edge.confidence === "INFERRED" ? `~${nb.edge.score ?? ""}` : ""} ${nb.node.id} (${nb.node.label})`)
          .join("\n")
      );
    }
    case "shortest_path": {
      const a = findNode(g, String(args?.from ?? ""));
      const b = findNode(g, String(args?.to ?? ""));
      if (!a || !b) return "Both endpoints must resolve to nodes.";
      const path = shortestPath(g, a.id, b.id);
      if (!path) return "No path between those nodes.";
      return path
        .map((s, i) => (i > 0 && s.via ? `--[${s.via.type}]--> ` : "") + `${s.node.label}`)
        .join(" ");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function startMcp(): Promise<number> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
    const reply = (id: any, result: unknown) => send({ jsonrpc: "2.0", id, result });
    const error = (id: any, code: number, message: string) =>
      send({ jsonrpc: "2.0", id, error: { code, message } });

    rl.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      const { id, method, params } = msg;
      try {
        switch (method) {
          case "initialize":
            reply(id, {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "harness-context-graph", version: "0.1.0" },
            });
            break;
          case "notifications/initialized":
          case "initialized":
            break; // notification, no response
          case "tools/list":
            reply(id, { tools: TOOLS });
            break;
          case "tools/call": {
            const out = callTool(params?.name, params?.arguments ?? {});
            reply(id, { content: [{ type: "text", text: out }] });
            break;
          }
          case "ping":
            reply(id, {});
            break;
          default:
            if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
        }
      } catch (e) {
        if (id !== undefined) error(id, -32603, (e as Error).message);
      }
    });

    rl.on("close", () => resolve(0));
  });
}
