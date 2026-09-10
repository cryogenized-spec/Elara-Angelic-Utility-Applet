// Keyset pagination for cloud run/event history. Timestamp high-water marks
// skip same-ms siblings and older rows when a bounded DESC page is consumed
// newest-first. Pages are strictly after (at, id), ASC, so the client only
// advances past records it has actually received.

export const HISTORY_PAGE_SIZE = 200;

export interface HistoryCursor {
  at: number;
  id: string;
}

export const EMPTY_HISTORY_CURSOR: HistoryCursor = { at: 0, id: '' };

export function parseHistoryCursor(search: URLSearchParams): { cursor: HistoryCursor; limit: number } {
  const at = Number(search.get('afterAt') ?? '0');
  const id = search.get('afterId') ?? '';
  const rawLimit = Number(search.get('limit') ?? String(HISTORY_PAGE_SIZE));
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(HISTORY_PAGE_SIZE, Math.floor(rawLimit))) : HISTORY_PAGE_SIZE;
  return {
    cursor: { at: Number.isFinite(at) ? at : 0, id },
    limit,
  };
}

export function nextHistoryCursor<T extends { id: string }>(page: readonly T[], stamp: (row: T) => number, limit: number): HistoryCursor | null {
  if (page.length === 0 || page.length < limit) return null;
  const last = page[page.length - 1]!;
  return { at: stamp(last), id: last.id };
}
