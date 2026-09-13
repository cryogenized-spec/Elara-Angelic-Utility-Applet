import { pruneExpiredConversationMedia } from '../persistence/conversation';
import { pruneMediaCache } from './cache';

let startupSweep: Promise<void> | undefined;

/**
 * One physical media-retention sweep per application boot.
 *
 * Read paths enforce freshness independently, so startup maintenance is best
 * effort: an IndexedDB maintenance fault may leave bytes behind temporarily but
 * can never make stale API data displayable.
 */
export function runStartupMediaRetentionMaintenance(): Promise<void> {
  startupSweep ??= Promise.allSettled([
    pruneExpiredConversationMedia(),
    pruneMediaCache(),
  ]).then(() => undefined);
  return startupSweep;
}
