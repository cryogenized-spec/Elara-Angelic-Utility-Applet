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
export const taskService = new GoogleTasksService({
  ...googleOAuthAuthority,
  async authorize(capability) {
    const account = await admittedAccount(capability);
    const access = await googleOAuthAuthority.authorize(capability);
    await admittedAccount(capability, account);
    return { capability, fetch: async (input, init) => {
      await admittedAccount(capability, account);
      return access.fetch(input, init);
    } };
  },
});
