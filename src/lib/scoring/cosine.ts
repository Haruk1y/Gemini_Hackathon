function dotProduct(a: number[], b: number[]): number {
  const max = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < max; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function norm(values: number[]): number {
  return Math.sqrt(values.reduce((acc, current) => acc + current * current, 0));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const denominator = norm(a) * norm(b);
  if (!denominator) return 0;
  return dotProduct(a, b) / denominator;
}

export function cosineToScore(similarity: number): number {
  const clamped = Math.max(0, Math.min(1, similarity));
  return Math.round(clamped * 100);
}

export function scoreBand(score: number): "Cold" | "Warm" | "Hot" | "Perfect" {
  if (score >= 90) return "Perfect";
  if (score >= 70) return "Hot";
  if (score >= 40) return "Warm";
  return "Cold";
}
