/**
 * Pearson product-moment correlation coefficient between two equal-length
 * numeric series. Foundation for the larger "real-world correlation analysis"
 * feature tracked in future/IDEAS.md — this module is the pure-stats kernel;
 * AI-driven scraping + DOD report generation will compose on top of it.
 *
 * Conventions:
 * - Both inputs must be the same length (mismatch throws).
 * - At least 2 samples required.
 * - Returns NaN when either series has zero variance (constant), because the
 *   correlation is undefined in that case. Callers must treat NaN as
 *   "no signal" rather than "no correlation".
 */
export function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length) {
    throw new Error(
      `pearson: length mismatch (${x.length} vs ${y.length})`,
    );
  }
  if (x.length < 2) {
    throw new Error("pearson: need at least 2 samples");
  }
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]!;
    sumY += y[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return NaN;
  return num / den;
}

/**
 * Convenience predicate: is the absolute correlation strong enough to
 * justify spending downstream cycles (scraping, LLM report generation)?
 * Threshold defaults to 0.7 (commonly cited "strong" cutoff).
 */
export function isSignificantCorrelation(r: number, threshold = 0.7): boolean {
  if (Number.isNaN(r)) return false;
  return Math.abs(r) >= threshold;
}
