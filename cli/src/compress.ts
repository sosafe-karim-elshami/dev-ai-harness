// `harness compress` — retention v2: archive, roll up, distil. Never deletes.
//
// Phases: plan → summarize (LLM, tool-less) → write → move (links rewritten first)
// → index → audit. Dry run unless --apply. `harness archive` is the rule-only
// subset (--only archive): no LLM, no rollups, just aged/expired/superseded moves.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { getHarnessRepo, readConfig, compressCacheDir, ensureDir } from "./paths.js";
import { audit } from "./audit.js";
import { appendRun } from "./observability.js";
import { runClaudeStructured, type StructuredRunner } from "./claude.js";
import { tierToModel } from "./registry.js";
import { buildIndex, rewriteForMoves, stripMd } from "./links.js";
import { updateIndexes } from "./vault-index.js";
import { nearDuplicates } from "./similarity.js";
import { readLastRuns } from "./launchd.js";
import {
  ageDays, dateChain, forcedOut, isExempt, isoWeek, loadPolicy, monthKey, parseFrontmatter, readNote,
  resolveUpdated, scanFolder, sha256, type FolderPolicy, type Note, type RetentionV2, type Rung,
} from "./retention.js";
import { banner, c, fail, info, ok, warn } from "./ui.js";

// ---------- plan types ----------

export interface ArchiveMove {
  folder: string;
  rel: string;
  to: string;
  reason: "aged" | "expired" | "superseded" | "single-child" | "unmatched";
  date: string | null;
}

export interface RollupJob {
  kind: "rollup";
  folder: string;
  rung: Rung;
  period: { key: string; start: string; end: string };
  children: Note[];
  outRel: string;
  childrenHash: string;
  status: "new" | "noop" | "stale";
}

export interface DistillJob {
  kind: "distill";
  folder: string;
  stem: string;
  period: { key: string; start: string; end: string };
  children: Note[];
  outRel: string;
  childrenHash: string;
  status: "new" | "noop" | "stale";
  fp: FolderPolicy;
}

export interface KnowledgeCandidate {
  note: Note;
  reasons: string[];
  updated: string;
}

export interface KnowledgeCluster {
  key: string;
  notes: KnowledgeCandidate[];
}

export interface CompressPlan {
  archive: ArchiveMove[];
  rollups: RollupJob[];
  distills: DistillJob[];
  knowledge: KnowledgeCluster[];
  pendingRollup: string[];
  exempt: string[];
  budgetOverruns: string[];
}

export interface CompressOptions {
  apply: boolean;
  only?: "archive";
  folder?: string;
  since?: string;
  vault: string;
  harnessRepo: string;
  maxBudgetUsd: number;
  force: boolean;
  knowledge: boolean;
  today: string;
  runner?: StructuredRunner;
  log?: (s: string) => void;
}

// ---------- helpers ----------

const childrenHashOf = (notes: Note[]): string =>
  "sha256:" + sha256(notes.map((n) => `${n.rel}\t${n.sha256}`).sort().join("\n"));

const archiveDest = (rel: string, archiveTo?: string): string => {
  const base = posix.basename(rel);
  if (archiveTo) return `${archiveTo}/${base}`;
  return `${posix.dirname(rel)}/archive/${base}`;
};

function existingRollup(vault: string, outRel: string): { hash: string | null } | null {
  const abs = join(vault, outRel);
  if (!existsSync(abs)) return null;
  const { fm } = parseFrontmatter(readFileSync(abs, "utf8"));
  return { hash: typeof fm.children_hash === "string" ? fm.children_hash : null };
}

const statusFor = (vault: string, outRel: string, hash: string): "new" | "noop" | "stale" => {
  const ex = existingRollup(vault, outRel);
  if (!ex) return "new";
  return ex.hash === hash ? "noop" : "stale";
};

// ---------- checkbox items (deterministic) ----------

export interface Item {
  key: string;
  text: string;
  checked: boolean;
  section: string;
  owner: string | null;
  childRel: string;
  childDate: string;
}

const TICKET = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Normalise a checkbox line into a stable key so carried-forward copies dedupe. */
export function itemKey(text: string): string {
  let t = text;
  t = t.replace(/\*\(.*?\)\*/g, ""); // *(carried from …)*
  t = t.replace(/\s[—–-]\s*(due|overdue|since|first seen)\b.*$/i, "");
  t = t.replace(/\*\*/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{23F0}\u{FE0F}]/gu, "");
  t = t.replace(/\[(prep|carry|carried|team)\]/gi, "");
  t = t.toLowerCase().replace(/\s+/g, " ").trim();
  const m = TICKET.exec(text);
  if (m) return `ticket:${m[1].toLowerCase()}:${t.replace(/[^a-z0-9 ]/g, "").slice(0, 40).trim()}`;
  return t.replace(/[^a-z0-9 ]/g, "").slice(0, 80).trim();
}

export function parseItems(note: Note): Item[] {
  const out: Item[] = [];
  let section = "";
  for (const line of note.body.split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    const owner = /^\[([^\]]+)\]/.exec(text)?.[1] ?? null;
    out.push({ key: itemKey(text), text, checked: m[1] !== " ", section, owner: owner && !/^(prep|carry|carried)$/i.test(owner) ? owner : null, childRel: stripMd(note.rel), childDate: note.date ?? "" });
  }
  return out;
}

export interface ItemLedger {
  open: Array<Item & { id: string; firstSeen: string }>;
  closed: Array<Item & { closedOn: string }>;
  dropped: Array<Item & { lastSeen: string }>;
  team: Array<Item & { id: string; firstSeen: string }>;
}

/** Partition items across a period's children (oldest → newest). The last child is authoritative for "still open". */
export function ledger(children: Note[], historyFirstSeen: Map<string, string> = new Map()): ItemLedger {
  const sorted = [...children].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const firstSeen = new Map<string, string>(historyFirstSeen);
  const closed = new Map<string, Item & { closedOn: string }>();
  const lastSeen = new Map<string, Item>();
  for (const n of sorted) {
    for (const it of parseItems(n)) {
      if (!firstSeen.has(it.key) || it.childDate < (firstSeen.get(it.key) ?? "")) firstSeen.set(it.key, it.childDate);
      if (it.checked && !closed.has(it.key)) closed.set(it.key, { ...it, closedOn: it.childDate });
      lastSeen.set(it.key, it);
    }
  }
  const last = sorted[sorted.length - 1];
  const lastOpen = last ? parseItems(last).filter((i) => !i.checked) : [];
  const seen = new Set<string>();
  const open: ItemLedger["open"] = [];
  const team: ItemLedger["team"] = [];
  let n = 0;
  for (const it of lastOpen) {
    if (seen.has(it.key) || closed.has(it.key)) continue;
    seen.add(it.key);
    const row = { ...it, id: `i${String(++n).padStart(2, "0")}`, firstSeen: firstSeen.get(it.key) ?? it.childDate };
    if (/team/i.test(it.section) && it.owner) team.push(row);
    else open.push(row);
  }
  const dropped: ItemLedger["dropped"] = [];
  for (const [key, it] of lastSeen) {
    if (seen.has(key) || closed.has(key) || it.checked) continue;
    dropped.push({ ...it, lastSeen: it.childDate });
  }
  return { open, closed: [...closed.values()], dropped, team };
}

/** First-seen dates from archived dailies, so an item carried since August keeps its real age. */
function historyFirstSeen(vault: string, folder: string): Map<string, string> {
  const map = new Map<string, string>();
  const dir = join(vault, folder, "archive");
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || !/^\d{4}-\d{2}-\d{2}/.test(f)) continue;
    const n = readNote(vault, `${folder}/archive/${f}`, folder, ["filename-prefix"]);
    for (const it of parseItems(n)) {
      const d = it.childDate;
      if (!map.has(it.key) || d < (map.get(it.key) ?? "")) map.set(it.key, d);
    }
  }
  return map;
}

// ---------- planning ----------

export function planAll(opts: CompressOptions, pol: RetentionV2): CompressPlan {
  const { vault, today } = opts;
  const plan: CompressPlan = { archive: [], rollups: [], distills: [], knowledge: [], pendingRollup: [], exempt: [], budgetOverruns: [] };

  for (const [folder, fp] of Object.entries(pol.folders)) {
    if (opts.folder && opts.folder !== folder) continue;
    if (fp.strategy === "keep") continue;
    const chain = dateChain(pol, fp);
    const notes = scanFolder(vault, folder, fp, chain);
    const live: Note[] = [];
    for (const n of notes) {
      const why = isExempt(n, pol, fp, today);
      const forced = forcedOut(n, pol, today);
      if (forced) {
        plan.archive.push({ folder, rel: n.rel, to: archiveDest(n.rel, fp.archive_to), reason: forced, date: n.date });
        continue;
      }
      if (why) {
        plan.exempt.push(`${n.rel} (${why})`);
        continue;
      }
      live.push(n);
    }
    if (fp.budgets?.max_live_files && live.length > fp.budgets.max_live_files) {
      plan.budgetOverruns.push(`${folder}/: ${live.length} live notes, budget ${fp.budgets.max_live_files}`);
    }

    if (fp.strategy === "archive") {
      const cutoff = fp.after_days ?? pol.default_after_days;
      for (const n of live) {
        if (!n.date) {
          plan.exempt.push(`${n.rel} (no date)`);
          continue;
        }
        if (ageDays(n.date, today) >= cutoff) plan.archive.push({ folder, rel: n.rel, to: archiveDest(n.rel), reason: "aged", date: n.date });
      }
    } else if (fp.strategy === "rollup") {
      planRollups(opts, pol, folder, fp, live, plan);
    } else if (fp.strategy === "distill" && fp.group_by === "stem") {
      planMeetings(opts, pol, folder, fp, live, plan);
    } else if (fp.strategy === "distill") {
      planKnowledge(opts, pol, folder, fp, live, plan);
    }
  }

  plan.archive.sort((a, b) => a.rel.localeCompare(b.rel));
  return plan;
}

function planRollups(opts: CompressOptions, pol: RetentionV2, folder: string, fp: FolderPolicy, live: Note[], plan: CompressPlan): void {
  const { vault, today } = opts;
  const rungs = fp.ladder ?? [];
  const fallbackCutoff = fp.after_days ?? pol.default_after_days;
  const filenameRe = fp.match?.filename ? new RegExp(fp.match.filename) : null;

  // Rung 0: dated notes in the live folder → weekly.
  const dated = live.filter((n) => n.date && (!filenameRe || filenameRe.test(posix.basename(n.rel))));
  const undated = live.filter((n) => !dated.includes(n));
  for (const n of undated) plan.exempt.push(`${n.rel} (no date)`);

  const r0 = rungs[0];
  const byWeek = new Map<string, Note[]>();
  if (r0) for (const n of dated) {
    const w = r0.period === "iso-week" ? isoWeek(n.date!) : monthKey(n.date!);
    byWeek.set(w.key, [...(byWeek.get(w.key) ?? []), n]);
  }
  const inRollup = new Set<string>();
  if (r0) for (const [key, children] of byWeek) {
    const p = r0.period === "iso-week" ? isoWeek(children[0].date!) : monthKey(children[0].date!);
    const eligible = ageDays(p.end, today) >= r0.after_days;
    if (!eligible) continue;
    if (children.length < r0.min_children) continue; // falls through to plain archive after fallbackCutoff
    const outRel = `${r0.out_dir}/${key}.md`;
    const hash = childrenHashOf(children);
    const status = statusFor(vault, outRel, hash);
    plan.rollups.push({ kind: "rollup", folder, rung: r0, period: p, children, outRel, childrenHash: hash, status });
    for (const n of children) inRollup.add(n.rel);
  }
  for (const n of dated) {
    if (inRollup.has(n.rel)) continue;
    if (ageDays(n.date!, today) >= fallbackCutoff) plan.archive.push({ folder, rel: n.rel, to: archiveDest(n.rel), reason: "single-child", date: n.date });
  }

  // Rung 1: weekly rollups → monthly.
  const r1 = rungs[1];
  if (r1 && r0) {
    const wdir = join(vault, r0.out_dir);
    if (existsSync(wdir)) {
      const weeklies = readdirSync(wdir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => readNote(vault, `${r0.out_dir}/${f}`, folder, ["frontmatter:date", "mtime"]))
        .filter((n) => typeof n.fm.period_end === "string");
      const byMonth = new Map<string, Note[]>();
      for (const n of weeklies) {
        const start = String(n.fm.period_start ?? n.fm.period_end);
        const m = monthKey(start);
        byMonth.set(m.key, [...(byMonth.get(m.key) ?? []), n]);
      }
      for (const [key, children] of byMonth) {
        const m = monthKey(String(children[0].fm.period_start ?? children[0].fm.period_end));
        if (ageDays(m.end, opts.today) < r1.after_days) continue;
        if (children.length < r1.min_children) continue;
        const outRel = `${r1.out_dir}/${key}.md`;
        const hash = childrenHashOf(children);
        plan.rollups.push({ kind: "rollup", folder, rung: r1, period: m, children, outRel, childrenHash: hash, status: statusFor(vault, outRel, hash) });
      }
    }
  }
}

function planMeetings(opts: CompressOptions, pol: RetentionV2, folder: string, fp: FolderPolicy, live: Note[], plan: CompressPlan): void {
  const { vault, today } = opts;
  const cutoff = fp.after_days ?? pol.default_after_days;
  const stemRe = new RegExp(fp.stem_pattern ?? "^\\d{4}-\\d{2}-\\d{2}-(.+)$");
  const groups = new Map<string, Note[]>();
  for (const n of live) {
    if (!n.date) {
      plan.exempt.push(`${n.rel} (no date)`);
      continue;
    }
    if (ageDays(n.date, today) < cutoff) continue;
    const base = stripMd(posix.basename(n.rel));
    const stem = stemRe.exec(base)?.[1] ?? base.replace(/^\d{4}-\d{2}-\d{2}-?/, "") ?? "meeting";
    const m = monthKey(n.date);
    const key = `${stem}|${m.key}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  for (const [key, children] of groups) {
    const [stem, month] = key.split("|");
    const m = monthKey(children[0].date!);
    const wholeMonthPast = ageDays(m.end, today) >= cutoff;
    if (children.length >= 2 && wholeMonthPast) {
      const outRel = `${fp.out_dir}/${stem}-${month}.md`;
      const hash = childrenHashOf(children);
      plan.distills.push({ kind: "distill", folder, stem, period: m, children, outRel, childrenHash: hash, status: statusFor(vault, outRel, hash), fp });
    } else if (children.length >= 2) {
      for (const n of children) plan.pendingRollup.push(`${n.rel} (waits for ${m.key} to close)`);
    } else {
      for (const n of children) plan.archive.push({ folder, rel: n.rel, to: archiveDest(n.rel), reason: "single-child", date: n.date });
    }
  }
}

function planKnowledge(opts: CompressOptions, pol: RetentionV2, folder: string, fp: FolderPolicy, live: Note[], plan: CompressPlan): void {
  const { today } = opts;
  const chain = fp.updated_from ?? ["frontmatter:updated", "frontmatter:date", "mtime"];
  const ticketRe = fp.time_bound ? new RegExp(fp.time_bound.ticket_key_pattern, "i") : null;
  const cands = new Map<string, KnowledgeCandidate>();
  const add = (n: Note, reason: string): void => {
    const c = cands.get(n.rel) ?? { note: n, reasons: [], updated: resolveUpdated(n, chain) };
    if (!c.reasons.includes(reason)) c.reasons.push(reason);
    cands.set(n.rel, c);
  };
  for (const n of live) {
    const updated = resolveUpdated(n, chain);
    const age = ageDays(updated, today);
    const base = stripMd(posix.basename(n.rel));
    const type = typeof n.fm.type === "string" ? n.fm.type : "";
    const timeBound = (ticketRe && ticketRe.test(base)) || (fp.time_bound?.frontmatter_types ?? []).includes(type);
    if (timeBound && fp.time_bound && age >= fp.time_bound.stale_after_days) add(n, `time-bound, ${age}d since update`);
    else if (fp.stale_after_days && age >= fp.stale_after_days) add(n, `stale, ${age}d since update`);
  }
  if (fp.near_dupe_jaccard) {
    for (const pair of nearDuplicates(live, fp.near_dupe_jaccard)) {
      add(pair.a, `near-duplicate of ${pair.b.rel} (${pair.score})`);
      add(pair.b, `near-duplicate of ${pair.a.rel} (${pair.score})`);
    }
  }
  // Cluster by ticket key in the basename, then by near-dupe partner, else singleton.
  const clusters = new Map<string, KnowledgeCandidate[]>();
  for (const cnd of cands.values()) {
    const base = stripMd(posix.basename(cnd.note.rel));
    const tk = ticketRe?.exec(base)?.[0]?.toLowerCase();
    const partner = cnd.reasons.find((r) => r.startsWith("near-duplicate of "))?.slice("near-duplicate of ".length).split(" ")[0];
    const key = tk ?? (partner ? [cnd.note.rel, partner].sort()[0] : cnd.note.rel);
    clusters.set(key, [...(clusters.get(key) ?? []), cnd]);
  }
  for (const [key, notes] of clusters) plan.knowledge.push({ key, notes });
  plan.knowledge.sort((a, b) => b.notes.length - a.notes.length || a.key.localeCompare(b.key));
}

// ---------- rendering ----------

interface RollupLLM {
  summary: string;
  themes: Array<{ title: string; detail: string; evidence: string[] }>;
  decisions: Array<{ text: string; source: string; ticket?: string }>;
  docs_to_update: Array<{ doc: string; why: string; source: string }>;
  merge_groups: Array<{ keep: string; merge: string[] }>;
}

const link = (rel: string): string => `[[${stripMd(rel)}]]`;
const fmList = (xs: string[]): string => `[${xs.join(", ")}]`;

function buildRollupStdin(job: RollupJob, led: ItemLedger): string {
  const table = ["OPEN-ITEM TABLE (id | first seen | text)", ...[...led.open, ...led.team].map((i) => `${i.id} | ${i.firstSeen} | ${i.text}`)].join("\n");
  const files = job.children
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .map((n) => `=== FILE: ${stripMd(n.rel)} ===\n${n.body.trim()}\n`)
    .join("\n");
  return `${table}\n\n${files}`;
}

function renderRollup(job: RollupJob, led: ItemLedger, llm: RollupLLM, movedRels: Map<string, string>, model: string, cost: number | null): string {
  const childLinks = job.children.map((n) => movedRels.get(n.rel) ?? stripMd(n.rel));
  const merged = new Map<string, string[]>();
  const dropIds = new Set<string>();
  const known = new Set([...led.open, ...led.team].map((i) => i.id));
  for (const g of llm.merge_groups ?? []) {
    if (!known.has(g.keep)) continue;
    const ok = g.merge.filter((m) => known.has(m) && m !== g.keep);
    if (!ok.length) continue;
    merged.set(g.keep, ok);
    for (const m of ok) dropIds.add(m);
  }
  const src = (rel: string): string => link(movedRels.get(`${rel}.md`) ?? rel);
  const level = job.rung.to;
  const title = level === "weekly" ? `Week ${job.period.key} (${job.period.start} – ${job.period.end})` : `Month ${job.period.key}`;
  const openLines = led.open
    .filter((i) => !dropIds.has(i.id))
    .map((i) => `- [ ] ${i.text} *(first seen ${i.firstSeen} · ${src(i.childRel)}${merged.has(i.id) ? ` · merged ${merged.get(i.id)!.length}` : ""})*`);
  const teamLines = led.team.filter((i) => !dropIds.has(i.id)).map((i) => `- [ ] ${i.text} *(first seen ${i.firstSeen})*`);
  const closedLines = led.closed.map((i) => `- [x] ${i.text} *(closed ${i.closedOn})*`);
  const droppedLines = led.dropped.map((i) => `- ${i.text} *(last seen ${i.lastSeen})*`);
  const fm = [
    "---",
    "type: rollup",
    `rollup_level: ${level}`,
    `period: ${job.period.key}`,
    `period_start: ${job.period.start}`,
    `period_end: ${job.period.end}`,
    `children: ${fmList(childLinks)}`,
    `archived_from: ${job.folder}`,
    `children_hash: ${job.childrenHash}`,
    `summarized_by: ${model}`,
    `generated_at: ${new Date().toISOString()}`,
    `cost_usd: ${cost === null ? "null" : cost.toFixed(4)}`,
    `tags: [harness, rollup, ${level}]`,
    "---",
  ];
  const body = [
    "",
    `# ${title}`,
    "",
    `> Rolled up by \`harness compress\` from ${job.children.length} ${job.rung.from} notes. Originals: ${childLinks.map(link).join(" · ")}. Nothing deleted.`,
    "",
    llm.summary.trim(),
    "",
    "## Still-open action items",
    ...(openLines.length ? openLines : ["- none"]),
    "",
    "## Closed this period",
    ...(closedLines.length ? closedLines : ["- none"]),
    "",
    "## Dropped without closing",
    ...(droppedLines.length ? droppedLines : ["- none"]),
    "",
    "## Team items (open)",
    ...(teamLines.length ? teamLines : ["- none"]),
    "",
    "## Decisions",
    ...((llm.decisions ?? []).length ? llm.decisions.map((d) => `- ${d.text} — ${src(d.source)}${d.ticket ? ` (${d.ticket})` : ""}`) : ["- none recorded"]),
    "",
    "## Docs to update",
    ...((llm.docs_to_update ?? []).length ? llm.docs_to_update.map((d) => `- ${d.doc} — ${d.why} (${src(d.source)})`) : ["- none"]),
    "",
    "## Themes",
    ...((llm.themes ?? []).length ? llm.themes.map((t) => `- **${t.title}** — ${t.detail} (${t.evidence.map(src).join(", ")})`) : ["- none"]),
    "",
  ];
  return fm.join("\n") + body.join("\n");
}

interface MeetingLLM {
  summary: string;
  decisions: Array<{ date: string; text: string; source: string; ticket?: string }>;
  recurring_topics: Array<{ topic: string; evidence: string[] }>;
  status_changes: Array<{ ticket: string; to: string; date: string }>;
}

function renderMeeting(job: DistillJob, llm: MeetingLLM, movedRels: Map<string, string>, model: string, cost: number | null): string {
  const childLinks = job.children.map((n) => movedRels.get(n.rel) ?? stripMd(n.rel));
  const src = (rel: string): string => link(movedRels.get(`${rel}.md`) ?? rel);
  const open: string[] = [];
  const seen = new Set<string>();
  for (const n of [...job.children].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
    for (const it of parseItems(n)) {
      if (it.checked || seen.has(it.key)) continue;
      seen.add(it.key);
      open.push(`- [ ] ${it.text} *(${it.childDate} · ${src(it.childRel)})*`);
    }
  }
  const fm = [
    "---",
    "type: rollup",
    "rollup_level: meeting-monthly",
    `stem: ${job.stem}`,
    `period: ${job.period.key}`,
    `period_start: ${job.period.start}`,
    `period_end: ${job.period.end}`,
    `children: ${fmList(childLinks)}`,
    `archived_from: ${job.folder}`,
    `children_hash: ${job.childrenHash}`,
    `summarized_by: ${model}`,
    `generated_at: ${new Date().toISOString()}`,
    `cost_usd: ${cost === null ? "null" : cost.toFixed(4)}`,
    `tags: [harness, rollup, meeting, ${job.stem}]`,
    "---",
  ];
  const body = [
    "",
    `# ${job.stem} — ${job.period.key}`,
    "",
    `> Distilled by \`harness compress\` from ${job.children.length} notes. Originals: ${childLinks.map(link).join(" · ")}. Nothing deleted.`,
    "",
    llm.summary.trim(),
    "",
    "## Decisions",
    ...((llm.decisions ?? []).length ? llm.decisions.map((d) => `- ${d.date} — ${d.text} (${src(d.source)}${d.ticket ? `, ${d.ticket}` : ""})`) : ["- none recorded"]),
    "",
    "## Open action items",
    ...(open.length ? open : ["- none"]),
    "",
    "## Recurring topics",
    ...((llm.recurring_topics ?? []).length ? llm.recurring_topics.map((t) => `- ${t.topic} (${t.evidence.map(src).join(", ")})`) : ["- none"]),
    "",
    "## Status changes",
    ...((llm.status_changes ?? []).length ? llm.status_changes.map((s) => `- ${s.date} — ${s.ticket} → ${s.to}`) : ["- none"]),
    "",
  ];
  return fm.join("\n") + body.join("\n");
}

/** Append decisions to knowledge/decision-log.md under the month, deduped by (date, normalised text). */
function promoteDecisions(vault: string, target: string, month: string, decisions: MeetingLLM["decisions"], movedRels: Map<string, string>, apply: boolean): number {
  if (!decisions?.length) return 0;
  const abs = join(vault, target);
  const head = "---\ntitle: Decision log\ntype: reference\ntags: [harness, decisions]\npinned: true\n---\n\n# Decision log\n\n> Appended by `harness compress` from meeting notes. One line per decision, linked to its source. Append-only.\n";
  let text = existsSync(abs) ? readFileSync(abs, "utf8") : head;
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const have = new Set([...text.matchAll(/^- (\d{4}-\d{2}-\d{2}) — (.*?)(?: \(|$)/gm)].map((m) => `${m[1]}|${norm(m[2])}`));
  const add = decisions.filter((d) => !have.has(`${d.date}|${norm(d.text)}`));
  if (!add.length) return 0;
  const heading = `## ${month}`;
  const lines = add.map((d) => `- ${d.date} — ${d.text} (${link(movedRels.get(`${d.source}.md`) ?? d.source)}${d.ticket ? `, ${d.ticket}` : ""})`);
  if (text.includes(heading)) {
    const at = text.indexOf(heading) + heading.length;
    text = text.slice(0, at) + "\n" + lines.join("\n") + text.slice(at);
  } else {
    text = text.replace(/\s*$/, "\n") + `\n${heading}\n${lines.join("\n")}\n`;
  }
  if (apply) {
    mkdirSync(posix.dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  return add.length;
}

// ---------- knowledge consolidation ----------

interface Proposal {
  op: "ADD" | "UPDATE" | "SUPERSEDE" | "NOOP";
  target: string;
  superseded_by?: string;
  reason: string;
  evidence: Array<{ note: string; quote: string }>;
  content?: string;
  confidence: number;
}

function clusterStdin(vault: string, cluster: KnowledgeCluster, indexFile: string): string {
  const files = cluster.notes.map((c) => `=== FILE: ${stripMd(c.note.rel)} === (updated ${c.updated}, reason: ${c.reasons.join("; ")})\n${c.note.text.trim()}\n`).join("\n");
  const idxAbs = join(vault, indexFile);
  const rels = new Set(cluster.notes.map((c) => stripMd(c.note.rel)));
  const idxLines = existsSync(idxAbs) ? readFileSync(idxAbs, "utf8").split("\n").filter((l) => [...rels].some((r) => l.includes(`[[${r}`))) : [];
  return `${files}\n=== INDEX ENTRIES ===\n${idxLines.join("\n")}\n`;
}

function applyProposal(vault: string, pol: RetentionV2, p: Proposal, today: string, apply: boolean, moves: Array<{ from: string; to: string }>, log: (s: string) => void): string {
  const target = stripMd(p.target);
  const abs = join(vault, `${target}.md`);
  switch (p.op) {
    case "NOOP":
      return `NOOP ${target}`;
    case "ADD": {
      if (existsSync(abs)) return `ADD refused (exists): ${target}`;
      const body = `---\ntitle: ${posix.basename(target).replace(/-/g, " ")}\ntype: reference\ntags: [harness, consolidated]\nupdated: ${today}\nsource: harness compress\nconsolidated_from: ${fmList(p.evidence.map((e) => stripMd(e.note)))}\n---\n\n${(p.content ?? "").trim()}\n\n_Sources: ${p.evidence.map((e) => link(e.note)).join(", ")}_\n`;
      if (apply) {
        mkdirSync(posix.dirname(abs), { recursive: true });
        writeFileSync(abs, body, "utf8");
      }
      return `ADD ${target}`;
    }
    case "UPDATE": {
      if (!existsSync(abs)) return `UPDATE skipped (missing): ${target}`;
      const text = readFileSync(abs, "utf8");
      const section = `\n## Consolidated ${today}\n\n${(p.content ?? "").trim()}\n\n_Sources: ${p.evidence.map((e) => link(e.note)).join(", ")}_\n`;
      let next = text.replace(/\s*$/, "\n") + section;
      next = /^updated:/m.test(next) ? next.replace(/^updated:.*$/m, `updated: ${today}`) : next.replace(/^---\n/, `---\nupdated: ${today}\n`);
      if (apply) writeFileSync(abs, next, "utf8");
      return `UPDATE ${target}`;
    }
    case "SUPERSEDE": {
      if (!existsSync(abs)) return `SUPERSEDE skipped (missing): ${target}`;
      const by = p.superseded_by ? stripMd(p.superseded_by) : null;
      if (!by || !existsSync(join(vault, `${by}.md`))) return `SUPERSEDE refused (superseded_by missing): ${target}`;
      const text = readFileSync(abs, "utf8");
      const fmKeys = `${pol.frontmatter.status_key}: ${pol.frontmatter.superseded_value}\n${pol.frontmatter.superseded_by_key}: "[[${by}]]"\nsuperseded_at: ${today}\n`;
      const next = text.startsWith("---\n") ? text.replace(/^---\n/, `---\n${fmKeys}`) : `---\n${fmKeys}---\n\n${text}`;
      const to = archiveDest(`${target}.md`, pol.folders.knowledge?.archive_to);
      if (apply) {
        writeFileSync(abs, next, "utf8");
        const byAbs = join(vault, `${by}.md`);
        const byText = readFileSync(byAbs, "utf8");
        const sup = `supersedes: "[[${stripMd(to)}]]"\n`;
        writeFileSync(byAbs, byText.startsWith("---\n") ? byText.replace(/^---\n/, `---\n${sup}`) : `---\n${sup}---\n\n${byText}`, "utf8");
      }
      moves.push({ from: `${target}.md`, to });
      return `SUPERSEDE ${target} → ${by}`;
    }
  }
}

// ---------- plan note ----------

function renderPlanNote(plan: CompressPlan, results: string[], today: string, dryRun: boolean): string {
  const lines = [
    "---",
    "type: compress-plan",
    `date: ${today}`,
    `dry_run: ${dryRun}`,
    "tags: [harness, compress]",
    "pinned: false",
    "---",
    "",
    `# Compress plan — ${today}${dryRun ? " (dry run)" : ""}`,
    "",
    "> Written by `harness compress`. Nothing is deleted: originals move to archive/, superseded notes keep a pointer.",
    "",
    `## Archive moves (${plan.archive.length})`,
    ...(plan.archive.length ? plan.archive.map((m) => `- ${link(m.rel)} → \`${m.to}\` (${m.reason})`) : ["- none"]),
    "",
    `## Rollups (${plan.rollups.length})`,
    ...(plan.rollups.length ? plan.rollups.map((r) => `- ${r.rung.from} → ${r.rung.to} ${r.period.key}: ${r.children.length} notes → \`${r.outRel}\` (${r.status})`) : ["- none"]),
    "",
    `## Meeting distills (${plan.distills.length})`,
    ...(plan.distills.length ? plan.distills.map((d) => `- ${d.stem} ${d.period.key}: ${d.children.length} notes → \`${d.outRel}\` (${d.status})`) : ["- none"]),
    "",
    `## Knowledge candidates (${plan.knowledge.reduce((a, k) => a + k.notes.length, 0)} notes in ${plan.knowledge.length} clusters)`,
    ...(plan.knowledge.length ? plan.knowledge.flatMap((k) => [`- **${k.key}**`, ...k.notes.map((n) => `  - ${link(n.note.rel)} — ${n.reasons.join("; ")}`)]) : ["- none"]),
    "",
    "## Applied",
    ...(results.length ? results.map((r) => `- ${r}`) : ["- nothing (dry run or no eligible work)"]),
    "",
    ...(plan.pendingRollup.length ? [`## Waiting for a period to close (${plan.pendingRollup.length})`, ...plan.pendingRollup.map((p) => `- ${p}`), ""] : []),
    ...(plan.budgetOverruns.length ? ["## Budget overruns", ...plan.budgetOverruns.map((b) => `- ${b}`), ""] : []),
  ];
  return lines.join("\n");
}

// ---------- the run ----------

export async function runCompress(opts: CompressOptions): Promise<{ plan: CompressPlan; results: string[]; costUsd: number }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const runner: StructuredRunner = opts.runner ?? (runClaudeStructured as StructuredRunner);
  const pol = loadPolicy(opts.harnessRepo);
  const runId = randomUUID().slice(0, 8);
  const { vault, apply, today } = opts;
  const plan = planAll(opts, pol);
  const archiveOnly = opts.only === "archive";
  audit({ run_id: runId, job: archiveOnly ? "archive" : "compress", phase: "plan", dry_run: !apply, summary: `${plan.archive.length} moves, ${plan.rollups.length} rollups, ${plan.distills.length} distills, ${plan.knowledge.length} knowledge clusters` });

  const results: string[] = [];
  let spent = 0;
  const moves: Array<{ from: string; to: string }> = [];
  const writes: Array<{ rel: string; text: string }> = [];
  const movedRels = new Map<string, string>(); // from rel (with .md) → to rel (no .md)
  const touchedFolders = new Set<string>();

  for (const m of plan.archive) {
    moves.push({ from: m.rel, to: m.to });
    movedRels.set(m.rel, stripMd(m.to));
    touchedFolders.add(m.folder);
  }

  const budgetLeft = (): number => opts.maxBudgetUsd - spent;
  const prompts = (name: string): string => readFileSync(join(opts.harnessRepo, "definitions", "compress", "prompts", `${name}.md`), "utf8");
  const schemas = (name: string): object => JSON.parse(readFileSync(join(opts.harnessRepo, "definitions", "compress", "schemas", `${name}.schema.json`), "utf8"));

  if (!archiveOnly) {
    // Rollups
    for (const job of plan.rollups) {
      if (job.status === "noop") {
        audit({ run_id: runId, job: "compress", phase: "summarize", folder: job.folder, strategy: "rollup", dry_run: !apply, skipped_reason: "noop: children_hash unchanged", children_hash: job.childrenHash });
        continue;
      }
      if (job.status === "stale" && !opts.force) {
        results.push(`stale rollup ${job.outRel} (children edited since) — re-run with --force to regenerate`);
        continue;
      }
      for (const n of job.children) {
        moves.push({ from: n.rel, to: `${job.rung.children_to}/${posix.basename(n.rel)}` });
        movedRels.set(n.rel, `${job.rung.children_to}/${stripMd(posix.basename(n.rel))}`);
      }
      touchedFolders.add(job.folder);
      if (!apply) {
        results.push(`would roll up ${job.children.length} ${job.rung.from} → ${job.outRel} (${job.rung.model}, ≤$${job.rung.max_budget_usd})`);
        continue;
      }
      if (budgetLeft() < job.rung.max_budget_usd) {
        results.push(`skipped ${job.outRel}: run budget exhausted`);
        continue;
      }
      const led = ledger(job.children, job.rung.from === "daily" ? historyFirstSeen(vault, job.folder) : new Map());
      const t0 = Date.now();
      try {
        const r = await runner<RollupLLM>({
          prompt: "Compress the notes on stdin per the rules. Return only the JSON object.",
          model: tierToModel(job.rung.model),
          schema: schemas("digest-rollup"),
          systemPrompt: prompts(job.rung.to === "weekly" ? "digest-weekly" : "digest-monthly"),
          stdinBody: buildRollupStdin(job, led),
          maxBudgetUsd: job.rung.max_budget_usd,
        });
        spent += r.costUsd ?? 0;
        if (job.status === "stale") {
          const old = join(vault, job.outRel);
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const dest = archiveDest(job.outRel.replace(/\.md$/, `.v${stamp}.md`));
          mkdirSync(posix.dirname(join(vault, dest)), { recursive: true });
          renameSync(old, join(vault, dest));
          results.push(`archived stale rollup → ${dest}`);
        }
        writes.push({ rel: job.outRel, text: renderRollup(job, led, r.data, movedRels, r.model, r.costUsd) });
        results.push(`rolled up ${job.children.length} ${job.rung.from} → ${job.outRel} ($${(r.costUsd ?? 0).toFixed(3)})`);
        audit({ run_id: runId, job: "compress", phase: "summarize", folder: job.folder, strategy: "rollup", inputs: job.children.map((n) => n.rel), outputs: [job.outRel], children_hash: job.childrenHash, model: r.model, cost_usd: r.costUsd ?? undefined, duration_ms: Date.now() - t0, dry_run: false });
      } catch (e) {
        results.push(`FAILED rollup ${job.outRel}: ${(e as Error).message}`);
        audit({ run_id: runId, job: "compress", phase: "summarize", folder: job.folder, strategy: "rollup", outputs: [job.outRel], dry_run: false, error: (e as Error).message });
        // Children stay live when the summary failed — never move what wasn't summarised.
        for (const n of job.children) {
          const i = moves.findIndex((m) => m.from === n.rel);
          if (i !== -1) moves.splice(i, 1);
          movedRels.delete(n.rel);
        }
      }
    }

    // Meeting distills
    for (const job of plan.distills) {
      if (job.status === "noop") continue;
      if (job.status === "stale" && !opts.force) {
        results.push(`stale distill ${job.outRel} — re-run with --force`);
        continue;
      }
      for (const n of job.children) {
        moves.push({ from: n.rel, to: `${job.fp.children_to}/${posix.basename(n.rel)}` });
        movedRels.set(n.rel, `${job.fp.children_to}/${stripMd(posix.basename(n.rel))}`);
      }
      touchedFolders.add(job.folder);
      if (!apply) {
        results.push(`would distil ${job.children.length} ${job.stem} notes → ${job.outRel} (${job.fp.model}, ≤$${job.fp.max_budget_usd})`);
        continue;
      }
      const cap = job.fp.max_budget_usd ?? 0.6;
      if (budgetLeft() < cap) {
        results.push(`skipped ${job.outRel}: run budget exhausted`);
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await runner<MeetingLLM>({
          prompt: "Distil the meeting notes on stdin per the rules. Return only the JSON object.",
          model: tierToModel(job.fp.model ?? "sonnet"),
          schema: schemas("meeting-distill"),
          systemPrompt: prompts("meeting-monthly"),
          stdinBody: job.children.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).map((n) => `=== FILE: ${stripMd(n.rel)} ===\n${n.body.trim()}\n`).join("\n"),
          maxBudgetUsd: cap,
        });
        spent += r.costUsd ?? 0;
        writes.push({ rel: job.outRel, text: renderMeeting(job, r.data, movedRels, r.model, r.costUsd) });
        const promoted = job.fp.promote ? promoteDecisions(vault, job.fp.promote.to, job.period.key, r.data.decisions, movedRels, apply) : 0;
        results.push(`distilled ${job.children.length} ${job.stem} → ${job.outRel} ($${(r.costUsd ?? 0).toFixed(3)}; ${promoted} decision(s) promoted)`);
        audit({ run_id: runId, job: "compress", phase: "summarize", folder: job.folder, strategy: "distill", inputs: job.children.map((n) => n.rel), outputs: [job.outRel], children_hash: job.childrenHash, model: r.model, cost_usd: r.costUsd ?? undefined, duration_ms: Date.now() - t0, dry_run: false });
      } catch (e) {
        results.push(`FAILED distill ${job.outRel}: ${(e as Error).message}`);
        audit({ run_id: runId, job: "compress", phase: "summarize", folder: job.folder, strategy: "distill", outputs: [job.outRel], dry_run: false, error: (e as Error).message });
        for (const n of job.children) {
          const i = moves.findIndex((m) => m.from === n.rel);
          if (i !== -1) moves.splice(i, 1);
          movedRels.delete(n.rel);
        }
      }
    }

    // Knowledge consolidation (opt-in: --knowledge)
    if (opts.knowledge && plan.knowledge.length) {
      ensureDir(compressCacheDir());
      const fp = pol.folders.knowledge;
      for (const cluster of plan.knowledge) {
        const key = sha256(cluster.notes.map((n) => `${n.note.rel}\t${n.note.sha256}`).sort().join("\n")).slice(0, 16);
        const cachePath = join(compressCacheDir(), `${key}.json`);
        let proposals: Proposal[] | null = null;
        if (existsSync(cachePath)) proposals = (JSON.parse(readFileSync(cachePath, "utf8")) as { proposals: Proposal[] }).proposals;
        if (!proposals) {
          const cap = fp.max_budget_usd ?? 1.5;
          if (budgetLeft() < cap) {
            results.push(`skipped knowledge cluster ${cluster.key}: run budget exhausted`);
            continue;
          }
          const t0 = Date.now();
          try {
            const r = await runner<{ proposals: Proposal[] }>({
              prompt: "Propose one operation per note on stdin per the rules. Return only the JSON object.",
              model: tierToModel(fp.model ?? "sonnet"),
              schema: schemas("knowledge-consolidate"),
              systemPrompt: prompts("knowledge-consolidate"),
              stdinBody: clusterStdin(vault, cluster, pol.index.file),
              maxBudgetUsd: cap,
            });
            spent += r.costUsd ?? 0;
            proposals = r.data.proposals;
            writeFileSync(cachePath, JSON.stringify({ cluster: cluster.key, proposals, model: r.model, cost_usd: r.costUsd }, null, 2), "utf8");
            audit({ run_id: runId, job: "compress", phase: "knowledge", folder: "knowledge", inputs: cluster.notes.map((n) => n.note.rel), model: r.model, cost_usd: r.costUsd ?? undefined, duration_ms: Date.now() - t0, dry_run: !apply, summary: `${proposals.length} proposals` });
          } catch (e) {
            results.push(`FAILED knowledge cluster ${cluster.key}: ${(e as Error).message}`);
            continue;
          }
        }
        for (const p of proposals) {
          if (p.confidence < 0.6) {
            results.push(`needs a human: ${p.op} ${p.target} (confidence ${p.confidence}) — ${p.reason}`);
            continue;
          }
          const verdict = applyProposal(vault, pol, p, today, apply, moves, log);
          results.push(`${apply ? "" : "would "}${verdict} — ${p.reason}`);
          if (p.op === "SUPERSEDE") touchedFolders.add("knowledge");
        }
      }
    }
  }

  // Write new notes, rewrite links (pre-move index), move originals, update indexes.
  if (apply) {
    for (const w of writes) {
      const abs = join(vault, w.rel);
      mkdirSync(posix.dirname(abs), { recursive: true });
      writeFileSync(abs, w.text, "utf8");
      audit({ run_id: runId, job: "compress", phase: "write", outputs: [w.rel], dry_run: false });
    }
  }
  const idx = buildIndex(vault);
  const rewrite = moves.length ? rewriteForMoves(vault, moves, apply, idx) : { filesTouched: 0, linksRewritten: 0, perFile: {} };
  let moved = 0;
  if (apply) {
    for (const m of moves) {
      try {
        mkdirSync(posix.dirname(join(vault, m.to)), { recursive: true });
        renameSync(join(vault, m.from), join(vault, m.to));
        moved++;
      } catch (e) {
        results.push(`could not move ${m.from}: ${(e as Error).message}`);
      }
    }
    audit({ run_id: runId, job: archiveOnly ? "archive" : "compress", phase: "move", moves, dry_run: false, summary: `${moved} moved, ${rewrite.linksRewritten} links rewritten in ${rewrite.filesTouched} files` });
  }
  const ix = updateIndexes(vault, pol, apply, today, touchedFolders);
  audit({ run_id: runId, job: archiveOnly ? "archive" : "compress", phase: "index", dry_run: !apply, summary: `pruned ${ix.prunedLinks} links, recent ${ix.recentRegenerated ? "regenerated" : "unchanged"}, ${ix.reordered} blocks reordered, ${ix.overflowed} overflowed, ${ix.lines} lines` });

  // Plan note (only on apply; dry runs print).
  if (apply && !archiveOnly) {
    const rel = pol.audit.plan_note.replace("{date}", today);
    const abs = join(vault, rel);
    mkdirSync(posix.dirname(abs), { recursive: true });
    writeFileSync(abs, renderPlanNote(plan, results, today, false), "utf8");
    results.push(`plan note → ${rel}`);
  }

  audit({ run_id: runId, job: archiveOnly ? "archive" : "compress", phase: "done", dry_run: !apply, cost_usd: spent, summary: `${moved} moved, ${writes.length} written, $${spent.toFixed(3)}` });
  appendRun({ event: "cli_run", skill: archiveOnly ? "archive" : "compress", success: !results.some((r) => r.startsWith("FAILED")), cost_usd: spent });

  // Console summary
  log(`${apply ? "Applied" : "Plan"}: ${plan.archive.length} archive move(s), ${plan.rollups.length} rollup(s), ${plan.distills.length} distill(s), ${plan.knowledge.length} knowledge cluster(s)${opts.knowledge ? "" : " (listed; --knowledge to consolidate)"}.`);
  if (moves.length) log(`${apply ? "Moved" : "Would move"} ${moves.length} note(s); ${apply ? "rewrote" : "would rewrite"} ${rewrite.linksRewritten} link(s) in ${rewrite.filesTouched} file(s).`);
  for (const r of results) log(`  · ${r}`);
  if (plan.pendingRollup.length) log(`  ${plan.pendingRollup.length} note(s) wait for their period to close.`);
  if (plan.budgetOverruns.length) for (const b of plan.budgetOverruns) log(`  over budget: ${b}`);
  if (!apply) log(`Dry run — nothing written. Re-run with --apply.`);
  return { plan, results, costUsd: spent };
}

// ---------- CLI ----------

function parseArgs(argv: string[]): Partial<CompressOptions> & { nudge: boolean; help: boolean } {
  const out: Partial<CompressOptions> & { nudge: boolean; help: boolean } = { apply: false, force: false, knowledge: false, nudge: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (): string => (a.includes("=") ? a.split("=").slice(1).join("=") : argv[++i]);
    if (a === "--apply") out.apply = true;
    else if (a === "--force") out.force = true;
    else if (a === "--knowledge") out.knowledge = true;
    else if (a === "--nudge") out.nudge = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--only")) out.only = val() as "archive";
    else if (a.startsWith("--folder")) out.folder = val();
    else if (a.startsWith("--since")) out.since = val();
    else if (a.startsWith("--vault")) out.vault = val();
    else if (a.startsWith("--today")) out.today = val();
    else if (a.startsWith("--max-budget-usd")) out.maxBudgetUsd = Number(val());
    else if (a.startsWith("--days")) { /* v1 flag: ignored; policy drives cutoffs now */ }
  }
  return out;
}

export async function compress(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.help) {
    info("Usage: harness compress [--apply] [--knowledge] [--force] [--only archive] [--folder F] [--vault PATH] [--max-budget-usd N] [--nudge]");
    return 0;
  }
  const harnessRepo = getHarnessRepo();
  const vault = a.vault ?? readConfig()?.vaultPath;
  if (!vault || !existsSync(vault)) {
    if (a.nudge) return 0;
    warn("No vault configured (config.json → vaultPath). Run `/setup` first — nothing to compress.");
    return 0;
  }
  const today = a.today ?? new Date().toISOString().slice(0, 10);

  if (a.nudge) {
    // Plan only, no LLM, no writes, one line or nothing.
    try {
      const pol = loadPolicy(harnessRepo);
      const plan = planAll({ apply: false, vault, harnessRepo, maxBudgetUsd: 0, force: false, knowledge: false, today }, pol);
      const due = plan.archive.length + plan.rollups.filter((r) => r.status !== "noop").reduce((n, r) => n + r.children.length, 0) + plan.distills.filter((d) => d.status !== "noop").reduce((n, d) => n + d.children.length, 0);
      const last = readLastRuns().compress;
      const age = last ? Math.round((Date.now() - new Date(last.ts).getTime()) / 86_400_000) : null;
      if (due || (age !== null && age > 8) || age === null) {
        console.log(`harness: ${due} note(s) due for archive/rollup; last compress run ${age === null ? "never" : `${age}d ago`} — run \`harness compress\` to see the plan.`);
      }
    } catch {
      /* silent: a nudge must never break a session start */
    }
    return 0;
  }

  banner();
  try {
    const { results } = await runCompress({
      apply: Boolean(a.apply),
      only: a.only,
      folder: a.folder,
      since: a.since,
      vault,
      harnessRepo,
      maxBudgetUsd: a.maxBudgetUsd ?? 3,
      force: Boolean(a.force),
      knowledge: Boolean(a.knowledge),
      today,
    });
    const failed = results.filter((r) => r.startsWith("FAILED"));
    if (failed.length) {
      warn(`${failed.length} step(s) failed; their originals were left live.`);
      return 1;
    }
    ok(a.apply ? "Done. Nothing deleted — originals are in archive/." : "Dry run complete.");
    return 0;
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }
}
