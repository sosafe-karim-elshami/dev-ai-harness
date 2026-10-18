import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
/** The compiled test lives in dist-test/test/; fixtures stay under cli/test/fixtures. */
export const FIXTURE = join(here, "..", "..", "test", "fixtures", "vault");
export const HARNESS_REPO = join(here, "..", "..", "..");
export const TODAY = "2026-10-18";

export function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-vault-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export const stubRunner = (calls: Array<{ model: string; prompt: string }> = []) =>
  async <T,>(o: { model: string; prompt: string; schema: object; stdinBody: string }): Promise<{ data: T; costUsd: number; durationMs: number; model: string }> => {
    calls.push({ model: o.model, prompt: o.prompt });
    const isMeeting = o.prompt.includes("meeting");
    const isKnowledge = o.prompt.includes("operation");
    const data = isKnowledge
      ? { proposals: [] }
      : isMeeting
        ? { summary: "Stub meeting summary.", decisions: [{ date: "2026-08-05", text: "Migrate P2L to the new rights model", source: "meetings/2026-08-05-ltc-daily" }], recurring_topics: [], status_changes: [] }
        : { summary: "Stub weekly summary.", themes: [{ title: "Rollups", detail: "Built the engine", evidence: ["digests/2026-09-01"] }], decisions: [], docs_to_update: [], merge_groups: [] };
    return { data: data as T, costUsd: 0.01, durationMs: 5, model: o.model };
  };
