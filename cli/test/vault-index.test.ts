import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "../src/retention.js";
import { orderAndOverflow, regenerateRecent } from "../src/vault-index.js";
import { HARNESS_REPO, TODAY, tempVault } from "./helpers.js";

test("regenerateRecent inserts markers and keeps hand-written summaries", () => {
  const v = tempVault();
  const pol = loadPolicy(HARNESS_REPO);
  assert.equal(regenerateRecent(v, pol, true), true);
  const idx = readFileSync(join(v, "index.md"), "utf8");
  assert.ok(idx.includes("## Recent\n"));
  assert.ok(idx.includes("hand-written summary kept"));
  assert.ok(idx.includes("[[digests/2026-09-01|📅 2026-09-01]]"), "live dailies listed");
});

test("orderAndOverflow ranks starred/linked notes first and overflows past the budget", () => {
  const v = tempVault();
  const pol = loadPolicy(HARNESS_REPO);
  const r = orderAndOverflow(v, pol, true, TODAY);
  const idx = readFileSync(join(v, "index.md"), "utf8").split("\n");
  const runbook = idx.findIndex((l) => l.includes("knowledge/lt-runbook"));
  const old = idx.findIndex((l) => l.includes("knowledge/ltc-1200-old-plan"));
  assert.ok(runbook < old, "starred, recent, linked runbook ranks above the stale plan");
  assert.equal(r.overflowed, 0);

  const tight = { ...pol, index: { ...pol.index, max_index_lines: 20 } };
  const r2 = orderAndOverflow(v, tight, true, TODAY);
  assert.ok(r2.overflowed > 0);
  assert.ok(existsSync(join(v, "knowledge", "index.md")));
  assert.ok(readFileSync(join(v, "index.md"), "utf8").includes("more in [[knowledge/index]]"));
});
