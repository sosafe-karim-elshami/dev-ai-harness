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

const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Remove archived notes' links from index.md. The vault's convention is that the
 * index lists what's live — previous manual archiving deleted these entries rather
 * than re-pointing them.
 *
 * This works per LINK, not per line. Index lines are sometimes compound
 * (`- [[digests/2026-08-13|Aug 13]] · [[digests/2026-08-12|Aug 12]]`), so dropping
 * the whole line would take a live link with it, while keeping the whole line
 * would leave a link pointing at a moved file. Strip just the archived links; drop
 * the line only once nothing linkable is left on it.
 */
function pruneIndex(root: string, apply: boolean): { links: number; lines: number } {
  const indexPath = join(root, "index.md");
  if (!existsSync(indexPath)) return { links: 0, lines: 0 };

  // Archived-ness is determined from DISK, not from this run's move list: the live
  // file is gone and an archive/ copy exists. That makes the reconcile idempotent
  // and self-healing — it repairs links left dangling by an earlier run or by a
  // manual move, not just the files this invocation touched.
  const isArchived = (target: string): boolean => {
    const slash = target.lastIndexOf("/");
    if (slash === -1) return false;
    const folder = target.slice(0, slash);
    const name = target.slice(slash + 1);
    if (folder.endsWith("/archive") || folder === "archive") return false;
    return !existsSync(join(root, folder, `${name}.md`)) && existsSync(join(root, folder, "archive", `${name}.md`));
  };
  const archived = { has: isArchived };

  const src = readFileSync(indexPath, "utf8").split("\n");
  const out: string[] = [];
  let links = 0;
  let dropped = 0;

  for (const line of src) {
    const present = [...line.matchAll(LINK)].map((x) => x[1]);
    const hits = present.filter((l) => archived.has(l));
    if (!hits.length) {
      out.push(line);
      continue;
    }
    links += hits.length;

    if (hits.length === present.length) {
      // Nothing live on this line — drop it, matching the existing convention.
      dropped++;
      continue;
    }

    // Compound line: excise only the archived links, then tidy the separators they
    // leave behind (` · `, a trailing bullet, a dangling em-dash).
    let next = line.replace(LINK, (whole, target: string) => (archived.has(target) ? "" : whole));
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
    // Still reconcile: a link can dangle from an earlier run or a manual move, and
    // the whole point of a disk-driven reconcile is that it doesn't need this run
    // to have moved anything.
    const pruned = pol.index.prune_links ? pruneIndex(vault, apply) : { links: 0, lines: 0 };
    if (pruned.links) {
      if (apply) ok(`Reconciled index.md: pruned ${pruned.links} dangling link(s), removed ${pruned.lines} line(s).`);
      else info(`index.md has ${pruned.links} link(s) pointing at already-archived notes. Re-run with --apply to prune.`);
    }
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
    const pruned = pol.index.prune_links ? pruneIndex(vault, true) : { links: 0, lines: 0 };
    let indexed = 0;
    for (const folder of byFolder.keys()) indexed += writeArchiveIndex(vault, folder, true);

    console.log("");
    ok(
      `Moved ${moved} note(s). Pruned ${pruned.links} index link(s) (${pruned.lines} line(s) removed outright). ` +
        `Archive indexes list ${indexed} note(s).`,
    );
  } else {
    const pruned = pol.index.prune_links ? pruneIndex(vault, false) : { links: 0, lines: 0 };
    console.log("");
    info(`Would prune ${pruned.links} link(s) from index.md, removing ${pruned.lines} line(s) outright.`);
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
