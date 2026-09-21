import { ClickUpOAuthVault } from './oauth-vault';

export class TestClickUpOAuthVault extends ClickUpOAuthVault {
  credentialSnapshot(): {
    accessCipher: string;
    accessIv: string;
    userId: string;
    username: string | null;
    email: string | null;
    workspacesJson: string;
    updatedAt: number;
  } | null {
    const row = this.credentialRow();
    if (!row) return null;
    return {
      accessCipher: row.access_cipher,
      accessIv: row.access_iv,
      userId: row.user_id,
      username: row.username,
      email: row.email,
      workspacesJson: row.workspaces_json,
      updatedAt: row.updated_at,
    };
  }

  forceCredentialUpdatedAt(updatedAt: number): void {
    this.ctx.storage.sql.exec('UPDATE clickup_oauth_credential SET updated_at = ? WHERE slot = 1', updatedAt);
  }

  rateLimitSnapshot(): { limit: number | null; remaining: number | null; resetAt: number | null } | null {
    const row = this.ctx.storage.sql.exec<{ limit_count: number | null; remaining: number | null; reset_at: number | null }>(
      'SELECT limit_count, remaining, reset_at FROM clickup_rate_limit WHERE slot = 1',
    ).toArray()[0];
    return row ? { limit: row.limit_count, remaining: row.remaining, resetAt: row.reset_at } : null;
  }

  taskIndexSnapshot(workspaceId: string): {
    fullSyncComplete: boolean;
    nextPage: number;
    lastRefreshAt: number;
    lastProviderUpdatedAt: number;
    indexedTasks: number;
    incrementalSince: number;
    incrementalNextPage: number;
    incrementalMaxUpdatedAt: number;
  } {
    const row = this.ctx.storage.sql.exec<{
      full_sync_complete: number;
      next_page: number;
      last_refresh_at: number;
      last_provider_updated_at: number;
      incremental_since: number;
      incremental_next_page: number;
      incremental_max_updated_at: number;
    }>(
      'SELECT full_sync_complete, next_page, last_refresh_at, last_provider_updated_at, incremental_since, incremental_next_page, incremental_max_updated_at FROM clickup_task_index_state WHERE workspace_id = ?',
      workspaceId,
    ).toArray()[0];
    const count = this.ctx.storage.sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM clickup_task_index WHERE workspace_id = ?',
      workspaceId,
    ).toArray()[0]?.count ?? 0;
    return {
      fullSyncComplete: row?.full_sync_complete === 1,
      nextPage: row?.next_page ?? 0,
      lastRefreshAt: row?.last_refresh_at ?? 0,
      lastProviderUpdatedAt: row?.last_provider_updated_at ?? 0,
      indexedTasks: count,
      incrementalSince: row?.incremental_since ?? 0,
      incrementalNextPage: row?.incremental_next_page ?? 0,
      incrementalMaxUpdatedAt: row?.incremental_max_updated_at ?? 0,
    };
  }

  forceTaskIndexRefreshAt(workspaceId: string, value: number): void {
    this.ctx.storage.sql.exec(
      'UPDATE clickup_task_index_state SET last_refresh_at = ? WHERE workspace_id = ?',
      value,
      workspaceId,
    );
  }

  forceTaskIndexIndexedAt(workspaceId: string, value: number): void {
    this.ctx.storage.sql.exec(
      'UPDATE clickup_task_index SET indexed_at = ? WHERE workspace_id = ?',
      value,
      workspaceId,
    );
  }
}
