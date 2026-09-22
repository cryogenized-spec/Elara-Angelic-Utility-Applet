import { ClickUpOAuthVault } from './oauth-vault';
import { clearClickUpWorkspaceTaskIndex, tombstoneClickUpTask } from './task-index';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function requiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim() ?? '';
  if (!value) throw new Error(`Missing test parameter: ${name}`);
  return value;
}

async function bodyRecord(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json() as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid test request body.');
  return value as Record<string, unknown>;
}

/**
 * Test-only ClickUp vault subclass.
 *
 * State inspection/mutation deliberately uses ordinary Durable Object fetch
 * requests instead of RPC methods. This keeps every cross-isolate resource on
 * the same Response lifecycle that the production boundary uses, avoiding
 * dangling RPC promise callbacks during workerd teardown.
 */
export class TestClickUpOAuthVault extends ClickUpOAuthVault {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__test/clickup/')) return super.fetch(request);

    try {
      if (request.method === 'POST' && url.pathname === '/__test/clickup/reset') {
        this.ctx.storage.transactionSync(() => {
          for (const table of [
            'clickup_oauth_states',
            'clickup_oauth_nonces',
            'clickup_oauth_credential',
            'clickup_rate_limit',
            'clickup_webhooks',
            'clickup_webhook_deliveries',
            'clickup_task_index',
            'clickup_task_index_tombstones',
            'clickup_task_index_reconcile_stage',
            'clickup_task_index_reconcile_state',
            'clickup_task_index_state',
          ]) {
            this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
          }
          this.ctx.storage.sql.exec(
            'UPDATE clickup_connection_epoch SET epoch = 0, settled_epoch = 0 WHERE slot = 1',
          );
        });
        return json({ ok: true });
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/credential') {
        const body = await bodyRecord(request);
        const accessCipher = typeof body.accessCipher === 'string' ? body.accessCipher : '';
        const accessIv = typeof body.accessIv === 'string' ? body.accessIv : '';
        const userId = typeof body.userId === 'string' ? body.userId : '';
        const username = typeof body.username === 'string' ? body.username : null;
        const email = typeof body.email === 'string' ? body.email : null;
        const workspacesJson = typeof body.workspacesJson === 'string' ? body.workspacesJson : '';
        const updatedAt = typeof body.updatedAt === 'number' && Number.isSafeInteger(body.updatedAt) ? body.updatedAt : 0;
        if (!accessCipher || !accessIv || !userId || !workspacesJson || updatedAt <= 0) {
          return json({ code: 'validation' }, 400);
        }
        this.ctx.storage.sql.exec(`
          INSERT INTO clickup_oauth_credential (
            slot, access_cipher, access_iv, user_id, username, email, workspaces_json, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slot) DO UPDATE SET
            access_cipher = excluded.access_cipher,
            access_iv = excluded.access_iv,
            user_id = excluded.user_id,
            username = excluded.username,
            email = excluded.email,
            workspaces_json = excluded.workspaces_json,
            updated_at = excluded.updated_at
        `, accessCipher, accessIv, userId, username, email, workspacesJson, updatedAt);
        return json({ ok: true });
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/credential') {
        const row = this.ctx.storage.sql.exec<{
          access_cipher: string;
          access_iv: string;
          credential_kind: string;
          user_id: string;
          username: string | null;
          email: string | null;
          workspaces_json: string;
          updated_at: number;
        }>(
          'SELECT access_cipher, access_iv, credential_kind, user_id, username, email, workspaces_json, updated_at FROM clickup_oauth_credential WHERE slot = 1',
        ).toArray()[0];
        return json(row ? {
          accessCipher: row.access_cipher,
          accessIv: row.access_iv,
          credentialKind: row.credential_kind,
          userId: row.user_id,
          username: row.username,
          email: row.email,
          workspacesJson: row.workspaces_json,
          updatedAt: row.updated_at,
        } : null);
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/rate-limit') {
        const row = this.ctx.storage.sql.exec<{
          limit_count: number | null;
          remaining: number | null;
          reset_at: number | null;
        }>(
          'SELECT limit_count, remaining, reset_at FROM clickup_rate_limit WHERE slot = 1',
        ).toArray()[0];
        return json(row ? {
          limit: row.limit_count,
          remaining: row.remaining,
          resetAt: row.reset_at,
        } : null);
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/rate-limit') {
        const body = await bodyRecord(request);
        const limit = typeof body.limit === 'number' && Number.isSafeInteger(body.limit) ? body.limit : null;
        const remaining = typeof body.remaining === 'number' && Number.isSafeInteger(body.remaining) ? body.remaining : null;
        const resetAt = typeof body.resetAt === 'number' && Number.isSafeInteger(body.resetAt) ? body.resetAt : null;
        const unknownProbeInFlight = body.unknownProbeInFlight === true ? 1 : 0;
        const updatedAt = typeof body.updatedAt === 'number' && Number.isSafeInteger(body.updatedAt)
          ? body.updatedAt
          : Date.now();
        this.ctx.storage.sql.exec(`
          INSERT INTO clickup_rate_limit (slot, limit_count, remaining, reset_at, unknown_probe_in_flight, updated_at)
          VALUES (1, ?, ?, ?, ?, ?)
          ON CONFLICT(slot) DO UPDATE SET
            limit_count = excluded.limit_count,
            remaining = excluded.remaining,
            reset_at = excluded.reset_at,
            unknown_probe_in_flight = excluded.unknown_probe_in_flight,
            updated_at = excluded.updated_at
        `, limit, remaining, resetAt, unknownProbeInFlight, updatedAt);
        return json({ ok: true });
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/task-index') {
        const workspaceId = requiredSearchParam(url, 'workspaceId');
        const row = this.ctx.storage.sql.exec<{
          full_sync_complete: number;
          next_page: number;
          last_refresh_at: number;
          last_provider_updated_at: number;
          incremental_since: number;
          incremental_next_page: number;
          incremental_max_updated_at: number;
          invalidation_generation: number;
        }>(
          'SELECT full_sync_complete, next_page, last_refresh_at, last_provider_updated_at, incremental_since, incremental_next_page, incremental_max_updated_at, invalidation_generation FROM clickup_task_index_state WHERE workspace_id = ?',
          workspaceId,
        ).toArray()[0];
        const indexedTasks = this.ctx.storage.sql.exec<{ count: number }>(
          'SELECT COUNT(*) AS count FROM clickup_task_index WHERE workspace_id = ?',
          workspaceId,
        ).toArray()[0]?.count ?? 0;
        return json({
          fullSyncComplete: row?.full_sync_complete === 1,
          nextPage: row?.next_page ?? 0,
          lastRefreshAt: row?.last_refresh_at ?? 0,
          lastProviderUpdatedAt: row?.last_provider_updated_at ?? 0,
          indexedTasks,
          incrementalSince: row?.incremental_since ?? 0,
          incrementalNextPage: row?.incremental_next_page ?? 0,
          incrementalMaxUpdatedAt: row?.incremental_max_updated_at ?? 0,
          invalidationGeneration: row?.invalidation_generation ?? 0,
        });
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/task-index/tombstone') {
        const body = await bodyRecord(request);
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
        const taskId = typeof body.taskId === 'string' ? body.taskId : '';
        if (!workspaceId || !taskId) return json({ code: 'validation' }, 400);
        tombstoneClickUpTask(this.ctx.storage.sql, workspaceId, taskId, Date.now());
        return json({ ok: true });
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/task-index/clear-workspace') {
        const body = await bodyRecord(request);
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
        if (!workspaceId) return json({ code: 'validation' }, 400);
        clearClickUpWorkspaceTaskIndex(this.ctx.storage.sql, workspaceId);
        return json({ ok: true });
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/task-index/tombstones') {
        const workspaceId = requiredSearchParam(url, 'workspaceId');
        const count = this.ctx.storage.sql.exec<{ count: number }>(
          'SELECT COUNT(*) AS count FROM clickup_task_index_tombstones WHERE workspace_id = ?',
          workspaceId,
        ).toArray()[0]?.count ?? 0;
        return json({ count });
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/webhooks') {
        return json(this.ctx.storage.sql.exec<{
          webhook_id: string;
          workspace_id: string;
          updated_at: number;
        }>(
          'SELECT webhook_id, workspace_id, updated_at FROM clickup_webhooks ORDER BY workspace_id ASC',
        ).toArray().map((row) => ({
          webhookId: row.webhook_id,
          workspaceId: row.workspace_id,
          updatedAt: row.updated_at,
        })));
      }

      if (request.method === 'GET' && url.pathname === '/__test/clickup/task-json-length') {
        const workspaceId = requiredSearchParam(url, 'workspaceId');
        const taskId = requiredSearchParam(url, 'taskId');
        const row = this.ctx.storage.sql.exec<{ task_json: string }>(
          'SELECT task_json FROM clickup_task_index WHERE workspace_id = ? AND task_id = ?',
          workspaceId,
          taskId,
        ).toArray()[0];
        return json({ length: row ? row.task_json.length : null });
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/task-index/refresh-at') {
        const body = await bodyRecord(request);
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
        const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : NaN;
        if (!workspaceId || !Number.isFinite(value)) return json({ code: 'validation' }, 400);
        this.ctx.storage.sql.exec(
          'UPDATE clickup_task_index_state SET last_refresh_at = ? WHERE workspace_id = ?',
          value,
          workspaceId,
        );
        return json({ ok: true });
      }

      if (request.method === 'POST' && url.pathname === '/__test/clickup/task-index/indexed-at') {
        const body = await bodyRecord(request);
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
        const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : NaN;
        if (!workspaceId || !Number.isFinite(value)) return json({ code: 'validation' }, 400);
        this.ctx.storage.sql.exec(
          'UPDATE clickup_task_index SET indexed_at = ? WHERE workspace_id = ?',
          value,
          workspaceId,
        );
        return json({ ok: true });
      }

      return json({ code: 'not_found' }, 404);
    } catch {
      return json({ code: 'test_harness' }, 500);
    }
  }
}
