import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, parseLinks, report, repairPreArchive, resolveTarget, rewriteForMoves } from "../src/links.js";
import { tempVault } from "./helpers.js";

test("parseLinks handles alias, heading, embed and skips code", () => {
  const md = "a [[x/y|Alias]] b ![[img]] c [[z#Head]]\n```\n[[not/me]]\n```\nd `[[nor/me]]` e";
  const links = parseLinks(md);
  assert.deepEqual(links.map((l) => l.target), ["x/y", "img", "z"]);
  assert.equal(links[0].alias, "Alias");
  assert.equal(links[1].embed, true);
  assert.equal(links[2].heading, "Head");
});

test("resolveTarget: exact, relative, basename, pre-archive, ambiguous, dangling", () => {
  const v = tempVault();
  const idx = buildIndex(v);
  assert.equal(resolveTarget("knowledge/lt-runbook", "index.md", idx).kind, "exact");
  assert.equal(resolveTarget("../knowledge/lt-runbook", "memory/index.md", idx).kind, "relative");
  assert.equal(resolveTarget("lt-runbook", "index.md", idx).kind, "basename");
  assert.equal(resolveTarget("digests/2026-08-19", "index.md", idx).kind, "pre-archive");
  // A bare [[index]] is the root index (exact rel path), even though memory/index.md exists too.
  assert.equal(resolveTarget("index", "knowledge/lt-runbook.md", idx).kind, "exact");
  assert.deepEqual(Object.keys(report(v).duplicateBasenames), ["index"]);
  assert.equal(resolveTarget("nope/none", "index.md", idx).kind, "dangling");
});

test("rewriteForMoves re-points referrers and fixes relative links in moved files", () => {
  const v = tempVault();
  const moves = [{ from: "digests/2026-09-01.md", to: "digests/archive/2026-09-01.md" }];
  const dry = rewriteForMoves(v, moves, false);
  assert.ok(dry.linksRewritten >= 2, "runbook + memory index link");
  const before = readFileSync(join(v, "knowledge", "lt-runbook.md"), "utf8");
  assert.ok(before.includes("[[digests/2026-09-01]]"));
  rewriteForMoves(v, moves, true);
  mkdirSync(join(v, "digests", "archive"), { recursive: true });
  renameSync(join(v, moves[0].from), join(v, moves[0].to));
  assert.ok(readFileSync(join(v, "knowledge", "lt-runbook.md"), "utf8").includes("[[digests/archive/2026-09-01]]"));
  assert.ok(readFileSync(join(v, "memory", "index.md"), "utf8").includes("[[digests/archive/2026-09-01]]"));
  assert.equal(report(v).dangling.length, 0);
});

test("repairPreArchive fixes links to already-archived notes", () => {
  const v = tempVault();
  assert.equal(report(v).preArchive.length, 1);
  const r = repairPreArchive(v, true);
  assert.equal(r.linksRewritten, 1);
  assert.equal(report(v).preArchive.length, 0);
});
