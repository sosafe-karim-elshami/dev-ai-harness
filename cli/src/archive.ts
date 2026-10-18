// `harness archive` — the rule-only subset of `harness compress`: aged, expired and
// superseded notes move to archive/ with links rewritten. No LLM, no rollups, so it
// is safe anywhere `claude` is not. Dry run unless --apply. Never deletes.

import { compress } from "./compress.js";

export function archive(argv: string[]): Promise<number> {
  return compress([...argv.filter((a) => a !== "--only" && a !== "archive"), "--only", "archive"]);
}
