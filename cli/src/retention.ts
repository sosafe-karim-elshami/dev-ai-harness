// Retention policy v2 — the rule-based foundation shared by `harness archive` and
// `harness compress`. Pure functions over the vault on disk; nothing here writes.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Strategy = "archive" | "rollup" | "distill" | "keep";
export type DateFrom = "filename-prefix" | "frontmatter:date" | "mtime";
export type ModelTier = "haiku" | "sonnet";

export interface Rung {
  from: string;
  to: string;
  after_days: number;
  period: "iso-week" | "month";
  out_dir: string;
  children_to: string;
  model: ModelTier;
  max_budget_usd: number;
  min_children: number;
}

export interface FolderPolicy {
  strategy: Strategy;
  after_days?: number;
  recurse?: boolean;
  exclude_dirs?: string[];
  date_from?: DateFrom | DateFrom[];
  match?: { frontmatter_type?: string[]; filename?: string };
  ladder?: Rung[];
  budgets?: { max_live_files?: number };
  exempt_types?: string[];
  exempt_filenames?: string[];
  // distill
  stale_after_days?: number;
  updated_from?: string[];
  time_bound?: { ticket_key_pattern: string; stale_after_days: number; frontmatter_types: string[] };
  near_dupe_jaccard?: number;
  group_by?: "stem";
  stem_pattern?: string;
  period?: "month";
  out_dir?: string;
  children_to?: string;
  promote?: { section: string; to: string };
  archive_to?: string;
  model?: ModelTier;
  max_budget_usd?: number;
  note?: string;
}

export interface RetentionV2 {
  schema_version: 2;
  default_after_days: number;
  date_from_default: DateFrom[];
  folders: Record<string, FolderPolicy>;
  frontmatter: {
    expires_key: string;
    status_key: string;
    superseded_value: string;
    superseded_by_key: string;
    pinned_key: string;
    archived_from_key: string;
  };
  exempt: { filenames: string[]; rules?: string[] };
  index: {
    file: string;
    recent_section: string;
    recent_markers: [string, string];
    recent_count: number;
    max_index_lines: number;
    overflow_to: string;
    importance: { half_life_days: number; pinned_boost: number; star_boost: number };
    prune_links: boolean;
  };
  links: { mode: "rewrite-on-move"; report_dangling: boolean; fail_on_ambiguous_bare: boolean };
  audit: { log: string; plan_note: string };
  not_archived?: Record<string, string>;
}

export interface Note {
  /** posix rel path including .md */
  rel: string;
  abs: string;
  /** top-level policy folder */
  folder: string;
  fm: Record<string, unknown>;
  body: string;
  text: string;
  sha256: string;
  mtime: Date;
  date: string | null;
  dateSource: DateFrom | "expires" | null;
}

export const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

export function loadPolicy(harnessRepo: string): RetentionV2 {
  const p = join(harnessRepo, "definitions", "retention.json");
  if (!existsSync(p)) throw new Error(`No retention policy at ${p}.`);
  const pol = JSON.parse(readFileSync(p, "utf8")) as RetentionV2 & { schema_version: number };
  if (pol.schema_version !== 2) {
    throw new Error(
      `retention.json schema_version ${pol.schema_version} is not supported; this CLI reads v2 (strategies archive|rollup|distill|keep, ladders, budgets). Pull the harness and re-run.`,
    );
  }
  return pol;
}

/** Minimal YAML frontmatter: scalars, quoted strings, inline arrays, booleans. */
export function parseFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: text };
  const block = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const fm: Record<string, unknown> = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawVal] = m;
    let v: unknown = rawVal.trim();
    if (typeof v === "string") {
      if (/^\[.*\]$/.test(v)) {
        v = v
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
      else if (v === "true") v = true;
      else if (v === "false") v = false;
    }
    fm[key] = v;
  }
  return { fm, body };
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const dayStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function ageDays(date: string, todayIso: string): number {
  return Math.floor((dayStart(new Date(`${todayIso}T00:00:00Z`)) - dayStart(new Date(`${date}T00:00:00Z`))) / 86_400_000);
}

function fmDate(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

export function resolveDate(note: Pick<Note, "rel" | "fm" | "mtime">, chain: DateFrom[]): { date: string; source: DateFrom } | null {
  const base = note.rel.slice(note.rel.lastIndexOf("/") + 1);
  for (const src of chain) {
    if (src === "filename-prefix") {
      const m = DATE_PREFIX.exec(base);
      if (m) return { date: m[1], source: src };
    } else if (src === "frontmatter:date") {
      const d = fmDate(note.fm, "date");
      if (d) return { date: d, source: src };
    } else if (src === "mtime") {
      return { date: isoDate(note.mtime), source: src };
    }
  }
  return null;
}

/** `updated:` chain for distill folders: frontmatter keys first, mtime last. */
export function resolveUpdated(note: Pick<Note, "fm" | "mtime">, chain: string[]): string {
  for (const src of chain) {
    if (src.startsWith("frontmatter:")) {
      const d = fmDate(note.fm, src.slice("frontmatter:".length));
      if (d) return d;
    } else if (src === "mtime") return isoDate(note.mtime);
  }
  return isoDate(note.mtime);
}

export function readNote(root: string, rel: string, folder: string, chain: DateFrom[]): Note {
  const abs = join(root, rel);
  const text = readFileSync(abs, "utf8");
  const { fm, body } = parseFrontmatter(text);
  const mtime = statSync(abs).mtime;
  const partial = { rel, fm, mtime };
  const d = resolveDate(partial, chain);
  return { rel, abs, folder, fm, body, text, sha256: sha256(text), mtime, date: d?.date ?? null, dateSource: d?.source ?? null };
}

/** Live notes of a policy folder (never inside archive/), honouring recursion and exclusions. */
export function scanFolder(root: string, folder: string, pol: FolderPolicy, chain: DateFrom[]): Note[] {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  const excluded = new Set(["archive", ...(pol.exclude_dirs ?? [])]);
  const out: Note[] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!pol.recurse || excluded.has(e.name)) continue;
        walk(join(d, e.name), `${rel}/${e.name}`);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(readNote(root, `${rel}/${e.name}`, folder, chain));
      }
    }
  };
  walk(dir, folder);
  return out;
}

export function dateChain(pol: RetentionV2, fp: FolderPolicy): DateFrom[] {
  const d = fp.date_from ?? pol.date_from_default;
  return Array.isArray(d) ? d : [d];
}

/** Why a note is exempt from any retention action, or null. */
export function isExempt(note: Note, pol: RetentionV2, fp: FolderPolicy, todayIso: string): string | null {
  const base = note.rel.slice(note.rel.lastIndexOf("/") + 1);
  if (pol.exempt.filenames.includes(base) || fp.exempt_filenames?.includes(base)) return "exempt filename";
  if (note.rel.split("/").includes("archive")) return "already archived";
  if (note.fm[pol.frontmatter.pinned_key] === true) return "pinned";
  const type = typeof note.fm.type === "string" ? note.fm.type : "";
  if (fp.exempt_types?.includes(type)) return `type ${type}`;
  // "Today" protects the active day's note. An mtime-only date says nothing about the
  // note's own chronology (a copy or a touch resets it), so it never triggers this rule.
  if (note.date === todayIso && note.dateSource !== "mtime") return "today";
  return null;
}

/** `expires:` in the past, or `status: superseded` — forced out regardless of folder strategy. */
export function forcedOut(note: Note, pol: RetentionV2, todayIso: string): "expired" | "superseded" | null {
  const exp = fmDate(note.fm, pol.frontmatter.expires_key);
  if (exp && exp < todayIso) return "expired";
  if (note.fm[pol.frontmatter.status_key] === pol.frontmatter.superseded_value) return "superseded";
  return null;
}

/** ISO week key `YYYY-Www` plus Monday/Sunday bounds. */
export function isoWeek(date: string): { key: string; start: string; end: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4day + 1);
  const week = Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return { key: `${year}-W${String(week).padStart(2, "0")}`, start: isoDate(monday), end: isoDate(sunday) };
}

export function monthKey(date: string): { key: string; start: string; end: string } {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { key: `${y}-${mm}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
