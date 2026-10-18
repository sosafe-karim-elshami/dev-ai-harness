// index.md / MOC maintenance for the vault.
//
// The index lists what is live. After retention moves files, links to archived
// notes are pruned (per link, not per line), the `## Recent` block is regenerated
// between markers, knowledge entries are ordered by importance, and the lowest
// entries overflow to knowledge/index.md when the file passes its line budget.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { buildIndex, parseLinks, resolveTarget, type VaultIndex } from "./links.js";
import { ageDays, parseFrontmatter, type RetentionV2 } from "./retention.js";

const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

export interface IndexReport {
  prunedLinks: number;
  prunedLines: number;
  recentRegenerated: boolean;
  reordered: number;
  overflowed: number;
  lines: number;
  archiveIndexes: Record<string, number>;
}

/**
 * Remove archived notes' links from index.md. Disk-driven: a link is archived when
 * the live file is gone and an archive/ copy exists — so it repairs links left by
 * earlier runs and manual moves too.
 */
export function pruneIndex(root: string, apply: boolean, file = "index.md"): { links: number; lines: number } {
  const indexPath = join(root, file);
  if (!existsSync(indexPath)) return { links: 0, lines: 0 };
  const isArchived = (target: string): boolean => {
    const slash = target.lastIndexOf("/");
    if (slash === -1) return false;
    const folder = target.slice(0, slash);
    const name = target.slice(slash + 1);
    if (folder.endsWith("/archive") || folder === "archive" || folder.includes("/archive/")) return false;
    return !existsSync(join(root, folder, `${name}.md`)) && existsSync(join(root, folder, "archive", `${name}.md`));
  };
  const src = readFileSync(indexPath, "utf8").split("\n");
  const out: string[] = [];
  let links = 0;
  let dropped = 0;
  for (const line of src) {
    const present = [...line.matchAll(LINK)].map((x) => x[1]);
    const hits = present.filter(isArchived);
    if (!hits.length) {
      out.push(line);
      continue;
    }
    links += hits.length;
    if (hits.length === present.length) {
      dropped++;
      continue;
    }
    let next = line.replace(LINK, (whole, target: string) => (isArchived(target) ? "" : whole));
    next = next
      .replace(/\s*·\s*·\s*/g, " · ")
      .replace(/(^|\s)·\s*/g, "$1")
      .replace(/\s*·\s*$/g, "")
      .replace(/^(\s*[-*]\s*)[—–-]\s*/, "$1")
      .replace(/\s*[—–]\s*$/, "")
      .replace(/[ \t]+$/, "");
    out.push(next);
  }
  if ((links || dropped) && apply) writeFileSync(indexPath, out.join("\n"), "utf8");
  return { links, lines: dropped };
}

/** First meaningful body line of a note, for an index summary. */
function firstLine(abs: string): string {
  try {
    const { fm, body } = parseFrontmatter(readFileSync(abs, "utf8"));
    if (typeof fm.summary === "string") return fm.summary;
    for (const l of body.split("\n")) {
      const t = l.trim();
      if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("|") || t.startsWith("---") || t.startsWith("<!--")) continue;
      return t.replace(/\*\*/g, "").slice(0, 110);
    }
  } catch {
    /* ignore */
  }
  return "";
}

function liveDated(root: string, dir: string): string[] {
  const d = join(root, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}/.test(f) && !/compress-plan/.test(f))
    .sort()
    .reverse();
}

function livePeriod(root: string, dir: string): string[] {
  const d = join(root, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md") && f !== "index.md").sort().reverse();
}

/**
 * Regenerate the `## Recent` block between markers. Hand-written summaries on
 * lines that still point at a live note are kept; new entries get a generated one.
 */
export function regenerateRecent(root: string, pol: RetentionV2, apply: boolean): boolean {
  const indexPath = join(root, pol.index.file);
  if (!existsSync(indexPath)) return false;
  const [BEGIN, END] = pol.index.recent_markers;
  let text = readFileSync(indexPath, "utf8");
  const lines = text.split("\n");

  // Normalise the heading and make sure the markers exist.
  const hIdx = lines.findIndex((l) => /^## Recent\b/.test(l));
  if (hIdx === -1) return false;
  lines[hIdx] = pol.index.recent_section;
  let bIdx = lines.indexOf(BEGIN);
  let eIdx = lines.indexOf(END);
  if (bIdx === -1 || eIdx === -1 || eIdx < bIdx) {
    // Wrap the existing bullets (up to the next heading) in markers.
    let stop = hIdx + 1;
    while (stop < lines.length && !/^## /.test(lines[stop])) stop++;
    const block = lines.slice(hIdx + 1, stop);
    lines.splice(hIdx + 1, block.length, "", BEGIN, ...block.filter((l) => l.trim()), END, "");
    bIdx = lines.indexOf(BEGIN);
    eIdx = lines.indexOf(END);
  }
  const existing = new Map<string, string>();
  for (const l of lines.slice(bIdx + 1, eIdx)) {
    const m = LINK.exec(l);
    LINK.lastIndex = 0;
    if (m) existing.set(m[1], l);
  }

  const entries: string[] = [];
  const push = (rel: string, label: string): void => {
    const kept = existing.get(rel);
    if (kept) {
      entries.push(kept);
      return;
    }
    const summary = firstLine(join(root, `${rel}.md`));
    entries.push(`- [[${rel}|${label}]]${summary ? ` — ${summary}` : ""}`);
  };
  for (const f of liveDated(root, "digests").slice(0, pol.index.recent_count)) {
    const rel = `digests/${f.replace(/\.md$/, "")}`;
    push(rel, `📅 ${f.replace(/\.md$/, "")}`);
  }
  for (const f of livePeriod(root, "digests/weekly")) {
    const key = f.replace(/\.md$/, "");
    push(`digests/weekly/${key}`, `🗓 ${key}`);
  }
  for (const f of livePeriod(root, "digests/monthly")) {
    const key = f.replace(/\.md$/, "");
    push(`digests/monthly/${key}`, `📆 ${key}`);
  }

  const next = [...lines.slice(0, bIdx + 1), ...entries, ...lines.slice(eIdx)].join("\n");
  const changed = next !== text;
  if (changed && apply) writeFileSync(indexPath, next, "utf8");
  return changed;
}

interface Scored {
  line: string;
  score: number;
  rel: string | null;
}

function scoreLine(line: string, root: string, idx: VaultIndex, inbound: Map<string, number>, pol: RetentionV2, today: string): Scored {
  const m = LINK.exec(line);
  LINK.lastIndex = 0;
  if (!m) return { line, score: Number.POSITIVE_INFINITY, rel: null };
  const res = resolveTarget(m[1], pol.index.file, idx);
  if (!("rel" in res)) return { line, score: 0, rel: m[1] };
  const abs = idx.byPath.get(res.rel);
  let updated = today;
  let pinned = false;
  if (abs) {
    const { fm } = parseFrontmatter(readFileSync(abs, "utf8"));
    const u = typeof fm.updated === "string" ? fm.updated : typeof fm.date === "string" ? fm.date : "";
    if (/^\d{4}-\d{2}-\d{2}/.test(u)) updated = u.slice(0, 10);
    pinned = fm.pinned === true;
  }
  const age = Math.max(0, ageDays(updated, today));
  let score = ((inbound.get(res.rel) ?? 0) + 1) * Math.pow(2, -age / pol.index.importance.half_life_days);
  if (line.includes("⭐")) score *= pol.index.importance.star_boost;
  if (pinned) score *= pol.index.importance.pinned_boost;
  return { line, score, rel: res.rel };
}

/** Inbound link counts per rel path, excluding the index itself. */
function inboundCounts(root: string, idx: VaultIndex, indexFile: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [rel, abs] of idx.byPath) {
    if (`${rel}.md` === indexFile) continue;
    const seen = new Set<string>();
    for (const link of parseLinks(readFileSync(abs, "utf8"))) {
      const res = resolveTarget(link.target, rel, idx);
      if ("rel" in res && !seen.has(res.rel)) {
        seen.add(res.rel);
        counts.set(res.rel, (counts.get(res.rel) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Reorder knowledge bullets by importance within each bold sub-block, and overflow
 * the lowest-scoring ones to knowledge/index.md when the index passes its budget.
 */
export function orderAndOverflow(root: string, pol: RetentionV2, apply: boolean, today: string): { reordered: number; overflowed: number; lines: number } {
  const indexPath = join(root, pol.index.file);
  if (!existsSync(indexPath)) return { reordered: 0, overflowed: 0, lines: 0 };
  const idx = buildIndex(root);
  const inbound = inboundCounts(root, idx, pol.index.file);
  const text = readFileSync(indexPath, "utf8");
  const lines = text.split("\n");
  const kStart = lines.findIndex((l) => /^## Knowledge\b/.test(l));
  if (kStart === -1) return { reordered: 0, overflowed: 0, lines: lines.length };
  let kEnd = kStart + 1;
  while (kEnd < lines.length && !/^## /.test(lines[kEnd])) kEnd++;

  // Split the section into sub-blocks at **Bold** headers; sort bullets inside each.
  const section = lines.slice(kStart + 1, kEnd);
  const out: string[] = [];
  let reordered = 0;
  const all: Scored[] = [];
  let block: string[] = [];
  const flush = (): void => {
    const bullets = block.filter((l) => /^\s*[-*]\s/.test(l));
    const others = block.filter((l) => !/^\s*[-*]\s/.test(l));
    const scored = bullets.map((l) => scoreLine(l, root, idx, inbound, pol, today));
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    if (sorted.some((s, i) => s.line !== scored[i].line)) reordered++;
    all.push(...sorted);
    // Non-bullet lines (header, blank) keep their position: header first, then bullets, then the trailing blank(s).
    const header = others.filter((l) => l.trim());
    const blanks = others.filter((l) => !l.trim());
    out.push(...header, ...sorted.map((s) => s.line), ...blanks);
    block = [];
  };
  for (const l of section) {
    if (/^\*\*.+\*\*\s*$/.test(l) && block.length) flush();
    block.push(l);
  }
  if (block.length) flush();

  let next = [...lines.slice(0, kStart + 1), ...out, ...lines.slice(kEnd)];

  // Overflow: drop the lowest-scoring bullets until under budget.
  let overflowed = 0;
  const overflowRel = pol.index.overflow_to;
  if (next.length > pol.index.max_index_lines) {
    const candidates = all.filter((s) => s.rel && Number.isFinite(s.score)).sort((a, b) => a.score - b.score);
    const moved: string[] = [];
    while (next.length > pol.index.max_index_lines && candidates.length) {
      const victim = candidates.shift()!;
      const at = next.indexOf(victim.line);
      if (at === -1) continue;
      next.splice(at, 1);
      moved.push(victim.line);
      overflowed++;
    }
    if (moved.length) {
      // Pointer line at the end of the Knowledge section.
      let end = next.findIndex((l) => /^## Knowledge\b/.test(l)) + 1;
      while (end < next.length && !/^## /.test(next[end])) end++;
      const pointer = `- … and ${moved.length} more in [[${overflowRel.replace(/\.md$/, "")}]]`;
      const existingPtr = next.findIndex((l, i) => i < end && /more in \[\[knowledge\/index\]\]/.test(l));
      if (existingPtr !== -1) next[existingPtr] = pointer.replace(/\d+ more/, `${moved.length + (Number(/(\d+) more/.exec(next[existingPtr])?.[1]) || 0)} more`);
      else next.splice(end, 0, pointer);
      if (apply) {
        const ovPath = join(root, overflowRel);
        mkdirSync(posix.dirname(ovPath), { recursive: true });
        const existing = existsSync(ovPath) ? readFileSync(ovPath, "utf8") : "---\ntitle: Knowledge — overflow index\ntype: moc\ntags: [harness, moc]\npinned: true\n---\n\n# Knowledge — overflow index\n\n> Entries moved here by `harness compress` when index.md passed its line budget. Still live, still linked.\n";
        const have = new Set([...existing.matchAll(LINK)].map((m) => m[1]));
        const add = moved.filter((l) => {
          const m = LINK.exec(l);
          LINK.lastIndex = 0;
          return m && !have.has(m[1]);
        });
        writeFileSync(ovPath, existing.replace(/\s*$/, "\n") + add.join("\n") + "\n", "utf8");
      }
    }
  }

  const joined = next.join("\n");
  if (joined !== text && apply) writeFileSync(indexPath, joined, "utf8");
  return { reordered, overflowed, lines: next.length };
}

/** Generate `<folder>/archive/index.md`, grouping subfolders (weekly/) under their own heading. */
export function writeArchiveIndex(root: string, folder: string, apply: boolean): number {
  const dir = join(root, folder, "archive");
  if (!existsSync(dir)) return 0;
  const top: string[] = [];
  const subs: Record<string, string[]> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const files = readdirSync(join(dir, e.name)).filter((f) => f.endsWith(".md") && f !== "index.md").sort().reverse();
      if (files.length) subs[e.name] = files;
    } else if (e.isFile() && e.name.endsWith(".md") && e.name !== "index.md") top.push(e.name);
  }
  top.sort().reverse();
  const total = top.length + Object.values(subs).reduce((a, b) => a + b.length, 0);
  if (!total) return 0;
  const title = folder.charAt(0).toUpperCase() + folder.slice(1);
  const body = [
    "---",
    `title: ${title} — Archive`,
    "type: moc",
    "tags: [harness, archive]",
    "pinned: true",
    "---",
    "",
    `# ${folder} — archive`,
    "",
    "> Retired from the live folder by `harness compress` per `definitions/retention.json`. Nothing here was deleted.",
    "",
    ...top.map((f) => `- [[${folder}/archive/${f.replace(/\.md$/, "")}]]`),
    ...Object.entries(subs).flatMap(([sub, files]) => ["", `## ${sub}`, "", ...files.map((f) => `- [[${folder}/archive/${sub}/${f.replace(/\.md$/, "")}]]`)]),
    "",
  ].join("\n");
  if (apply) writeFileSync(join(dir, "index.md"), body, "utf8");
  return total;
}

export function updateIndexes(root: string, pol: RetentionV2, apply: boolean, today: string, folders: Iterable<string>): IndexReport {
  const pruned = pol.index.prune_links ? pruneIndex(root, apply, pol.index.file) : { links: 0, lines: 0 };
  const recent = regenerateRecent(root, pol, apply);
  const ordered = orderAndOverflow(root, pol, apply, today);
  const archiveIndexes: Record<string, number> = {};
  for (const f of new Set(folders)) archiveIndexes[f] = writeArchiveIndex(root, f, apply);
  return { prunedLinks: pruned.links, prunedLines: pruned.lines, recentRegenerated: recent, reordered: ordered.reordered, overflowed: ordered.overflowed, lines: ordered.lines, archiveIndexes };
}
