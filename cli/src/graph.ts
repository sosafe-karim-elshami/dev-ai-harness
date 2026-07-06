// Context graph — maps the *person's* world as a typed property graph, the way
// graphify/GitNexus map a codebase, but over the person rather than the code.
//
// Storage: a single git-friendly graph.json (no database). Nodes are entities
// (Person, Team, Repo, JiraProject, SlackChannel, KnowledgeDoc, Memory, …);
// edges are typed and confidence-tagged (EXTRACTED = deterministic from the
// profile / wikilinks; INFERRED = added later by an LLM pass, see graph-infer).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { profilePath, graphPath, memoryDir, getHarnessRepo } from "./paths.js";

export type NodeType =
  | "Person" | "Team" | "Repo" | "JiraProject" | "Issue" | "PR"
  | "SlackChannel" | "KnowledgeDoc" | "Memory" | "Meeting" | "Concept";

export type EdgeConfidence = "EXTRACTED" | "INFERRED";

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, unknown>;
}
export interface GEdge {
  from: string;
  to: string;
  type: string; // MEMBER_OF, MAINTAINS, HAS_PROJECT, OWNS, REFERENCES, RELATES_TO, …
  confidence: EdgeConfidence;
  score?: number; // 0..1, for INFERRED edges
  source?: string;
}
export interface Graph {
  generatedAt: string;
  nodes: GNode[];
  edges: GEdge[];
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

// ── load / save ────────────────────────────────────────────────────────────
export function loadGraph(): Graph {
  if (!existsSync(graphPath())) return { generatedAt: "", nodes: [], edges: [] };
  return JSON.parse(readFileSync(graphPath(), "utf8")) as Graph;
}
export function saveGraph(g: Graph): void {
  writeFileSync(graphPath(), JSON.stringify(g, null, 2) + "\n", "utf8");
}

// ── builder helpers ─────────────────────────────────────────────────────────
class Builder {
  nodes = new Map<string, GNode>();
  edges: GEdge[] = [];
  node(n: GNode): string {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    return n.id;
  }
  edge(from: string, to: string, type: string, source: string): void {
    if (this.edges.some((e) => e.from === from && e.to === to && e.type === type)) return;
    this.edges.push({ from, to, type, confidence: "EXTRACTED", source });
  }
  graph(): Graph {
    return { generatedAt: new Date().toISOString(), nodes: [...this.nodes.values()], edges: this.edges };
  }
}

// ── structural build from profile.json + wikilinks ──────────────────────────
export function buildStructural(): Graph {
  const b = new Builder();
  const profile = existsSync(profilePath())
    ? (JSON.parse(readFileSync(profilePath(), "utf8")) as any)
    : {};

  let personId = "";
  if (profile.person?.name) {
    personId = b.node({
      id: `person:${profile.person.name}`,
      type: "Person",
      label: profile.person.name,
      meta: { role: profile.person.role, role_class: profile.person.role_class, github: profile.person.github_login },
    });
  }

  if (profile.team?.name) {
    const teamId = b.node({
      id: `team:${profile.team.name}`,
      type: "Team",
      label: profile.team.name,
      meta: { compass_alias: profile.team.compass_alias },
    });
    if (personId) b.edge(personId, teamId, "MEMBER_OF", "profile.team");

    for (const key of profile.jira?.project_keys ?? []) {
      const jp = b.node({ id: `jira:${key}`, type: "JiraProject", label: key });
      b.edge(teamId, jp, "HAS_PROJECT", "profile.jira");
      if (personId) b.edge(personId, jp, "WORKS_IN", "profile.jira");
    }
    for (const ch of profile.slack?.team_channels ?? []) {
      const cid = b.node({ id: `slack:${ch.name}`, type: "SlackChannel", label: ch.name, meta: { id: ch.id, kind: "team" } });
      b.edge(teamId, cid, "OWNS", "profile.slack");
    }
    for (const ch of profile.slack?.support_channels ?? []) {
      const cid = b.node({ id: `slack:${ch.name}`, type: "SlackChannel", label: ch.name, meta: { id: ch.id, kind: "support" } });
      b.edge(teamId, cid, "HAS_SUPPORT", "profile.slack");
    }
  }

  for (const repo of profile.repos ?? []) {
    const rid = b.node({
      id: `repo:${repo.full_name}`,
      type: "Repo",
      label: repo.full_name,
      meta: { role: repo.role, language: repo.primary_language },
    });
    if (personId) {
      const rel = repo.role === "maintainer" || repo.role === "codeowner" ? "MAINTAINS" : "CONTRIBUTES_TO";
      b.edge(personId, rid, rel, "profile.repos");
    }
  }

  // Knowledge + memory docs, with [[wikilink]] edges (the seed semantic links).
  indexDocs(b, "KnowledgeDoc", knowledgeDir());
  indexDocs(b, "Memory", memoryDir());

  return b.graph();
}

function knowledgeDir(): string {
  try { return join(getHarnessRepo(), "knowledge"); } catch { return ""; }
}

function indexDocs(b: Builder, type: NodeType, dir: string): void {
  if (!dir || !existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const id = `${type === "Memory" ? "memory" : "knowledge"}:${file}`;
    b.node({ id, type, label: file });
    const content = readFileSync(join(dir, file), "utf8");
    for (const m of content.matchAll(WIKILINK)) {
      const target = m[1].trim();
      const targetId = resolveWikilink(b, target);
      b.edge(id, targetId, "REFERENCES", "wikilink");
    }
  }
}

/** Map [[name]] to an existing node, else create a Concept placeholder. */
function resolveWikilink(b: Builder, name: string): string {
  for (const n of b.nodes.values()) {
    if (n.label === name || n.id.endsWith(`:${name}`) || n.id.endsWith(`:${name}.md`)) return n.id;
  }
  return b.node({ id: `concept:${name}`, type: "Concept", label: name, meta: { unresolved: true } });
}

// ── queries (graphify/GitNexus-style) ────────────────────────────────────────
export function query(g: Graph, text: string): GNode[] {
  const q = text.toLowerCase();
  return g.nodes.filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
}

export function findNode(g: Graph, ref: string): GNode | null {
  const r = ref.toLowerCase();
  return (
    g.nodes.find((n) => n.id.toLowerCase() === r) ??
    g.nodes.find((n) => n.label.toLowerCase() === r) ??
    g.nodes.find((n) => n.id.toLowerCase().endsWith(`:${r}`)) ??
    query(g, ref)[0] ??
    null
  );
}

export interface Neighbor { edge: GEdge; node: GNode; direction: "out" | "in"; }
export function neighbors(g: Graph, nodeId: string): Neighbor[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: Neighbor[] = [];
  for (const e of g.edges) {
    if (e.from === nodeId && byId.has(e.to)) out.push({ edge: e, node: byId.get(e.to)!, direction: "out" });
    if (e.to === nodeId && byId.has(e.from)) out.push({ edge: e, node: byId.get(e.from)!, direction: "in" });
  }
  return out;
}

/** BFS shortest path (undirected) between two nodes. */
export function shortestPath(g: Graph, fromId: string, toId: string): { node: GNode; via?: GEdge }[] | null {
  if (fromId === toId) return null;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, { id: string; edge: GEdge }[]>();
  for (const e of g.edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push({ id: e.to, edge: e });
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push({ id: e.from, edge: e });
  }
  const prev = new Map<string, { id: string; edge: GEdge }>();
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      prev.set(nb.id, { id: cur, edge: nb.edge });
      queue.push(nb.id);
    }
  }
  if (!prev.has(toId) && fromId !== toId) return null;
  const path: { node: GNode; via?: GEdge }[] = [];
  let at: string | undefined = toId;
  while (at) {
    const step = prev.get(at);
    path.unshift({ node: byId.get(at)!, via: step?.edge });
    at = step?.id;
  }
  return path[0]?.node.id === fromId ? path : null;
}
