// `harness archive` — retention for the harness's own output.
//
// The vault gains a note per day per surface and never loses one. The cost isn't
// disk (6MB after months); it's that a `## Recent` list with 120 entries is not
// recent, and the live folders stop being scannable.
//
// Policy lives in definitions/retention.json, encoding the convention already in
// the vault: date-stamped notes past the cutoff move to a flat `<folder>/archive/`,
// and their links leave index.md. This tool only moves files — it never deletes —
// and it is a DRY RUN unless given --apply, matching `harness install-cron`.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getHarnessRepo, readConfig, digestsDir } from "./paths.js";
import { banner, c, info, ok, warn, fail } from "./ui.js";

interface FolderPolicy {
  strategy: "archive" | "keep";
  after_days?: number;
  date_from?: string;
  note?: string;
}

interface Retention {
  default_after_days: number;
  folders: Record<string, FolderPolicy>;
  exempt: { filenames: string[] };
  index: { prune_links: boolean; recent_section: string };
}

/** A leading YYYY-MM-DD is what makes a note chronological, and so archivable. */
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

interface Move {
  folder: string;
  file: string;
  date: string;
  ageDays: number;
  from: string;
  to: string;
}

function loadPolicy(harnessRepo: string): Retention {
  const p = join(harnessRepo, "definitions", "retention.json");
  if (!existsSync(p)) throw new Error(`No retention policy at ${p}.`);
  return JSON.parse(readFileSync(p, "utf8")) as Retention;
}

/** `pinned: true` in frontmatter opts a note out permanently. */
function isPinned(path: string): boolean {
  try {
    const head = readFileSync(path, "utf8").slice(0, 600);
    return /^pinned:\s*true\s*$/m.test(head);
  } catch {
    return false;
  }
}

const dayStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function plan(root: string, pol: Retention, todayIso: string, overrideDays?: number): { moves: Move[]; skipped: string[] } {
  const moves: Move[] = [];
  const skipped: string[] = [];
  const todayMs = dayStart(new Date(`${todayIso}T00:00:00Z`));

  for (const [folder, fp] of Object.entries(pol.folders)) {
    if (fp.strategy !== "archive") continue;
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;

    const cutoffDays = overrideDays ?? fp.after_days ?? pol.default_after_days;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (pol.exempt.filenames.includes(entry.name)) continue;

      const m = DATE_PREFIX.exec(entry.name);
      if (!m) {
        // Undated means topical, and topical means a human decides.
        skipped.push(`${folder}/${entry.name} (no date prefix)`);
        continue;
      }
      const date = m[1];
      if (date === todayIso) continue; // never archive the active day

      const ageDays = Math.floor((todayMs - dayStart(new Date(`${date}T00:00:00Z`))) / 86_400_000);
      if (ageDays < cutoffDays) continue;

      const from = join(dir, entry.name);
      if (isPinned(from)) {
        skipped.push(`${folder}/${entry.name} (pinned)`);
        continue;
      }

      moves.push({ folder, file: entry.name, date, ageDays, from, to: join(dir, "archive", entry.name) });
    }
  }

  moves.sort((a, b) => (a.folder === b.folder ? a.date.localeCompare(b.date) : a.folder.localeCompare(b.folder)));
  return { moves, skipped };
}

/**
 * Drop archived notes' links from index.md. The vault's convention is that the
 * index lists what's live — previous manual archiving removed these lines rather
 * than re-pointing them. Returns the number of lines removed.
 */
function pruneIndex(root: string, moves: Move[], apply: boolean): number {
  const indexPath = join(root, "index.md");
  if (!existsSync(indexPath)) return 0;

  const archived = new Set(moves.map((m) => `${m.folder}/${m.file.replace(/\.md$/, "")}`));
  const lines = readFileSync(indexPath, "utf8").split("\n");
  const kept = lines.filter((line) => {
    const links = [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1]);
    // Only drop a line whose links are ALL archived — never strip a paragraph that
    // still references something live.
    return !(links.length && links.every((l) => archived.has(l)));
  });

  const removed = lines.length - kept.length;
  if (removed && apply) writeFileSync(indexPath, kept.join("\n"), "utf8");
  return removed;
}

/** Generate `<folder>/archive/index.md` so archived notes stay reachable. */
function writeArchiveIndex(root: string, folder: string, apply: boolean): number {
  const dir = join(root, folder, "archive");
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort()
    .reverse();
  if (!files.length) return 0;

  const body = [
    "---",
    "title: " + folder.charAt(0).toUpperCase() + folder.slice(1) + " — Archive",
    "type: moc",
    "tags: [harness, archive]",
    "pinned: true",
    "---",
    "",
    `# ${folder} — archive`,
    "",
    `> Retired from the live folder by \`harness archive\` per \`definitions/retention.json\`. Nothing here was deleted.`,
    "",
    ...files.map((f) => `- [[${folder}/archive/${f.replace(/\.md$/, "")}]]`),
    "",
  ].join("\n");

  if (apply) writeFileSync(join(dir, "index.md"), body, "utf8");
  return files.length;
}

export function archive(argv: string[]): number {
  const apply = argv.includes("--apply");
  const daysArg = argv.find((a) => a.startsWith("--days="));
  const overrideDays = daysArg ? Number(daysArg.split("=")[1]) : undefined;
  if (daysArg && (!Number.isFinite(overrideDays) || (overrideDays as number) < 1)) {
    fail(`--days must be a positive integer (got "${daysArg.split("=")[1]}").`);
    return 1;
  }

  const harnessRepo = getHarnessRepo();
  let pol: Retention;
  try {
    pol = loadPolicy(harnessRepo);
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }

  const vault = readConfig()?.vaultPath;
  if (!vault || !existsSync(vault)) {
    warn("No vault configured (config.json → vaultPath). Run `/setup` first — nothing to archive.");
    return 0;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const { moves, skipped } = plan(vault, pol, todayIso, overrideDays);

  banner();
  if (!moves.length) {
    ok(`Nothing to archive — no dated note is older than the cutoff.`);
    if (skipped.length) info(`${skipped.length} exempt (undated or pinned).`);
    return 0;
  }

  const byFolder = new Map<string, Move[]>();
  for (const m of moves) byFolder.set(m.folder, [...(byFolder.get(m.folder) ?? []), m]);

  info(`${apply ? "Archiving" : "Would archive"} ${moves.length} note(s) in ${byFolder.size} folder(s):\n`);
  for (const [folder, ms] of byFolder) {
    const cutoff = overrideDays ?? pol.folders[folder]?.after_days ?? pol.default_after_days;
    console.log(`  ${c.bold(folder)}/ → ${folder}/archive/  ${c.dim(`(older than ${cutoff}d)`)}`);
    console.log(`    ${c.dim(`${ms.length} files, ${ms[0].date} … ${ms[ms.length - 1].date}`)}`);
  }

  if (apply) {
    let moved = 0;
    for (const m of moves) {
      try {
        mkdirSync(join(vault, m.folder, "archive"), { recursive: true });
        renameSync(m.from, m.to);
        moved++;
      } catch (e) {
        warn(`could not move ${m.folder}/${m.file}: ${(e as Error).message}`);
      }
    }
    const pruned = pol.index.prune_links ? pruneIndex(vault, moves, true) : 0;
    let indexed = 0;
    for (const folder of byFolder.keys()) indexed += writeArchiveIndex(vault, folder, true);

    console.log("");
    ok(`Moved ${moved} note(s). Pruned ${pruned} index link(s). Archive indexes list ${indexed} note(s).`);
  } else {
    const pruned = pol.index.prune_links ? pruneIndex(vault, moves, false) : 0;
    console.log("");
    info(`Would prune ${pruned} link(s) from index.md and regenerate the archive indexes.`);
    info(`Nothing deleted, ever — files move. Re-run with ${c.bold("--apply")} to do it.`);
  }

  if (skipped.length) {
    console.log("");
    info(`Exempt (${skipped.length}): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}`);
  }

  // The CLI-side digests dir (eval scorecards, cron digests) is harness output too,
  // but it is flat, small, and read by self-improve for scorecard diffing — so it is
  // reported rather than touched.
  const cliDigests = digestsDir();
  if (existsSync(cliDigests)) {
    const n = readdirSync(cliDigests).filter((f) => f.endsWith(".md")).length;
    if (n > 50) info(`${n} files in ${cliDigests} — scorecards are diffed by self-improve; prune by hand if needed.`);
  }

  return 0;
}
