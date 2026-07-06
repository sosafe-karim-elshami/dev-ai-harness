// `harness self-improve` — a read-only reflection pass that proposes ways to
// improve the harness itself (skills, routing, knowledge/), as DRAFTS only.
//
// It runs the /self-improve command through the normal executeContext path, so
// it inherits CLAUDE.md routing and the guard hook. Autonomous (draft-only): it
// never commits, never sends, never edits remote state. Adapted from the
// self-improving-agent pattern (see knowledge/reuse-decisions.md) instead of
// installing the upstream plugin, so it composes with our safety envelope.

import { executeContext } from "./run.js";
import { banner } from "./ui.js";

export async function selfImprove(rest: string[]): Promise<number> {
  const digest = rest.includes("--digest");
  const extra = rest.filter((a) => a !== "--digest").join(" ").trim();
  const prompt = extra ? `/self-improve ${extra}` : "/self-improve";

  banner();
  await executeContext({ context: "self-improve", prompt, digest });
  return 0;
}
