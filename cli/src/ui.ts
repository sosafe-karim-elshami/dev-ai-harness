// Branded terminal UI helpers — the distinct "harness" interface.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  cyan: wrap(36, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  magenta: wrap(35, 39),
};

/** The prompt string shown in interactive mode and as a marker. */
export const PROMPT = (context: string) => c.magenta(`harness:${context} › `);

export function banner(): void {
  const line = c.magenta("▟▙ harness");
  process.stdout.write(
    `\n${line} ${c.dim("— Claude Code, wired to your world")}\n\n`,
  );
}

export function header(context: string, isNew: boolean): void {
  const tag = isNew ? c.green("new") : c.dim("resumed");
  process.stdout.write(`${c.magenta("◆")} ${c.bold(context)} ${c.dim(`[${tag}]`)}\n\n`);
}

export function footer(costUsd: number | null, durationMs: number | null): void {
  const parts: string[] = [];
  if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (costUsd != null) parts.push(`$${costUsd.toFixed(4)}`);
  if (parts.length) process.stdout.write(c.dim(`\n\n  ${parts.join("  ·  ")}\n`));
  else process.stdout.write("\n");
}

export function info(msg: string): void {
  process.stdout.write(`${c.cyan("›")} ${msg}\n`);
}
export function ok(msg: string): void {
  process.stdout.write(`${c.green("✓")} ${msg}\n`);
}
export function warn(msg: string): void {
  process.stdout.write(`${c.yellow("!")} ${msg}\n`);
}
export function fail(msg: string): void {
  process.stderr.write(`${c.red("✗")} ${msg}\n`);
}
