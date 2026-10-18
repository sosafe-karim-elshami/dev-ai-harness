// Token-set similarity, shared by `harness memory audit` and knowledge consolidation.

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/^---[\s\S]*?\n---\n?/, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Pairs at or above the threshold, each pair once. */
export function nearDuplicates<T extends { rel: string; text: string }>(notes: T[], threshold: number): Array<{ a: T; b: T; score: number }> {
  const toks = notes.map((n) => tokenize(n.text));
  const out: Array<{ a: T; b: T; score: number }> = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const score = jaccard(toks[i], toks[j]);
      if (score >= threshold) out.push({ a: notes[i], b: notes[j], score: Math.round(score * 1000) / 1000 });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
