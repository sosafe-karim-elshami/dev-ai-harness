// Phase 8 — semantic links: an LLM pass that reads the team knowledge and the
// user's memory and infers relationships the structural pass can't see
// (MENTIONS, RELATES_TO, BLOCKS, DERIVED_FROM). Inferred edges are tagged
// INFERRED with a confidence score, exactly like graphify's EXTRACTED/INFERRED
// distinction, so callers can trust structure over inference.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, memoryDir } from "./paths.js";
import { runClaude } from "./claude.js";
import type { Graph, GEdge } from "./graph.js";

const ALLOWED = new Set(["MENTIONS", "RELATES_TO", "BLOCKS", "DERIVED_FROM", "DEPENDS_ON"]);

function collectDocs(): { name: string; text: string }[] {
  const docs: { name: string; text: string }[] = [];
  const dirs: [string, string][] = [];
  try { dirs.push(["knowledge", join(getHarnessRepo(), "knowledge")]); } catch {}
  dirs.push(["memory", memoryDir()]);
  for (const [prefix, dir] of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      docs.push({ name: `${prefix}:${f}`, text: readFileSync(join(dir, f), "utf8").slice(0, 4000) });
    }
  }
  return docs;
}

/** Run the inference pass and append INFERRED edges to `g` in place. Returns count added. */
export async function inferEdges(g: Graph): Promise<number> {
  const docs = collectDocs();
  if (!docs.length) return 0;

  const nodeList = g.nodes.map((n) => `${n.id}  (${n.type}: ${n.label})`).join("\n");
  const docBlob = docs.map((d) => `### ${d.name}\n${d.text}`).join("\n\n");

  const prompt = [
    "You are building a knowledge graph of a person's working context.",
    "Below is the current list of graph NODES (id, type, label), then the text of knowledge/memory documents.",
    "Infer relationships BETWEEN EXISTING NODE IDS ONLY. Do not invent node ids.",
    `Allowed edge types: ${[...ALLOWED].join(", ")}.`,
    "",
    "Output STRICT JSON only — an array of objects {\"from\":\"<node id>\",\"to\":\"<node id>\",\"type\":\"<edge type>\",\"score\":0.0-1.0,\"reason\":\"<short>\"}.",
    "No prose, no markdown fences. Empty array [] if nothing confident.",
    "",
    "NODES:",
    nodeList,
    "",
    "DOCUMENTS:",
    docBlob,
  ].join("\n");

  const result = await runClaude({
    prompt,
    harnessRepo: getHarnessRepo(),
    sessionId: randomUUID(),
    isNew: true,
    autonomous: true,
    quiet: true,
  });

  const proposed = parseEdges(result.text);
  const ids = new Set(g.nodes.map((n) => n.id));
  let added = 0;
  for (const e of proposed) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (!ALLOWED.has(e.type)) continue;
    if (g.edges.some((x) => x.from === e.from && x.to === e.to && x.type === e.type)) continue;
    const edge: GEdge = {
      from: e.from,
      to: e.to,
      type: e.type,
      confidence: "INFERRED",
      score: clamp(e.score),
      source: "llm-infer",
    };
    g.edges.push(edge);
    added++;
  }
  g.generatedAt = new Date().toISOString();
  return added;
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : 0.5;
  return Math.max(0, Math.min(1, v));
}

function parseEdges(text: string): { from: string; to: string; type: string; score: number }[] {
  // Be forgiving: pull the first JSON array out of the response.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
