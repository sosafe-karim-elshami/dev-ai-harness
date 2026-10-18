import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { itemKey, ledger, planAll, runCompress } from "../src/compress.js";
import { listMarkdown } from "../src/links.js";
import { loadPolicy, readNote } from "../src/retention.js";
import { HARNESS_REPO, TODAY, stubRunner, tempVault } from "./helpers.js";

const opts = (vault: string, extra: Partial<Parameters<typeof runCompress>[0]> = {}) => ({
  apply: false, vault, harnessRepo: HARNESS_REPO, maxBudgetUsd: 3, force: false, knowledge: false, today: TODAY, log: () => {}, ...extra,
});

test("itemKey normalises carried-forward copies to one key", () => {
  assert.equal(itemKey("🔴 Ship the rollup engine — due: Fri"), itemKey("Ship the rollup engine"));
  assert.equal(itemKey("[LTC-1561] PDF viewer plan *(carried from 2026-08-19)*"), itemKey("[LTC-1561] PDF viewer plan"));
  assert.ok(itemKey("[LTC-1561] PDF viewer plan").startsWith("ticket:ltc-1561:"));
});

test("ledger: last child is authoritative; closed and dropped are partitioned", () => {
  const v = tempVault();
  const kids = ["2026-09-01", "2026-09-02", "2026-09-04"].map((d) => readNote(v, `digests/${d}.md`, "digests", ["filename-prefix"]));
  const led = ledger(kids, new Map([[itemKey("[LTC-1561] PDF viewer plan"), "2026-08-19"]]));
  assert.deepEqual(led.open.map((i) => i.text).sort(), ["Write weekly summary — overdue 2d", "[LTC-1561] PDF viewer plan *(carried from 2026-08-19)*"]);
  assert.equal(led.open.find((i) => i.text.includes("LTC-1561"))!.firstSeen, "2026-08-19");
  assert.equal(led.closed.length, 1);
  assert.equal(led.closed[0].closedOn, "2026-09-04");
  assert.deepEqual(led.dropped.map((i) => i.text).sort(), ["Grant full disk access to node", "Update runbook [[knowledge/lt-runbook]]"]);
  assert.equal(led.team.length, 1);
});

test("planAll: two weekly rollups, one meeting distill, three archive moves, two knowledge clusters", () => {
  const v = tempVault();
  const plan = planAll(opts(v), loadPolicy(HARNESS_REPO));
  assert.deepEqual(plan.rollups.map((r) => r.period.key).sort(), ["2026-W36", "2026-W37"]);
  assert.equal(plan.rollups[0].status, "new");
  assert.deepEqual(plan.distills.map((d) => `${d.stem}-${d.period.key}`), ["ltc-daily-2026-08"]);
  assert.deepEqual(plan.archive.map((m) => `${m.rel}:${m.reason}`).sort(), [
    "digests/2026-09-15.md:single-child",
    "knowledge/expired-note.md:expired",
    "meetings/2026-08-20-design-review.md:single-child",
  ]);
  assert.equal(plan.knowledge.length, 2);
  assert.ok(plan.knowledge.some((k) => k.key === "ltc-1200"));
});

test("dry run writes nothing", async () => {
  const v = tempVault();
  const before = listMarkdown(v).map((r) => `${r}:${readFileSync(join(v, r), "utf8").length}`).join("|");
  const { results } = await runCompress(opts(v, { runner: stubRunner() }));
  assert.ok(results.some((r) => r.startsWith("would roll up")));
  const after = listMarkdown(v).map((r) => `${r}:${readFileSync(join(v, r), "utf8").length}`).join("|");
  assert.equal(before, after);
});

test("apply: rollups written, originals moved not deleted, links rewritten, idempotent on re-run", async () => {
  const v = tempVault();
  const n0 = listMarkdown(v).length;
  const calls: Array<{ model: string; prompt: string }> = [];
  const r1 = await runCompress(opts(v, { apply: true, runner: stubRunner(calls) }));
  assert.equal(calls.length, 3, "2 weekly rollups + 1 meeting distill");
  assert.ok(existsSync(join(v, "digests", "weekly", "2026-W36.md")));
  assert.ok(existsSync(join(v, "meetings", "rollups", "ltc-daily-2026-08.md")));
  assert.ok(existsSync(join(v, "digests", "archive", "2026-09-01.md")), "original moved");
  assert.ok(!existsSync(join(v, "digests", "2026-09-01.md")));
  assert.ok(existsSync(join(v, "knowledge", "archive", "expired-note.md")), "expired moved");
  const n1 = listMarkdown(v).length;
  assert.ok(n1 >= n0 + 3, `file count never decreases (${n0} → ${n1})`);

  const weekly = readFileSync(join(v, "digests", "weekly", "2026-W36.md"), "utf8");
  assert.ok(weekly.includes("children_hash: sha256:"));
  assert.ok(weekly.includes("[[digests/archive/2026-09-01]]"), "children listed at archive paths");
  assert.ok(weekly.includes("- [ ] [LTC-1561] PDF viewer plan"), "open item carried verbatim");
  assert.ok(weekly.includes("first seen 2026-08-19"), "first-seen from archived history");
  assert.ok(weekly.includes("- [x] 🔴 Ship the rollup engine"), "closed item");

  assert.ok(readFileSync(join(v, "knowledge", "lt-runbook.md"), "utf8").includes("[[digests/archive/2026-09-01]]"), "referrer rewritten");
  assert.ok(readFileSync(join(v, "meetings", "archive", "2026-08-12-ltc-daily.md"), "utf8").includes("[[meetings/archive/2026-08-05-ltc-daily]]"), "moved file's link rewritten");
  const log = readFileSync(join(v, "knowledge", "decision-log.md"), "utf8");
  assert.ok(log.includes("## 2026-08") && log.includes("Migrate P2L"), "decision promoted");

  const index = readFileSync(join(v, "index.md"), "utf8");
  assert.ok(index.includes("<!-- harness:recent:begin -->"));
  assert.ok(index.includes("hand-written summary kept"));
  assert.ok(!index.includes("[[digests/2026-08-19"), "archived link pruned");
  assert.ok(index.includes("[[digests/weekly/2026-W36"));
  assert.ok(existsSync(join(v, "digests", `${TODAY}-compress-plan.md`)));
  assert.ok(r1.costUsd > 0);

  const calls2: Array<{ model: string; prompt: string }> = [];
  const r2 = await runCompress(opts(v, { apply: true, runner: stubRunner(calls2) }));
  assert.equal(calls2.length, 0, "second run makes no LLM calls");
  assert.equal(r2.plan.rollups.length, 0);
  assert.equal(listMarkdown(v).length, n1, "second run moves nothing");
});

test("archive-only mode moves aged notes but leaves rollup-eligible dailies live", async () => {
  const v = tempVault();
  const calls: Array<{ model: string; prompt: string }> = [];
  await runCompress(opts(v, { apply: true, only: "archive", runner: stubRunner(calls) }));
  assert.equal(calls.length, 0);
  assert.ok(existsSync(join(v, "digests", "2026-09-01.md")), "rollup child stays live");
  assert.ok(existsSync(join(v, "digests", "archive", "2026-09-15.md")), "single-child aged note moved");
  assert.ok(existsSync(join(v, "knowledge", "archive", "expired-note.md")));
});
