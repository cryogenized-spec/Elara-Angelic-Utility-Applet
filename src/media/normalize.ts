/**
 * Query normalization for media search.
 *
 * Pure and dependency-free so it can be shared by the cache key, the budget
 * ledger, and the dedupe step without any of them importing each other.
 */

/** Collapse case, Unicode form, whitespace, and stray punctuation. */
export function normalizeMediaQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLowerCase()
    // Whitespace runs collapse; a query is a bag of words, not a layout.
    .replace(/\s+/g, ' ')
    // Leading/trailing punctuation is typing noise, not intent.
    .replace(/^[\s\p{P}\p{S}]+/u, '')
    .replace(/[\s\p{P}\p{S}]+$/u, '')
    .trim();
}

/**
 * Cache/budget key. Namespaced and versioned so a change in normalization or in
 * the stored payload shape invalidates old entries instead of misreading them.
 */
export function mediaCacheKey(provider: string, query: string): string {
  return `${provider}:v1:${normalizeMediaQuery(query)}`;
}

/**
 * Deduplicate a batch of queries while preserving order. Two callers asking for
 * "Dark Ambient" and "dark  ambient!" must cost one API call, not two.
 */
export function dedupeMediaQueries(queries: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = normalizeMediaQuery(query);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(query.trim());
  }
  return result;
}
