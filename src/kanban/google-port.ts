import { RetryableReadError, retryAfterMilliseconds } from './sync-policy';
import { googleOAuthAuthority } from '../google/oauth/authority';
import type { GoogleCapabilityKey } from '../google/oauth/contracts';
import { GoogleTasksService } from '../google/tasks/service';

export type { GoogleTask, GoogleTaskStatus, TaskListSummary } from '../google/tasks/service';
export type TaskReader = Pick<GoogleTasksService, 'listTaskLists' | 'listTasks'>;

/** Human board admission is separate from model tool confirmation, but uses the
 * same effective capabilities and live-session policy. Timers never request consent. */
async function admittedAccount(capability: GoogleCapabilityKey, expected?: string): Promise<string> {
  const status = await googleOAuthAuthority.getStatus();
  const account = status.account?.email.toLowerCase();
  if (!['connected', 'partially-authorized'].includes(status.state) || !status.sessionReady || !account || !status.grantedCapabilities.includes(capability)) {
    throw new Error('Connect or unlock Google and enable the required Tasks permission in Settings.');
  }
  if (expected && expected !== account) throw new Error('Google account changed. Sync the current workspace before continuing.');
  return account;
}

// Only this reviewed board port may construct a Google service. Neither UI nor
// persistence receives access tokens or arbitrary provider fetch authority.
function createTaskService(expectedAccount?: string): GoogleTasksService {
  return new GoogleTasksService({
    ...googleOAuthAuthority,
    async authorize(capability) {
      const account = await admittedAccount(capability, expectedAccount);
      if (!googleOAuthAuthority.authorizeExisting) throw new Error('Google background authorization is unavailable. Refresh the Google session in Settings.');
      const access = await googleOAuthAuthority.authorizeExisting(capability);
      await admittedAccount(capability, account);
      return { capability, fetch: async (input, init) => {
        init?.signal?.throwIfAborted();
        await admittedAccount(capability, account);
        init?.signal?.throwIfAborted();
        // Only GET failures are eligible for automatic retry. Mutations retain
        // their original errors and must never be replayed by the board timer.
        const isRead = !init?.method || init.method.toUpperCase() === 'GET';
        let response: Response;
        try {
          response = await access.fetch(input, init, async () => {
            init?.signal?.throwIfAborted();
            await admittedAccount(capability, account);
            init?.signal?.throwIfAborted();
          });
        }
        catch (error) {
          if (isRead && !init?.signal?.aborted && error instanceof TypeError) throw new RetryableReadError('Google Tasks is temporarily unreachable.');
          throw error;
        }
        if (isRead && [429, 500, 502, 503, 504].includes(response.status)) {
          const delay = retryAfterMilliseconds(response.headers.get('retry-after'));
          // The error body is not task data and must not enter the memo/context.
          await response.body?.cancel();
          throw new RetryableReadError(`Google Tasks is temporarily unavailable (${response.status}).`, delay);
        }
        return response;
      } };
    },
  });
}

export const taskService = createTaskService();

export function taskServiceForAccount(expectedAccount: string): GoogleTasksService {
  const account = expectedAccount.trim().toLowerCase();
  if (!account) throw new Error('A Google account is required to bind this Kanban action.');
  return createTaskService(account);
}

export type TaskWriter = Pick<GoogleTasksService, 'updateSemanticTask' | 'createSemanticTask'>;
