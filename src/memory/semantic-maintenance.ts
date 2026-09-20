import { isSemanticFileStale } from './semantic-evidence';
import { listSemanticFiles } from './semantic-file';
import { rebuildSemanticFile } from './semantic-rebuild';
import { listMemories } from './store';
import type { SemanticSynthesisExtractor } from './semantic-synthesis';

/**
 * Lazy, incremental maintenance for the semantic cabinet (Pass 7).
 *
 * The cabinet has no timers and no background sweeps: maintenance runs only
 * when a human explicitly triggers it, and even then it is strictly bounded
 * and convergent:
 *
 * - one file at a time, sequentially — no parallel rebuild storms;
 * - a bounded window (`limit`, default 5, hard cap 50) per run; stale files
 *   beyond the window are reported as deferred, never silently dropped;
 * - deterministic work ordering (stable ID sort), so repeated runs over the
 *   same state do the same work and the deferred list is stable;
 * - the staleness set is computed ONCE before any write. A file that becomes
 *   stale only because of this run's own writes is left for the next run —
 *   the sweep never feeds its output back into itself (no recursive
 *   synthesis);
 * - every per-file rebuild goes through the exact same fail-closed
 *   `rebuildSemanticFile` path as an explicit human refresh, with evidence
 *   drawn only from canonical `db.memories` — never from other semantic
 *   files.
 *
 * Maintenance never deletes files, never mutates `db.memories`, and an
 * unchanged rebuild advances no version.
 */

export const SEMANTIC_MAINTENANCE_DEFAULT_LIMIT = 5;
export const SEMANTIC_MAINTENANCE_MAX_LIMIT = 50;

export interface SemanticMaintenanceOptions {
  /** Bounded window: at most this many stale files are rebuilt per run. */
  limit?: number;
  signal?: AbortSignal;
}

export interface SemanticMaintenanceReport {
  /** Valid semantic files considered. */
  scanned: number;
  /** Files found stale before any maintenance write. */
  stale: number;
  /** Files actually rebuilt during this run. */
  processed: number;
  /** Rebuilds that changed file content. */
  refreshed: number;
  /** Rebuilds whose grounded content was already current (no version advance). */
  unchanged: number;
  /** Rebuilds rejected by fail-closed validation (nothing written). */
  rejected: number;
  /** Rebuilds that could not run (lease/policy/concurrency) and stay deferred. */
  unavailable: number;
  /** Deterministic IDs of stale files left for a later run (window or abort). */
  deferredFileIds: string[];
  /** True when a later run would still have work. */
  nextRunHasWork: boolean;
}

/**
 * Run one bounded lazy maintenance sweep over stale semantic files.
 * The extractor is the caller's synthesis provider; it is invoked at most
 * `limit` times, one per file.
 */
export async function maintainSemanticFiles(
  extractor: SemanticSynthesisExtractor,
  options: SemanticMaintenanceOptions = {},
): Promise<SemanticMaintenanceReport> {
  const requested = options.limit ?? SEMANTIC_MAINTENANCE_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(Math.floor(requested) || SEMANTIC_MAINTENANCE_DEFAULT_LIMIT, SEMANTIC_MAINTENANCE_MAX_LIMIT));
  const files = await listSemanticFiles();
  const memories = await listMemories();

  // Stale set frozen before any write: deterministic, self-contained, and
  // immune to this run's own effects (no recursive synthesis).
  const stale = files
    .filter((file) => isSemanticFileStale(file, memories))
    .sort((left, right) => left.id.localeCompare(right.id));

  const report: SemanticMaintenanceReport = {
    scanned: files.length,
    stale: stale.length,
    processed: 0,
    refreshed: 0,
    unchanged: 0,
    rejected: 0,
    unavailable: 0,
    deferredFileIds: stale.map((file) => file.id),
    nextRunHasWork: false,
  };

  const window = stale.slice(0, limit);
  for (const file of window) {
    if (options.signal?.aborted) break;
    const result = await rebuildSemanticFile({
      // The maintenance proposal echoes the file's own existing identity.
      // Resolution is exact-key, so this can only ever match the same file —
      // maintenance cannot redirect a rebuild onto a different concept.
      proposal: {
        kind: file.kind,
        canonicalLabel: file.title,
        aliases: file.aliases,
        evidenceRef: file.summary,
      },
      extractor,
      signal: options.signal,
    });
    report.processed += 1;
    report.deferredFileIds = report.deferredFileIds.filter((id) => id !== file.id);
    switch (result.status) {
      case 'created':
      case 'refreshed':
        report.refreshed += 1;
        break;
      case 'unchanged':
        report.unchanged += 1;
        break;
      case 'rejected':
        report.rejected += 1;
        break;
      case 'unavailable':
        report.unavailable += 1;
        break;
    }
  }

  report.nextRunHasWork = report.deferredFileIds.length > 0;
  return report;
}
