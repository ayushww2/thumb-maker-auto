const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "it",
  "as",
  "into",
  "what",
  "they",
  "just",
  "will",
  "you",
  "its",
  "it's",
  "after",
  "before",
  "about",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function bigrams(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function titleSimilarity(query: string, candidate: string): number {
  const qt = tokenize(query);
  const ct = tokenize(candidate);
  if (!qt.length || !ct.length) return 0;

  const qSet = new Set(qt);
  const cSet = new Set(ct);
  const tokenScore = jaccard(qSet, cSet);
  const biScore = jaccard(bigrams(qt), bigrams(ct));

  // Shared rare-ish tokens boost
  let overlapBoost = 0;
  for (const t of qSet) {
    if (cSet.has(t) && t.length >= 5) overlapBoost += 0.03;
  }

  return Math.min(1, tokenScore * 0.55 + biScore * 0.35 + overlapBoost);
}

export function scoreCompetitor(input: {
  query: string;
  title: string;
  viewCount: number;
}): number {
  const sim = titleSimilarity(input.query, input.title);
  const viewBoost = Math.log10(Math.max(input.viewCount, 1)) / 8; // ~0.4–0.9
  return sim * 0.82 + viewBoost * 0.18 * Math.min(1, sim * 3);
}
