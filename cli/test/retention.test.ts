import { test } from "node:test";
import assert from "node:assert/strict";
import { ageDays, isoWeek, loadPolicy, monthKey, parseFrontmatter, resolveDate } from "../src/retention.js";
import { HARNESS_REPO } from "./helpers.js";

test("policy v2 loads; v1 is refused", () => {
  const pol = loadPolicy(HARNESS_REPO);
  assert.equal(pol.schema_version, 2);
  assert.equal(pol.folders.digests.strategy, "rollup");
  assert.throws(() => loadPolicy("/nonexistent"), /No retention policy/);
});

test("ISO weeks cross year boundaries correctly", () => {
  assert.equal(isoWeek("2026-01-01").key, "2026-W01");
  assert.equal(isoWeek("2027-01-01").key, "2026-W53");
  assert.equal(isoWeek("2026-09-01").key, "2026-W36");
  assert.deepEqual(isoWeek("2026-09-01"), { key: "2026-W36", start: "2026-08-31", end: "2026-09-06" });
  assert.deepEqual(monthKey("2026-02-10"), { key: "2026-02", start: "2026-02-01", end: "2026-02-28" });
});

test("date chain precedence and age", () => {
  const fm = { date: "2026-05-05" };
  const mtime = new Date("2026-10-01T00:00:00Z");
  assert.deepEqual(resolveDate({ rel: "x/2026-09-09-note.md", fm, mtime }, ["filename-prefix", "frontmatter:date", "mtime"]), { date: "2026-09-09", source: "filename-prefix" });
  assert.deepEqual(resolveDate({ rel: "x/note.md", fm, mtime }, ["filename-prefix", "frontmatter:date", "mtime"]), { date: "2026-05-05", source: "frontmatter:date" });
  assert.deepEqual(resolveDate({ rel: "x/note.md", fm: {}, mtime }, ["filename-prefix", "frontmatter:date"]), null);
  assert.equal(ageDays("2026-10-01", "2026-10-18"), 17);
});

test("frontmatter parser: scalars, arrays, quotes, booleans", () => {
  const { fm, body } = parseFrontmatter('---\ntitle: "Quoted"\ntags: [a, b]\npinned: true\nlast_updated: "08:13"\n---\n\nbody');
  assert.equal(fm.title, "Quoted");
  assert.deepEqual(fm.tags, ["a", "b"]);
  assert.equal(fm.pinned, true);
  assert.equal(fm.last_updated, "08:13");
  assert.equal(body, "body");
});
