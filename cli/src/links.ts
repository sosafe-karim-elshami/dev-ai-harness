// Wikilink safety for the vault.
//
// The vault's convention is full-path links (`[[digests/2026-07-21]]`), which break
// the moment a file moves. Obsidian repairs them for moves made inside the app;
// this module does the same for moves made by `harness archive` / `harness compress`.
// Bare-basename normalisation is deliberately NOT the default: `index.md` exists at
// the root, in memory/, and in every archive/, so bare links would be ambiguous.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

export interface WikiLink {
  raw: string;
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  /** Offsets into the file text, so a rewrite can splice in place. */
  start: number;
  end: number;
  line: number;
}

export interface VaultIndex {
  /** rel path without `.md` → absolute path */
  byPath: Map<string, string>;
  /** basename without `.md` → rel paths that carry it */
  byBasename: Map<string, string[]>;
}

export type Resolution =
  | { kind: "exact"; rel: string }
  | { kind: "relative"; rel: string }
  | { kind: "basename"; rel: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "pre-archive"; rel: string }
  | { kind: "dangling" };

const LINK_RE = /(!?)\[\[([^\]|#]+?)(?:#([^\]|]+))?(?:\|([^\]]*))?\]\]/g;
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

export const stripMd = (p: string): string => p.replace(/\.md$/i, "");

/** Every .md file under root as a posix rel path, recursively, skipping tool dirs. */
export function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(root, "");
  return out.sort();
}

export function buildIndex(root: string): VaultIndex {
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string[]>();
  for (const rel of listMarkdown(root)) {
    const key = stripMd(rel);
    byPath.set(key, join(root, rel));
    const base = posix.basename(key);
    byBasename.set(base, [...(byBasename.get(base) ?? []), key]);
  }
  return { byPath, byBasename };
}

/**
 * Parse wikilinks, skipping fenced and inline code. Offsets are into the original
 * text; code spans are blanked (not removed) so positions stay stable.
 */
export function parseLinks(md: string): WikiLink[] {
  const out: WikiLink[] = [];
  const lines = md.split("\n");
  let offset = 0;
  let inFence = false;
  lines.forEach((line, i) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;
    if (!inFence && !fence) {
      const masked = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
      for (const m of masked.matchAll(LINK_RE)) {
        const [raw, bang, target, heading, alias] = m;
        out.push({
          raw,
          target: target.trim(),
          heading: heading?.trim(),
          alias: alias,
          embed: bang === "!",
          start: offset + (m.index ?? 0),
          end: offset + (m.index ?? 0) + raw.length,
          line: i + 1,
        });
      }
    }
    offset += line.length + 1;
  });
  return out;
}

/** Where `folder/name` would live if it had been archived in place. */
function archivedVariant(rel: string): string | null {
  const slash = rel.lastIndexOf("/");
  if (slash === -1) return null;
  const dir = rel.slice(0, slash);
  if (dir.endsWith("/archive") || dir === "archive") return null;
  return `${dir}/archive/${rel.slice(slash + 1)}`;
}

export function resolveTarget(target: string, fromRel: string, idx: VaultIndex): Resolution {
  const t = stripMd(target.replace(/\\/g, "/").trim());
  if (!t) return { kind: "dangling" };
  if (idx.byPath.has(t)) return { kind: "exact", rel: t };
  if (t.includes("/")) {
    const rel = posix.normalize(posix.join(posix.dirname(fromRel), t));
    if (idx.byPath.has(rel)) return { kind: "relative", rel };
    const arch = archivedVariant(t);
    if (arch && idx.byPath.has(arch)) return { kind: "pre-archive", rel: arch };
    // A bare name written with a stray folder (e.g. `../x`) that still matches one basename.
    const base = posix.basename(t);
    const cands = idx.byBasename.get(base) ?? [];
    if (cands.length === 1 && t.startsWith(".")) return { kind: "relative", rel: cands[0] };
    return { kind: "dangling" };
  }
  const cands = idx.byBasename.get(t) ?? [];
  if (cands.length === 1) return { kind: "basename", rel: cands[0] };
  if (cands.length > 1) return { kind: "ambiguous", candidates: cands };
  return { kind: "dangling" };
}

export interface RewriteReport {
  filesTouched: number;
  linksRewritten: number;
  perFile: Record<string, number>;
}

function splice(text: string, edits: Array<{ start: number; end: number; next: string }>): string {
  let out = "";
  let cursor = 0;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, e.start) + e.next;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

function render(link: WikiLink, newTarget: string): string {
  const head = link.heading ? `#${link.heading}` : "";
  const alias = link.alias !== undefined ? `|${link.alias}` : "";
  return `${link.embed ? "!" : ""}[[${newTarget}${head}${alias}]]`;
}

/**
 * Rewrite every link that resolves to a file in `moves` so it points at the new
 * location, and turn relative links inside moved files into full paths (a `../`
 * link does not survive its own file moving). Called BEFORE the rename with the
 * pre-move index, so resolution sees the old layout.
 */
export function rewriteForMoves(
  root: string,
  moves: Array<{ from: string; to: string }>,
  apply: boolean,
  idx: VaultIndex = buildIndex(root),
): RewriteReport {
  const map = new Map(moves.map((m) => [stripMd(m.from), stripMd(m.to)]));
  const movingFiles = new Set(moves.map((m) => stripMd(m.from)));
  const report: RewriteReport = { filesTouched: 0, linksRewritten: 0, perFile: {} };

  for (const [rel, abs] of idx.byPath) {
    const text = readFileSync(abs, "utf8");
    const edits: Array<{ start: number; end: number; next: string }> = [];
    for (const link of parseLinks(text)) {
      const res = resolveTarget(link.target, rel, idx);
      if (!("rel" in res)) continue;
      const moved = map.get(res.rel);
      if (moved) {
        edits.push({ start: link.start, end: link.end, next: render(link, moved) });
      } else if (movingFiles.has(rel) && res.kind === "relative") {
        edits.push({ start: link.start, end: link.end, next: render(link, res.rel) });
      }
    }
    if (!edits.length) continue;
    report.filesTouched++;
    report.linksRewritten += edits.length;
    report.perFile[rel] = edits.length;
    if (apply) writeFileSync(abs, splice(text, edits), "utf8");
  }
  return report;
}

/** Re-point links that still name a note's pre-archive path. Disk-driven and idempotent. */
export function repairPreArchive(root: string, apply: boolean): RewriteReport {
  const idx = buildIndex(root);
  const report: RewriteReport = { filesTouched: 0, linksRewritten: 0, perFile: {} };
  for (const [rel, abs] of idx.byPath) {
    const text = readFileSync(abs, "utf8");
    const edits: Array<{ start: number; end: number; next: string }> = [];
    for (const link of parseLinks(text)) {
      const res = resolveTarget(link.target, rel, idx);
      if (res.kind === "pre-archive") edits.push({ start: link.start, end: link.end, next: render(link, res.rel) });
    }
    if (!edits.length) continue;
    report.filesTouched++;
    report.linksRewritten += edits.length;
    report.perFile[rel] = edits.length;
    if (apply) writeFileSync(abs, splice(text, edits), "utf8");
  }
  return report;
}

export interface LinkRef {
  file: string;
  line: number;
  target: string;
  candidates?: string[];
}

export interface LinkReport {
  total: number;
  exact: number;
  relative: LinkRef[];
  basename: number;
  ambiguous: LinkRef[];
  preArchive: LinkRef[];
  dangling: LinkRef[];
  duplicateBasenames: Record<string, string[]>;
}

export function report(root: string): LinkReport {
  const idx = buildIndex(root);
  const r: LinkReport = { total: 0, exact: 0, relative: [], basename: 0, ambiguous: [], preArchive: [], dangling: [], duplicateBasenames: {} };
  for (const [base, rels] of idx.byBasename) if (rels.length > 1) r.duplicateBasenames[base] = rels;
  for (const [rel, abs] of idx.byPath) {
    for (const link of parseLinks(readFileSync(abs, "utf8"))) {
      r.total++;
      const res = resolveTarget(link.target, rel, idx);
      const ref: LinkRef = { file: rel, line: link.line, target: link.target };
      switch (res.kind) {
        case "exact": r.exact++; break;
        case "basename": r.basename++; break;
        case "relative": r.relative.push(ref); break;
        case "ambiguous": r.ambiguous.push({ ...ref, candidates: res.candidates }); break;
        case "pre-archive": r.preArchive.push(ref); break;
        case "dangling": r.dangling.push(ref); break;
      }
    }
  }
  return r;
}

/**
 * Opt-in: rewrite full-path links to bare basenames. Refuses when any basename is
 * duplicated, because a bare link would then be ambiguous — which is exactly why
 * full paths stay canonical.
 */
export function normalizeToBare(root: string, apply: boolean): RewriteReport | { refused: string[] } {
  const idx = buildIndex(root);
  const dupes = [...idx.byBasename.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
  if (dupes.length) return { refused: dupes };
  const rep: RewriteReport = { filesTouched: 0, linksRewritten: 0, perFile: {} };
  for (const [rel, abs] of idx.byPath) {
    const text = readFileSync(abs, "utf8");
    const edits: Array<{ start: number; end: number; next: string }> = [];
    for (const link of parseLinks(text)) {
      const res = resolveTarget(link.target, rel, idx);
      if (res.kind === "exact" && link.target.includes("/")) {
        edits.push({ start: link.start, end: link.end, next: render(link, posix.basename(res.rel)) });
      }
    }
    if (!edits.length) continue;
    rep.filesTouched++;
    rep.linksRewritten += edits.length;
    rep.perFile[rel] = edits.length;
    if (apply) writeFileSync(abs, splice(text, edits), "utf8");
  }
  return rep;
}

/** `harness links report | repair [--apply] | normalize [--apply]` */
export function linksCli(argv: string[], vault: string, log: (s: string) => void): number {
  const sub = argv[0] ?? "report";
  const apply = argv.includes("--apply");
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    log(`vault not found: ${vault}`);
    return 1;
  }
  if (sub === "report") {
    const r = report(vault);
    log(`${r.total} links: ${r.exact} exact, ${r.basename} by basename, ${r.relative.length} relative, ${r.preArchive.length} pre-archive (repairable), ${r.ambiguous.length} ambiguous, ${r.dangling.length} dangling`);
    const dupes = Object.keys(r.duplicateBasenames);
    if (dupes.length) log(`duplicate basenames (${dupes.length}): ${dupes.slice(0, 8).join(", ")}${dupes.length > 8 ? ", …" : ""}`);
    for (const d of r.dangling.slice(0, 10)) log(`  dangling  ${d.file}:${d.line} → [[${d.target}]]`);
    if (r.dangling.length > 10) log(`  … ${r.dangling.length - 10} more dangling`);
    return 0;
  }
  if (sub === "repair") {
    const r = repairPreArchive(vault, apply);
    log(`${apply ? "Repaired" : "Would repair"} ${r.linksRewritten} pre-archive link(s) in ${r.filesTouched} file(s).${apply ? "" : " Re-run with --apply."}`);
    return 0;
  }
  if (sub === "normalize") {
    const r = normalizeToBare(vault, apply);
    if ("refused" in r) {
      log(`Refused: ${r.refused.length} duplicate basename(s) would make bare links ambiguous: ${r.refused.slice(0, 8).join(", ")}`);
      return 1;
    }
    log(`${apply ? "Normalized" : "Would normalize"} ${r.linksRewritten} link(s) in ${r.filesTouched} file(s).`);
    return 0;
  }
  log("Usage: harness links report | repair [--apply] | normalize [--apply]  [--vault PATH]");
  return 1;
}
