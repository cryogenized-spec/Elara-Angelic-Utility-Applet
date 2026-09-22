import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  ELARA_INTERNAL_HEADER,
  constantTimeEqual,
  internalWakeMarker,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';
import {
  ClickUpProviderError,
  clearClickUpTaskCustomField,
  createClickUpTask,
  createClickUpTaskComment,
  createClickUpWebhook,
  deleteClickUpWebhook,
  CLICKUP_TASK_INDEX_WEBHOOK_EVENTS,
  exchangeClickUpAuthorizationCode,
  fetchAuthorizedClickUpUser,
  fetchAuthorizedClickUpWorkspaces,
  getClickUpFolder,
  getClickUpList,
  getClickUpListCustomFields,
  getClickUpTask,
  getClickUpTaskComments,
  listClickUpFolderLists,
  listClickUpFolderlessLists,
  listClickUpFolders,
  listClickUpSpaces,
  listClickUpWorkspaceTasks,
  replyToClickUpComment,
  setClickUpTaskCustomField,
  updateClickUpTask,
  uploadClickUpTaskAttachment,
  type ClickUpOAuthServerEnv,
  type ClickUpProviderResult,
  type ClickUpRateLimitSnapshot,
} from './provider';
import { validateClickUpToolArguments } from '../../../src/clickup/tool-schema';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../../src/clickup/mcp-protocol';
import { ARTIFACT_LIMITS } from '../../../src/artifacts/limits';
import {
  abortClickUpFullReconcileStage,
  beginClickUpFullReconcileStage,
  clearClickUpTaskIndex,
  clearClickUpTaskTombstone,
  clearClickUpWorkspaceTaskIndex,
  commitClickUpFullReconcileStage,
  fullReconcileStageState,
  initializeClickUpTaskIndex,
  markAllClickUpTaskIndexesStale,
  markClickUpWorkspaceTaskIndexStale,
  removeClickUpTaskFromAllIndexes,
  searchClickUpTaskIndex,
  setTaskIndexState,
  taskIndexInvalidationGeneration,
  taskIndexState,
  tombstoneClickUpTask,
  upsertClickUpFullReconcilePage,
  upsertClickUpTaskIndexPage,
} from './task-index';
import { CLICKUP_WEBHOOK_ENDPOINT_HEADER } from './oauth-routes';

interface ClickUpOAuthVaultEnv extends ClickUpOAuthServerEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH_VAULT_KEY?: string;
}

type RateLimitRow = {
  limit_count: number | null;
  remaining: number | null;
  reset_at: number | null;
  unknown_probe_in_flight: number;
  updated_at: number;
};

type WebhookRow = {
  webhook_id: string;
  workspace_id: string;
  secret_cipher: string;
  secret_iv: string;
  endpoint: string;
  updated_at: number;
};

type CredentialRow = {
  access_cipher: string;
  access_iv: string;
  user_id: string;
  username: string | null;
  email: string | null;
  workspaces_json: string;
  updated_at: number;
};

const startSchema = z.object({
  redirectUri: z.string().url().max(2048),
}).strict();

const exchangeSchema = z.object({
  code: z.string().trim().min(1).max(4096),
  state: z.string().trim().min(16).max(512),
  redirectUri: z.string().url().max(2048),
}).strict();

const emptySchema = z.object({}).strict();
const MAX_WEBHOOK_HISTORY_ITEMS = 100;

const webhookPayloadSchema = z.object({
  webhook_id: z.string().trim().min(1).max(500),
  event: z.string().trim().min(1).max(200),
  task_id: z.union([z.string(), z.number()]).optional(),
  history_items: z.array(z.object({
    id: z.union([z.string(), z.number()]),
  }).passthrough()).max(MAX_WEBHOOK_HISTORY_ITEMS).optional(),
}).passthrough();

const providerCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('getWorkspaceAuthorizationContext'), workspaceId: z.string().trim().min(1).max(100) }).strict(),
  z.object({ operation: z.literal('listSpaces'), workspaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolders'), workspaceId: z.string().trim().min(1).max(100), spaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('getFolder'), workspaceId: z.string().trim().min(1).max(100), folderId: z.string().trim().min(1).max(100), includeSubfolders: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolderLists'), workspaceId: z.string().trim().min(1).max(100), folderId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolderlessLists'), workspaceId: z.string().trim().min(1).max(100), spaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('getList'), workspaceId: z.string().trim().min(1).max(100), listId: z.string().trim().min(1).max(100) }).strict(),
  z.object({
    operation: z.literal('listWorkspaceTasks'),
    workspaceId: z.string().trim().min(1).max(100),
    page: z.number().int().min(0).max(100_000).optional(),
    includeClosed: z.boolean().optional(),
    includeSubtasks: z.boolean().optional(),
    spaceIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    folderIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    listIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    assigneeIds: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    statuses: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    dateUpdatedGt: z.number().int().min(0).optional(),
  }).strict(),
  z.object({ operation: z.literal('searchTaskIndex'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('getTask'), arguments: z.unknown() }).strict(),
  z.object({
    operation: z.literal('getTaskComments'),
    workspaceId: z.string().trim().min(1).max(100),
    taskId: z.string().trim().min(1).max(500),
    start: z.number().int().min(0).optional(),
    startId: z.string().trim().min(1).max(100).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.start === undefined) !== (value.startId === undefined)) {
      context.addIssue({ code: 'custom', message: 'Comment pagination requires start and startId together.' });
    }
  }),
  z.object({ operation: z.literal('getListCustomFields'), workspaceId: z.string().trim().min(1).max(100), listId: z.string().trim().min(1).max(100) }).strict(),
  z.object({ operation: z.literal('createTask'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('updateTask'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('createTaskComment'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('replyToComment'), arguments: z.unknown() }).strict(),
  z.object({
    operation: z.literal('setCustomField'),
    workspaceId: z.string().trim().min(1).max(100),
    taskId: z.string().trim().min(1).max(500),
    fieldId: z.string().trim().min(1).max(500),
    value: z.unknown(),
  }).strict(),
  z.object({
    operation: z.literal('clearCustomField'),
    workspaceId: z.string().trim().min(1).max(100),
    taskId: z.string().trim().min(1).max(500),
    fieldId: z.string().trim().min(1).max(500),
  }).strict(),
]);
const MAX_BODY_CHARS = 16_384;
const STATE_TTL_MS = 10 * 60_000;
const NONCE_RETENTION_MS = 10 * 60_000;
const VAULT_KEY_CONTEXT = 'elara-clickup-oauth-vault-v1';
const TASK_INDEX_STALE_MS = 60_000;
const TASK_INDEX_FULL_RECONCILE_MS = 6 * 60 * 60_000;
const TASK_INDEX_COLD_PAGES_PER_SEARCH = 5;
const TASK_INDEX_INCREMENTAL_PAGES = 3;
const TASK_INDEX_PROVIDER_PAGE_SIZE = 100;
const TASK_INDEX_REFRESH_OVERLAP_MS = 5_000;
const WEBHOOK_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;
/**
 * ClickUp documents request budgets per minute. A reset timestamp that moves by
 * only a few seconds is treated as same-window jitter and may never replenish
 * local remaining. A genuine new provider minute advances by ~60 seconds.
 */
const RATE_WINDOW_SECONDS = 60;
const RATE_WINDOW_ROLLOVER_MIN_SECONDS = 45;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function vaultKey(secret: string): Promise<CryptoKey> {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error('CLICKUP_OAUTH_VAULT_KEY must be at least 32 characters.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VAULT_KEY_CONTEXT}\n${normalized}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(secret: string, token: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await vaultKey(secret),
    new TextEncoder().encode(token),
  );
  return { cipher: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptToken(secret: string, cipher: string, iv: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    await vaultKey(secret),
    base64UrlToBytes(cipher),
  );
  return new TextDecoder().decode(plaintext);
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body || '{}') as unknown; } catch { return null; }
}

function normalizeOrigin(value: string | null): string {
  try { return value ? new URL(value).origin : ''; } catch { return ''; }
}

function validRedirectUri(value: string, requestOrigin: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.origin === requestOrigin;
  } catch {
    return false;
  }
}

function randomState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function mergeRateLimits(...snapshots: readonly ClickUpRateLimitSnapshot[]): ClickUpRateLimitSnapshot {
  const limits = snapshots.flatMap((snapshot) => snapshot.limit === null ? [] : [snapshot.limit]);
  const remaining = snapshots.flatMap((snapshot) => snapshot.remaining === null ? [] : [snapshot.remaining]);
  const resets = snapshots.flatMap((snapshot) => snapshot.resetAt === null ? [] : [snapshot.resetAt]);
  return {
    limit: limits.length ? Math.min(...limits) : null,
    remaining: remaining.length ? Math.min(...remaining) : null,
    resetAt: resets.length ? Math.max(...resets) : null,
  };
}

function minNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function safeProviderId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validWebhookEndpoint(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/clickup/webhook') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export class ClickUpOAuthVault extends DurableObject {
  private readonly oauthEnv: ClickUpOAuthVaultEnv;

  constructor(ctx: DurableObjectState, env: ClickUpOAuthVaultEnv) {
    super(ctx, env as unknown as Record<string, unknown>);
    this.oauthEnv = env;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_oauth_credential (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        access_cipher TEXT NOT NULL,
        access_iv TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        email TEXT,
        workspaces_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_oauth_states (
        state TEXT PRIMARY KEY,
        redirect_uri TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_oauth_nonces (
        nonce TEXT PRIMARY KEY,
        used_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_rate_limit (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        limit_count INTEGER,
        remaining INTEGER,
        reset_at INTEGER,
        unknown_probe_in_flight INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
    const rateLimitColumns = this.ctx.storage.sql.exec<{ name: string }>(
      'PRAGMA table_info(clickup_rate_limit)',
    ).toArray();
    if (!rateLimitColumns.some((column) => column.name === 'unknown_probe_in_flight')) {
      this.ctx.storage.sql.exec(
        'ALTER TABLE clickup_rate_limit ADD COLUMN unknown_probe_in_flight INTEGER NOT NULL DEFAULT 0',
      );
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_webhooks (
        webhook_id TEXT PRIMARY KEY,
        workspace_id TEXT UNIQUE NOT NULL,
        secret_cipher TEXT NOT NULL,
        secret_iv TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_webhook_deliveries (
        dedupe_key TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clickup_connection_epoch (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        epoch INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO clickup_connection_epoch (slot, epoch) VALUES (1, 0)');
    initializeClickUpTaskIndex(this.ctx.storage.sql);
  }

  protected credentialRow(): CredentialRow | null {
    return this.ctx.storage.sql.exec<CredentialRow>(
      'SELECT access_cipher, access_iv, user_id, username, email, workspaces_json, updated_at FROM clickup_oauth_credential WHERE slot = 1',
    ).toArray()[0] ?? null;
  }

  private connectionEpoch(): number {
    return this.ctx.storage.sql.exec<{ epoch: number }>(
      'SELECT epoch FROM clickup_connection_epoch WHERE slot = 1',
    ).toArray()[0]?.epoch ?? 0;
  }

  private advanceConnectionEpoch(): number {
    return this.ctx.storage.transactionSync(() => {
      const next = this.connectionEpoch() + 1;
      this.ctx.storage.sql.exec('UPDATE clickup_connection_epoch SET epoch = ? WHERE slot = 1', next);
      return next;
    });
  }

  private deleteCredentialIfRevision(revision: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      const current = this.credentialRow();
      if (!current || current.updated_at !== revision) return false;
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_credential WHERE slot = 1');
      this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
      return true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/internal/clickup/command') {
        if (!(await this.verifyInternal(request))) return json({ code: 'auth', message: 'Binding-internal ClickUp authority is required.' }, 401);
        const expectedRevision = this.expectedGrantRevision(request);
        if (expectedRevision === null) return json({ code: 'grant_required', message: 'Binding-internal ClickUp execution requires the admitted grant revision.' }, 409);
        const body = await request.text();
        if (body.length > 64_000) return json({ code: 'validation', message: 'ClickUp internal command is too large.' }, 413);
        return await this.executeProviderCommand(body, expectedRevision);
      }

      if (request.method === 'POST' && url.pathname === '/internal/clickup/attachment') {
        if (!(await this.verifyInternal(request))) return json({ code: 'auth', message: 'Binding-internal ClickUp authority is required.' }, 401);
        const expectedRevision = this.expectedGrantRevision(request);
        if (expectedRevision === null) return json({ code: 'grant_required', message: 'Binding-internal ClickUp attachment requires the admitted grant revision.' }, 409);
        return await this.executeAttachmentUpload(request, expectedRevision);
      }

      if (request.method === 'POST' && url.pathname === '/internal/clickup/webhook') {
        if (!(await this.verifyInternal(request))) return json({ code: 'auth', message: 'Binding-internal ClickUp authority is required.' }, 401);
        const body = await request.text();
        return await this.executeWebhook(body, request.headers.get('X-Signature'));
      }

      if (request.method === 'GET' && url.pathname === '/clickup/oauth/status') {
        if (!(await this.verifyRead(request))) return json({ code: 'auth', message: 'A valid installation credential is required.' }, 401);
        return json(this.status());
      }

      if (request.method !== 'POST') return json({ code: 'not_found', message: 'Not found.' }, 404);
      const body = await request.text();
      if (body.length > MAX_BODY_CHARS) return json({ code: 'validation', message: 'ClickUp OAuth request body is too large.' }, 413);
      const writeAuth = await this.verifyWrite(request, body);
      if (!writeAuth.ok) {
        const status = writeAuth.code === 'stale-timestamp' || writeAuth.code === 'replayed-nonce' ? 409 : 401;
        return json({ code: writeAuth.code, message: `ClickUp OAuth write rejected: ${writeAuth.code}.` }, status);
      }

      if (url.pathname === '/clickup/oauth/start') return await this.start(request, body);
      if (url.pathname === '/clickup/oauth/exchange') return await this.exchange(request, body);
      if (url.pathname === '/clickup/oauth/disconnect') return await this.disconnect(body);
      return json({ code: 'not_found', message: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof ClickUpProviderError) {
        return json({ code: error.code, message: error.message }, error.status);
      }
      if (error instanceof z.ZodError) {
        return json({ code: 'validation', message: 'ClickUp request arguments were invalid.' }, 400);
      }
      return json({ code: 'oauth', message: 'ClickUp OAuth vault could not complete the request.' }, 502);
    }
  }

  private installationToken(): string {
    const token = this.oauthEnv.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
    if (!token) throw new Error('ELARA_INSTALLATION_TOKEN is not configured.');
    return token;
  }

  private vaultSecret(): string {
    const secret = this.oauthEnv.CLICKUP_OAUTH_VAULT_KEY?.trim() ?? '';
    if (!secret) throw new Error('CLICKUP_OAUTH_VAULT_KEY is not configured.');
    return secret;
  }

  private clientId(): string {
    const value = this.oauthEnv.CLICKUP_OAUTH_CLIENT_ID?.trim() ?? '';
    if (!value) throw new Error('CLICKUP_OAUTH_CLIENT_ID is not configured.');
    return value;
  }

  private async verifyInternal(request: Request): Promise<boolean> {
    const presented = request.headers.get(ELARA_INTERNAL_HEADER) ?? '';
    const expected = await internalWakeMarker(this.installationToken());
    return Boolean(presented) && constantTimeEqual(presented, expected);
  }

  private expectedGrantRevision(request: Request): number | null {
    const raw = request.headers.get(CLICKUP_GRANT_REVISION_HEADER)?.trim() ?? '';
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private rateLimitRow(): RateLimitRow | null {
    return this.ctx.storage.sql.exec<RateLimitRow>(
      'SELECT limit_count, remaining, reset_at, unknown_probe_in_flight, updated_at FROM clickup_rate_limit WHERE slot = 1',
    ).toArray()[0] ?? null;
  }

  private reserveProviderCall(): { blocked: boolean; retryAt?: number } {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    return this.ctx.storage.transactionSync(() => {
      const row = this.rateLimitRow();
      if (!row) {
        // Unknown provider budget is not unlimited budget. Permit exactly one
        // probe at a time. When it finishes without usable Remaining headers,
        // recordRateLimit() releases this probe so the next sequential request
        // may try again without creating a minute-long deadlock.
        this.ctx.storage.sql.exec(
          'INSERT INTO clickup_rate_limit (slot, limit_count, remaining, reset_at, unknown_probe_in_flight, updated_at) VALUES (1, NULL, NULL, NULL, 1, ?)',
          now,
        );
        return { blocked: false };
      }

      if (row.remaining === null) {
        if (row.unknown_probe_in_flight === 1) return { blocked: true };
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET unknown_probe_in_flight = 1, updated_at = ? WHERE slot = 1',
          now,
        );
        return { blocked: false };
      }

      if (row.reset_at !== null && row.reset_at <= nowSeconds) {
        // Open the next minute window in place instead of deleting the row.
        // Durable Object requests can interleave while provider I/O is awaited;
        // keeping a provisional budget ensures every post-reset request still
        // reserves capacity before leaving for ClickUp.
        const elapsed = Math.max(0, nowSeconds - row.reset_at);
        const windowsElapsed = Math.floor(elapsed / RATE_WINDOW_SECONDS) + 1;
        const provisionalReset = row.reset_at + (windowsElapsed * RATE_WINDOW_SECONDS);
        const remainingAfterReservation = row.limit_count !== null
          ? Math.max(0, row.limit_count - 1)
          : 0;
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET remaining = ?, reset_at = ?, unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
          remainingAfterReservation,
          provisionalReset,
          now,
        );
        return { blocked: false };
      }

      if (row.remaining <= 0) {
        return { blocked: true, ...(row.reset_at !== null ? { retryAt: row.reset_at * 1000 } : {}) };
      }

      this.ctx.storage.sql.exec(
        'UPDATE clickup_rate_limit SET remaining = ?, updated_at = ? WHERE slot = 1',
        Math.max(0, row.remaining - 1),
        now,
      );
      return { blocked: false };
    });
  }

  private recordRateLimit(rateLimit: ClickUpRateLimitSnapshot): void {
    const hasSnapshot = rateLimit.limit !== null || rateLimit.remaining !== null || rateLimit.resetAt !== null;
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);

    this.ctx.storage.transactionSync(() => {
      const current = this.rateLimitRow();
      if (!current) {
        if (!hasSnapshot) return;
        if (rateLimit.resetAt !== null && rateLimit.resetAt <= nowSeconds) return;
        this.ctx.storage.sql.exec(
          'INSERT INTO clickup_rate_limit (slot, limit_count, remaining, reset_at, unknown_probe_in_flight, updated_at) VALUES (1, ?, ?, ?, 0, ?)',
          rateLimit.limit,
          rateLimit.remaining,
          rateLimit.resetAt,
          now,
        );
        return;
      }

      // A completed unknown-budget probe must always release its single-flight
      // gate, even when ClickUp (or an intermediary) returns no rate headers.
      // If Remaining is still unknown, subsequent requests remain serialized:
      // one probe may run, followers fail locally until that probe completes.
      if (!hasSnapshot) {
        if (current.unknown_probe_in_flight === 1) {
          this.ctx.storage.sql.exec(
            'UPDATE clickup_rate_limit SET unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
            now,
          );
        }
        return;
      }

      const currentReset = current.reset_at;
      const incomingReset = rateLimit.resetAt;

      if (current.remaining === null) {
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET limit_count = ?, remaining = ?, reset_at = ?, unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
          rateLimit.limit ?? current.limit_count,
          rateLimit.remaining,
          incomingReset ?? currentReset,
          now,
        );
        return;
      }

      if (currentReset !== null && currentReset <= nowSeconds) {
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
          now,
        );
        return;
      }

      // A response from an older provider window may arrive after a newer
      // response has already established the current budget. Never let that
      // stale snapshot consume quota from the newer window.
      if (currentReset !== null && incomingReset !== null && incomingReset < currentReset) {
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
          now,
        );
        return;
      }

      const providerWindowAdvanced = currentReset !== null
        && incomingReset !== null
        && incomingReset > nowSeconds
        && incomingReset - currentReset >= RATE_WINDOW_ROLLOVER_MIN_SECONDS;

      if (providerWindowAdvanced) {
        // Advance the provider reset horizon, but never raise immediately
        // available local quota from a response. Other requests may already
        // have reserved capacity and still be in flight.
        this.ctx.storage.sql.exec(
          'UPDATE clickup_rate_limit SET limit_count = ?, remaining = ?, reset_at = ?, unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
          rateLimit.limit ?? current.limit_count,
          minNullable(current.remaining, rateLimit.remaining),
          incomingReset,
          now,
        );
        return;
      }

      // Same window (or ambiguous reset jitter): merge only downward.
      const mergedLimit = minNullable(current.limit_count, rateLimit.limit);
      const mergedRemaining = minNullable(current.remaining, rateLimit.remaining);
      const mergedReset = currentReset ?? (
        incomingReset !== null && incomingReset > nowSeconds
          ? incomingReset
          : null
      );

      this.ctx.storage.sql.exec(
        'UPDATE clickup_rate_limit SET limit_count = ?, remaining = ?, reset_at = ?, unknown_probe_in_flight = 0, updated_at = ? WHERE slot = 1',
        mergedLimit,
        mergedRemaining,
        mergedReset,
        now,
      );
    });
  }

  private providerCredentialRevoked(error: ClickUpProviderError): boolean {
    return error.status === 401
      || new Set(['OAUTH_019', 'OAUTH_021', 'OAUTH_025', 'OAUTH_077']).has(error.providerCode ?? '');
  }

  private async providerData<T>(
    run: (accessToken: string) => Promise<ClickUpProviderResult<T>>,
    expectedRevision?: number,
  ): Promise<
    | { ok: true; data: T; grantRevision: number }
    | { ok: false; response: Response; grantRevision: number }
  > {
    const grant = await this.accessGrant();
    if (!grant) {
      return { ok: false, response: json({ code: 'authorization_required', message: 'Connect ClickUp before using ClickUp tools.' }, 401), grantRevision: 0 };
    }
    if (expectedRevision !== undefined && grant.revision !== expectedRevision) {
      return {
        ok: false,
        response: json({ code: 'grant_changed', message: 'ClickUp authorization changed after this operation was admitted.' }, 409),
        grantRevision: grant.revision,
      };
    }

    // accessGrant() awaits token decryption. A disconnect/reconnect can run
    // while that await is pending, so the captured row must be revalidated
    // synchronously immediately before reservation/provider egress.
    if (this.credentialRow()?.updated_at !== grant.revision) {
      return {
        ok: false,
        response: json({ code: 'grant_changed', message: 'ClickUp authorization changed before this provider request could start.' }, 409),
        grantRevision: grant.revision,
      };
    }

    const reservation = this.reserveProviderCall();
    if (reservation.blocked) {
      return {
        ok: false,
        response: json({
          code: 'rate_limited',
          message: 'ClickUp request budget is exhausted for the current provider window.',
          ...(reservation.retryAt ? { retryAt: reservation.retryAt } : {}),
        }, 429),
        grantRevision: grant.revision,
      };
    }
    try {
      const result = await run(grant.token);
      if (this.credentialRow()?.updated_at !== grant.revision) {
        return {
          ok: false,
          response: json({ code: 'grant_changed', message: 'ClickUp authorization changed while this provider request was in flight.' }, 409),
          grantRevision: grant.revision,
        };
      }
      this.recordRateLimit(result.rateLimit);
      return { ok: true, data: result.data, grantRevision: grant.revision };
    } catch (error) {
      if (!(error instanceof ClickUpProviderError)) throw error;
      if (this.credentialRow()?.updated_at !== grant.revision) {
        return {
          ok: false,
          response: json({ code: 'grant_changed', message: 'ClickUp authorization changed while this provider request was in flight.' }, 409),
          grantRevision: grant.revision,
        };
      }
      this.recordRateLimit(error.rateLimit);
      if (this.providerCredentialRevoked(error) && this.deleteCredentialIfRevision(grant.revision)) {
        await this.clearStoredWebhooks(null);
        clearClickUpTaskIndex(this.ctx.storage.sql);
      }
      return {
        ok: false,
        response: json({
          code: error.code,
          message: error.message,
          ...(error.rateLimit.resetAt ? { retryAt: error.rateLimit.resetAt * 1000 } : {}),
        }, error.status),
        grantRevision: grant.revision,
      };
    }
  }

  private async runProvider<T>(
    run: (accessToken: string) => Promise<ClickUpProviderResult<T>>,
    expectedRevision?: number,
  ): Promise<Response> {
    const result = await this.providerData(run, expectedRevision);
    return result.ok ? json({ ok: true, result: result.data }) : result.response;
  }

  private scopeDenied(message = 'The requested ClickUp resource is outside the admitted Workspace.'): Response {
    return json({ code: 'resource_workspace_mismatch', message }, 403);
  }

  private async normalizeTaskScopeFailure(
    response: Response,
    workspaceId: string,
    expectedRevision: number,
  ): Promise<Response> {
    if (response.status !== 403 && response.status !== 404) return response;
    return this.padDeniedTaskScope(workspaceId, expectedRevision);
  }

  private async padDeniedTaskScope(
    workspaceId: string,
    expectedRevision: number,
  ): Promise<Response> {
    // Equalize denied direct task IDs. Otherwise a provider-visible task that
    // needs Space ancestry verification spends more calls than a missing task,
    // exposing an existence oracle via latency/rate-budget shape.
    const padded = await this.verifySpaceScope(
      workspaceId,
      '__elara_denied_task_scope_probe__',
      expectedRevision,
    );
    if (!padded.ok && padded.response.status !== 403) return padded.response;
    return this.scopeDenied();
  }

  private async padDeniedHierarchicalScope(
    workspaceId: string,
    expectedRevision: number,
  ): Promise<Response> {
    // Direct Folder/List lookups must have the same observable provider cost
    // whether the id is missing, forbidden, or exists but lacks usable ancestry.
    const padded = await this.verifySpaceScope(
      workspaceId,
      '__elara_denied_hierarchy_scope_probe__',
      expectedRevision,
    );
    if (!padded.ok && padded.response.status !== 403) return padded.response;
    return this.scopeDenied();
  }

  private async normalizeHierarchicalScopeFailure(
    response: Response,
    workspaceId: string,
    expectedRevision: number,
  ): Promise<Response> {
    if (response.status !== 403 && response.status !== 404) return response;
    return this.padDeniedHierarchicalScope(workspaceId, expectedRevision);
  }

  private workspaceMemberIds(workspaceId: string): Set<string> | null {
    const context = this.authorizationContext();
    const workspace = context?.workspaces.find((entry) => String(entry.id ?? '') === workspaceId);
    if (!workspace) return null;
    const members = Array.isArray(workspace.members) ? workspace.members : null;
    if (!members) return new Set();
    const ids = new Set<string>();
    for (const member of members) {
      const record = member && typeof member === 'object' && !Array.isArray(member)
        ? member as Record<string, unknown>
        : undefined;
      const directId = safeProviderId(record?.id);
      const nestedUser = record?.user && typeof record.user === 'object' && !Array.isArray(record.user)
        ? record.user as Record<string, unknown>
        : undefined;
      const nestedId = safeProviderId(nestedUser?.id);
      if (directId) ids.add(directId);
      if (nestedId) ids.add(nestedId);
    }
    return ids;
  }

  private validateWorkspaceUsers(workspaceId: string, userIds: readonly string[] | undefined): Response | null {
    const requested = [...new Set((userIds ?? []).filter(Boolean))];
    if (!requested.length) return null;
    const members = this.workspaceMemberIds(workspaceId);
    if (!members) {
      return json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403);
    }
    if (requested.some((userId) => !members.has(userId))) {
      return this.scopeDenied('One or more requested ClickUp users are outside the admitted Workspace.');
    }
    return null;
  }

  private async validateFreshWorkspaceUsers(
    workspaceId: string,
    userIds: readonly string[] | undefined,
    expectedRevision: number,
  ): Promise<Response | null> {
    const requested = [...new Set((userIds ?? []).filter(Boolean))];
    if (!requested.length) return null;
    const refreshed = await this.refreshWorkspaceAuthorization(workspaceId, expectedRevision);
    if (!refreshed.ok) return refreshed.response;
    return this.validateWorkspaceUsers(workspaceId, requested);
  }

  private customFieldDeltaIds(
    value: unknown,
    maxReferences: number,
  ): { ok: true; ids: string[] } | { ok: false; response: Response } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        response: json({ code: 'custom_field_value_invalid', message: 'This ClickUp Custom Field requires add/rem reference arrays.' }, 400),
      };
    }
    const record = value as Record<string, unknown>;
    const addValue = record.add;
    const remValue = record.rem;
    if (
      (addValue !== undefined && !Array.isArray(addValue))
      || (remValue !== undefined && !Array.isArray(remValue))
    ) {
      return {
        ok: false,
        response: json({ code: 'custom_field_value_invalid', message: 'This ClickUp Custom Field requires add/rem reference arrays.' }, 400),
      };
    }
    const add: unknown[] = Array.isArray(addValue) ? addValue as unknown[] : [];
    const rem: unknown[] = Array.isArray(remValue) ? remValue as unknown[] : [];
    if (!add.length && !rem.length) {
      return {
        ok: false,
        response: json({ code: 'custom_field_value_invalid', message: 'This ClickUp Custom Field requires at least one add/rem reference.' }, 400),
      };
    }
    const raw: unknown[] = [...add, ...rem];
    if (raw.length > maxReferences) {
      return {
        ok: false,
        response: json({ code: 'custom_field_value_too_large', message: 'This ClickUp Custom Field contains too many referenced resources for one operation.' }, 400),
      };
    }
    const ids = raw.map((entry) => safeProviderId(entry));
    if (ids.some((entry) => !entry)) {
      return {
        ok: false,
        response: json({ code: 'custom_field_value_invalid', message: 'This ClickUp Custom Field contains an invalid provider reference.' }, 400),
      };
    }
    return { ok: true, ids: [...new Set(ids as string[])] };
  }

  private async verifySpaceScope(
    workspaceId: string,
    spaceId: string,
    expectedRevision: number,
  ): Promise<{ ok: true } | { ok: false; response: Response }> {
    if (!this.workspaceAuthorized(workspaceId)) {
      return { ok: false, response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403) };
    }

    for (const archived of [false, true] as const) {
      const result = await this.providerData(
        (token) => listClickUpSpaces(token, workspaceId, archived),
        expectedRevision,
      );
      if (!result.ok) {
        if (result.response.status === 403) this.revokeWorkspaceIfRevision(workspaceId, result.grantRevision);
        return { ok: false, response: result.response };
      }
      const root = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      const spaces = Array.isArray(root.spaces) ? root.spaces : [];
      if (spaces.some((entry) => safeProviderId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).id
          : undefined,
      ) === spaceId)) {
        return { ok: true };
      }
    }
    return { ok: false, response: this.scopeDenied() };
  }

  private async verifyTaskScope(
    workspaceId: string,
    taskId: string,
    includeSubtasks: boolean,
    expectedRevision: number,
  ): Promise<{ ok: true; task: Record<string, unknown> } | { ok: false; response: Response }> {
    if (!this.workspaceAuthorized(workspaceId)) {
      return { ok: false, response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403) };
    }
    const result = await this.providerData(
      (token) => getClickUpTask(token, taskId, includeSubtasks),
      expectedRevision,
    );
    if (!result.ok) {
      return {
        ok: false,
        response: await this.normalizeTaskScopeFailure(result.response, workspaceId, expectedRevision),
      };
    }
    const task = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    const teamId = safeProviderId(task.team_id ?? task.teamId);
    if (teamId) {
      return teamId === workspaceId
        ? { ok: true, task }
        : { ok: false, response: await this.padDeniedTaskScope(workspaceId, expectedRevision) };
    }
    const space = task.space && typeof task.space === 'object' && !Array.isArray(task.space)
      ? task.space as Record<string, unknown>
      : undefined;
    const spaceId = safeProviderId(space?.id);
    if (!spaceId) {
      return { ok: false, response: await this.padDeniedTaskScope(workspaceId, expectedRevision) };
    }
    const scoped = await this.verifySpaceScope(workspaceId, spaceId, expectedRevision);
    return scoped.ok ? { ok: true, task } : scoped;
  }

  private async verifyFolderScope(
    workspaceId: string,
    folderId: string,
    includeSubfolders: boolean,
    expectedRevision: number,
  ): Promise<{ ok: true; folder: Record<string, unknown> } | { ok: false; response: Response }> {
    if (!this.workspaceAuthorized(workspaceId)) {
      return { ok: false, response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403) };
    }
    const result = await this.providerData(
      (token) => getClickUpFolder(token, folderId, includeSubfolders),
      expectedRevision,
    );
    if (!result.ok) {
      return {
        ok: false,
        response: await this.normalizeHierarchicalScopeFailure(result.response, workspaceId, expectedRevision),
      };
    }
    const folder = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    const space = folder.space && typeof folder.space === 'object' && !Array.isArray(folder.space)
      ? folder.space as Record<string, unknown>
      : undefined;
    const spaceId = safeProviderId(space?.id);
    if (!spaceId) {
      return { ok: false, response: await this.padDeniedHierarchicalScope(workspaceId, expectedRevision) };
    }
    const scoped = await this.verifySpaceScope(workspaceId, spaceId, expectedRevision);
    return scoped.ok ? { ok: true, folder } : scoped;
  }

  private async verifyListScope(
    workspaceId: string,
    listId: string,
    expectedRevision: number,
  ): Promise<{ ok: true; list: Record<string, unknown> } | { ok: false; response: Response }> {
    if (!this.workspaceAuthorized(workspaceId)) {
      return { ok: false, response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403) };
    }
    const result = await this.providerData((token) => getClickUpList(token, listId), expectedRevision);
    if (!result.ok) {
      return {
        ok: false,
        response: await this.normalizeHierarchicalScopeFailure(result.response, workspaceId, expectedRevision),
      };
    }
    const list = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    const space = list.space && typeof list.space === 'object' && !Array.isArray(list.space)
      ? list.space as Record<string, unknown>
      : undefined;
    const spaceId = safeProviderId(space?.id);
    if (!spaceId) {
      return { ok: false, response: await this.padDeniedHierarchicalScope(workspaceId, expectedRevision) };
    }
    const scoped = await this.verifySpaceScope(workspaceId, spaceId, expectedRevision);
    return scoped.ok ? { ok: true, list } : scoped;
  }

  private async verifyCommentBelongsToTask(
    workspaceId: string,
    taskId: string,
    commentId: string,
    expectedRevision: number,
  ): Promise<{ ok: true } | { ok: false; response: Response }> {
    const taskScope = await this.verifyTaskScope(workspaceId, taskId, false, expectedRevision);
    if (!taskScope.ok) return taskScope;

    let cursor: { start: number; startId: string } | undefined;
    for (let page = 0; page < 8; page += 1) {
      const result = await this.providerData(
        (token) => getClickUpTaskComments(token, taskId, cursor),
        expectedRevision,
      );
      if (!result.ok) return { ok: false, response: result.response };
      const root = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      const comments: unknown[] = Array.isArray(root.comments) ? root.comments as unknown[] : [];
      if (comments.some((entry) => safeProviderId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).id
          : undefined,
      ) === commentId)) return { ok: true };
      if (comments.length < 25) break;
      const last = comments.at(-1);
      const lastRecord = last && typeof last === 'object' && !Array.isArray(last) ? last as Record<string, unknown> : undefined;
      const startId = safeProviderId(lastRecord?.id);
      const startRaw = lastRecord?.date;
      const start = typeof startRaw === 'number' && Number.isSafeInteger(startRaw)
        ? startRaw
        : typeof startRaw === 'string' && /^\d+$/.test(startRaw)
          ? Number(startRaw)
          : NaN;
      if (!startId || !Number.isSafeInteger(start)) break;
      cursor = { start, startId };
    }
    return { ok: false, response: this.scopeDenied('The requested ClickUp comment was not found on the admitted task.') };
  }

  private async searchTaskIndex(
    argumentsValue: unknown,
    expectedRevision?: number,
    retryOnInvalidation = true,
  ): Promise<Response> {
    const args = validateClickUpToolArguments('clickup.searchTasks', argumentsValue);
    if (!this.workspaceAuthorized(args.workspaceId)) {
      return json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403);
    }

    let state = taskIndexState(this.ctx.storage.sql, args.workspaceId);
    const now = Date.now();

    // Ensure a generation-bearing state row exists before the first provider
    // await. Otherwise a webhook racing a brand-new/cold refresh would have no
    // row to invalidate and an older page could commit afterward.
    setTaskIndexState(this.ctx.storage.sql, {
      workspaceId: state.workspaceId,
      fullSyncComplete: state.fullSyncComplete,
      nextPage: state.nextPage,
      lastRefreshAt: state.lastRefreshAt,
      lastProviderUpdatedAt: state.lastProviderUpdatedAt,
      oldestIndexedAt: state.oldestIndexedAt,
      incrementalSince: state.incrementalSince,
      incrementalNextPage: state.incrementalNextPage,
      incrementalMaxUpdatedAt: state.incrementalMaxUpdatedAt,
      invalidationGeneration: state.invalidationGeneration,
    });
    state = taskIndexState(this.ctx.storage.sql, args.workspaceId);
    const refreshGeneration = state.invalidationGeneration;

    const restartIfInvalidated = async (): Promise<Response | null> => {
      if (taskIndexInvalidationGeneration(this.ctx.storage.sql, args.workspaceId) === refreshGeneration) return null;
      if (retryOnInvalidation) {
        return this.searchTaskIndex(argumentsValue, expectedRevision, false);
      }
      return json({
        code: 'index_invalidated',
        message: 'ClickUp task index changed while it was refreshing. Retry the search.',
      }, 409);
    };

    const fullSnapshotAgeOrigin = state.indexedTasks > 0 ? state.oldestIndexedAt : state.lastRefreshAt;
    let reconcileStage = fullReconcileStageState(this.ctx.storage.sql, args.workspaceId);
    const fullReconcileDue = Boolean(reconcileStage) || (
      state.incrementalSince === 0
      && state.fullSyncComplete
      && fullSnapshotAgeOrigin > 0
      && now - fullSnapshotAgeOrigin >= TASK_INDEX_FULL_RECONCILE_MS
    );

    let refreshIncomplete = state.incrementalSince > 0;
    let refreshError: { code: string; message: string } | undefined;
    let fullReconcileHandled = false;

    const providerPage = async (page: number, dateUpdatedGt?: number) => {
      return this.providerData((token) => listClickUpWorkspaceTasks(token, args.workspaceId, {
        page,
        includeClosed: true,
        includeSubtasks: true,
        ...(dateUpdatedGt !== undefined ? { dateUpdatedGt } : {}),
      }), expectedRevision);
    };

    const handleWorkspaceDenial = (status: number, revision: number): boolean => {
      if (status !== 403) return false;
      this.revokeWorkspaceIfRevision(args.workspaceId, revision);
      return true;
    };

    const reconciliationCommittedByPeer = (startedAt: number): boolean => {
      if (fullReconcileStageState(this.ctx.storage.sql, args.workspaceId)) return false;
      const current = taskIndexState(this.ctx.storage.sql, args.workspaceId);
      return current.fullSyncComplete
        && current.invalidationGeneration === refreshGeneration
        && current.lastRefreshAt >= startedAt;
    };

    if (fullReconcileDue) {
      fullReconcileHandled = true;
      if (!reconcileStage) {
        reconcileStage = beginClickUpFullReconcileStage(
          this.ctx.storage.sql,
          args.workspaceId,
          refreshGeneration,
          now,
        );
      } else if (reconcileStage.invalidationGeneration !== refreshGeneration) {
        abortClickUpFullReconcileStage(this.ctx.storage.sql, args.workspaceId);
        reconcileStage = beginClickUpFullReconcileStage(
          this.ctx.storage.sql,
          args.workspaceId,
          refreshGeneration,
          now,
        );
      }

      let completed = false;
      let committedByPeer = false;
      for (let offset = 0; offset < TASK_INDEX_COLD_PAGES_PER_SEARCH; offset += 1) {
        const pageResult = await providerPage(reconcileStage.nextPage);
        if (!pageResult.ok) {
          if (handleWorkspaceDenial(pageResult.response.status, pageResult.grantRevision)) return pageResult.response;
          const body = await pageResult.response.json().catch(() => null) as Record<string, unknown> | null;
          refreshError = {
            code: typeof body?.code === 'string' ? body.code : `http-${pageResult.response.status}`,
            message: typeof body?.message === 'string' ? body.message : 'ClickUp full task-index reconciliation was interrupted.',
          };
          break;
        }

        const invalidated = await restartIfInvalidated();
        if (invalidated) return invalidated;

        const source = pageResult.data && typeof pageResult.data === 'object' ? pageResult.data as Record<string, unknown> : {};
        const tasks = Array.isArray(source.tasks) ? source.tasks : [];
        const nextStage = upsertClickUpFullReconcilePage(
          this.ctx.storage.sql,
          args.workspaceId,
          tasks,
          reconcileStage.nextPage + 1,
          reconcileStage.maxProviderUpdatedAt,
          refreshGeneration,
          now,
        );
        if (!nextStage) {
          const invalidatedStage = await restartIfInvalidated();
          if (invalidatedStage) return invalidatedStage;
          if (reconciliationCommittedByPeer(reconcileStage.startedAt)) {
            completed = true;
            committedByPeer = true;
            break;
          }
          return json({
            code: 'index_reconcile_lost',
            message: 'ClickUp full task-index reconciliation lost its staging authority. Retry the search.',
          }, 409);
        }
        reconcileStage = nextStage;

        if (tasks.length < TASK_INDEX_PROVIDER_PAGE_SIZE) {
          completed = true;
          break;
        }
      }

      if (completed) {
        const invalidatedBeforeCommit = await restartIfInvalidated();
        if (invalidatedBeforeCommit) return invalidatedBeforeCommit;
        if (
          !committedByPeer
          && !commitClickUpFullReconcileStage(
            this.ctx.storage,
            args.workspaceId,
            refreshGeneration,
            now,
          )
        ) {
          const invalidatedCommit = await restartIfInvalidated();
          if (invalidatedCommit) return invalidatedCommit;
          if (!reconciliationCommittedByPeer(reconcileStage.startedAt)) {
            return json({
              code: 'index_reconcile_lost',
              message: 'ClickUp full task-index reconciliation could not commit safely. Retry the search.',
            }, 409);
          }
        }
        refreshIncomplete = false;
        state = taskIndexState(this.ctx.storage.sql, args.workspaceId);
      } else {
        refreshIncomplete = true;
      }
    }

    if (
      !fullReconcileHandled
      && (
      state.incrementalSince > 0
      || state.indexedTasks === 0
      || now - state.lastRefreshAt >= TASK_INDEX_STALE_MS
      )
    ) {
      if (!state.fullSyncComplete) {
        let nextPage = state.nextPage;
        let maxUpdatedAt = state.lastProviderUpdatedAt;
        let fullSyncComplete = false;
        let fetchedAnyPage = false;

        for (let offset = 0; offset < TASK_INDEX_COLD_PAGES_PER_SEARCH; offset += 1) {
          const pageResult = await providerPage(nextPage);
          if (!pageResult.ok) {
            if (handleWorkspaceDenial(pageResult.response.status, pageResult.grantRevision)) return pageResult.response;
            if (state.indexedTasks === 0 && !fetchedAnyPage) return pageResult.response;
            const body = await pageResult.response.json().catch(() => null) as Record<string, unknown> | null;
            refreshError = {
              code: typeof body?.code === 'string' ? body.code : `http-${pageResult.response.status}`,
              message: typeof body?.message === 'string' ? body.message : 'ClickUp task-index refresh was interrupted.',
            };
            refreshIncomplete = true;
            break;
          }

          const invalidated = await restartIfInvalidated();
          if (invalidated) return invalidated;

          fetchedAnyPage = true;
          const source = pageResult.data && typeof pageResult.data === 'object' ? pageResult.data as Record<string, unknown> : {};
          const tasks = Array.isArray(source.tasks) ? source.tasks : [];
          const indexed = upsertClickUpTaskIndexPage(this.ctx.storage.sql, args.workspaceId, tasks, now);
          maxUpdatedAt = Math.max(maxUpdatedAt, indexed.maxProviderUpdatedAt);
          nextPage += 1;

          if (tasks.length < TASK_INDEX_PROVIDER_PAGE_SIZE) {
            fullSyncComplete = true;
            nextPage = 0;
            break;
          }
        }

        if (!fullSyncComplete && !refreshError) refreshIncomplete = true;
        const invalidatedBeforeCommit = await restartIfInvalidated();
        if (invalidatedBeforeCommit) return invalidatedBeforeCommit;
        setTaskIndexState(this.ctx.storage.sql, {
          workspaceId: args.workspaceId,
          fullSyncComplete,
          nextPage,
          lastRefreshAt: fullSyncComplete ? now : 0,
          lastProviderUpdatedAt: maxUpdatedAt,
          oldestIndexedAt: 0,
          incrementalSince: 0,
          incrementalNextPage: 0,
          incrementalMaxUpdatedAt: 0,
        });
      } else {
        const continuing = state.incrementalSince > 0;
        const threshold = continuing
          ? state.incrementalSince
          : Math.max(
              0,
              (state.lastProviderUpdatedAt || state.lastRefreshAt || now) - TASK_INDEX_REFRESH_OVERLAP_MS,
            );
        let nextPage = continuing ? state.incrementalNextPage : 0;
        let maxUpdatedAt = continuing ? state.incrementalMaxUpdatedAt : state.lastProviderUpdatedAt;
        let completed = false;
        let fetchedPage = false;

        for (let offset = 0; offset < TASK_INDEX_INCREMENTAL_PAGES; offset += 1) {
          const pageResult = await providerPage(nextPage, threshold);
          if (!pageResult.ok) {
            if (handleWorkspaceDenial(pageResult.response.status, pageResult.grantRevision)) return pageResult.response;
            const body = await pageResult.response.json().catch(() => null) as Record<string, unknown> | null;
            refreshError = {
              code: typeof body?.code === 'string' ? body.code : `http-${pageResult.response.status}`,
              message: typeof body?.message === 'string' ? body.message : 'ClickUp task-index refresh was interrupted.',
            };
            break;
          }

          const invalidated = await restartIfInvalidated();
          if (invalidated) return invalidated;

          fetchedPage = true;
          const source = pageResult.data && typeof pageResult.data === 'object' ? pageResult.data as Record<string, unknown> : {};
          const tasks = Array.isArray(source.tasks) ? source.tasks : [];
          const indexed = upsertClickUpTaskIndexPage(this.ctx.storage.sql, args.workspaceId, tasks, now);
          maxUpdatedAt = Math.max(maxUpdatedAt, indexed.maxProviderUpdatedAt);
          nextPage += 1;

          if (tasks.length < TASK_INDEX_PROVIDER_PAGE_SIZE) {
            completed = true;
            break;
          }
        }

        if (completed) {
          refreshIncomplete = false;
          const invalidatedBeforeCommit = await restartIfInvalidated();
          if (invalidatedBeforeCommit) return invalidatedBeforeCommit;
          setTaskIndexState(this.ctx.storage.sql, {
            workspaceId: args.workspaceId,
            fullSyncComplete: true,
            nextPage: 0,
            lastRefreshAt: now,
            lastProviderUpdatedAt: maxUpdatedAt,
            oldestIndexedAt: state.oldestIndexedAt,
            incrementalSince: 0,
            incrementalNextPage: 0,
            incrementalMaxUpdatedAt: 0,
          });
        } else {
          refreshIncomplete = true;
          const invalidatedBeforeCommit = await restartIfInvalidated();
          if (invalidatedBeforeCommit) return invalidatedBeforeCommit;
          setTaskIndexState(this.ctx.storage.sql, {
            workspaceId: args.workspaceId,
            fullSyncComplete: true,
            nextPage: 0,
            lastRefreshAt: 0,
            lastProviderUpdatedAt: state.lastProviderUpdatedAt,
            oldestIndexedAt: state.oldestIndexedAt,
            incrementalSince: threshold,
            incrementalNextPage: nextPage,
            incrementalMaxUpdatedAt: maxUpdatedAt,
          });
          if (!fetchedPage && !refreshError && state.indexedTasks === 0) {
            return json({ code: 'refresh_incomplete', message: 'ClickUp task-index refresh did not return a usable page.' }, 502);
          }
        }
      }
    }

    state = taskIndexState(this.ctx.storage.sql, args.workspaceId);
    return json({
      ok: true,
      result: {
        tasks: searchClickUpTaskIndex(this.ctx.storage.sql, args),
        index: {
          mode: 'persistent-sqlite',
          indexedTasks: state.indexedTasks,
          fullSyncComplete: state.fullSyncComplete,
          lastRefreshAt: state.lastRefreshAt,
          refreshIncomplete: state.incrementalSince > 0 || refreshIncomplete,
          ...(refreshError ? { refreshError } : {}),
        },
      },
    });
  }

  private async executeProviderCommand(body: string, expectedRevision: number): Promise<Response> {
    const parsed = providerCommandSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'validation', message: 'ClickUp internal provider command was invalid.' }, 400);
    const grant = this.credentialRow();
    if (!grant) return json({ code: 'authorization_required', message: 'Connect ClickUp before using ClickUp tools.' }, 401);
    if (grant.updated_at !== expectedRevision) {
      return json({ code: 'grant_changed', message: 'ClickUp authorization changed after this operation was admitted.' }, 409);
    }
    const command = parsed.data;
    try {
      switch (command.operation) {
      case 'getWorkspaceAuthorizationContext': {
        const refreshed = await this.refreshWorkspaceAuthorization(command.workspaceId, expectedRevision);
        return refreshed.ok ? json({ ok: true, result: refreshed.workspace }) : refreshed.response;
      }
      case 'listSpaces':
        if (!this.workspaceAuthorized(command.workspaceId)) {
          return json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403);
        }
        return this.runProvider((token) => listClickUpSpaces(token, command.workspaceId, command.archived ?? false), expectedRevision);
      case 'listFolders': {
        const scoped = await this.verifySpaceScope(command.workspaceId, command.spaceId, expectedRevision);
        if (!scoped.ok) return scoped.response;
        return this.runProvider((token) => listClickUpFolders(token, command.spaceId, command.archived ?? false), expectedRevision);
      }
      case 'getFolder': {
        const scoped = await this.verifyFolderScope(command.workspaceId, command.folderId, command.includeSubfolders ?? true, expectedRevision);
        return scoped.ok ? json({ ok: true, result: scoped.folder }) : scoped.response;
      }
      case 'listFolderLists': {
        const scoped = await this.verifyFolderScope(command.workspaceId, command.folderId, false, expectedRevision);
        if (!scoped.ok) return scoped.response;
        return this.runProvider((token) => listClickUpFolderLists(token, command.folderId, command.archived ?? false), expectedRevision);
      }
      case 'listFolderlessLists': {
        const scoped = await this.verifySpaceScope(command.workspaceId, command.spaceId, expectedRevision);
        if (!scoped.ok) return scoped.response;
        return this.runProvider((token) => listClickUpFolderlessLists(token, command.spaceId, command.archived ?? false), expectedRevision);
      }
      case 'getList': {
        const scoped = await this.verifyListScope(command.workspaceId, command.listId, expectedRevision);
        return scoped.ok ? json({ ok: true, result: scoped.list }) : scoped.response;
      }
      case 'listWorkspaceTasks':
        if (!this.workspaceAuthorized(command.workspaceId)) {
          return json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403);
        }
        return this.runProvider((token) => listClickUpWorkspaceTasks(token, command.workspaceId, {
          page: command.page,
          includeClosed: command.includeClosed,
          includeSubtasks: command.includeSubtasks,
          spaceIds: command.spaceIds,
          folderIds: command.folderIds,
          listIds: command.listIds,
          assigneeIds: command.assigneeIds,
          statuses: command.statuses,
          dateUpdatedGt: command.dateUpdatedGt,
        }), expectedRevision);
      case 'searchTaskIndex':
        return await this.searchTaskIndex(command.arguments, expectedRevision);
      case 'getTask': {
        const args = validateClickUpToolArguments('clickup.getTask', command.arguments);
        const scoped = await this.verifyTaskScope(args.workspaceId, args.taskId, args.includeSubtasks ?? false, expectedRevision);
        return scoped.ok ? json({ ok: true, result: scoped.task }) : scoped.response;
      }
      case 'getTaskComments': {
        const scoped = await this.verifyTaskScope(command.workspaceId, command.taskId, false, expectedRevision);
        if (!scoped.ok) return scoped.response;
        return this.runProvider((token) => getClickUpTaskComments(
          token,
          command.taskId,
          command.start !== undefined && command.startId ? { start: command.start, startId: command.startId } : undefined,
        ), expectedRevision);
      }
      case 'getListCustomFields': {
        const scoped = await this.verifyListScope(command.workspaceId, command.listId, expectedRevision);
        if (!scoped.ok) return scoped.response;
        return this.runProvider((token) => getClickUpListCustomFields(token, command.listId), expectedRevision);
      }
      case 'createTask': {
        const args = validateClickUpToolArguments('clickup.createTask', command.arguments);
        const listScope = await this.verifyListScope(args.workspaceId, args.listId, expectedRevision);
        if (!listScope.ok) return listScope.response;
        if (args.parentTaskId) {
          const parentScope = await this.verifyTaskScope(args.workspaceId, args.parentTaskId, false, expectedRevision);
          if (!parentScope.ok) return parentScope.response;
          const parentList = parentScope.task.list && typeof parentScope.task.list === 'object' && !Array.isArray(parentScope.task.list)
            ? parentScope.task.list as Record<string, unknown>
            : undefined;
          const parentListId = safeProviderId(parentList?.id);
          if (!parentListId) {
            return json({
              code: 'resource_scope_unverifiable',
              message: 'ClickUp did not return the parent task List needed to validate subtask creation.',
            }, 502);
          }
          if (parentListId !== args.listId) {
            return json({
              code: 'parent_list_mismatch',
              message: 'ClickUp requires a new subtask parent to belong to the target List.',
            }, 400);
          }
        }
        const invalidAssignees = await this.validateFreshWorkspaceUsers(args.workspaceId, args.assigneeIds, expectedRevision);
        if (invalidAssignees) return invalidAssignees;

        // Invalidate before provider egress. If ClickUp commits the write and
        // the Durable Object is interrupted before the response is processed,
        // recovery must not keep treating a pre-write snapshot as current.
        // A provider-side rejection merely causes a harmless extra refresh.
        markAllClickUpTaskIndexesStale(this.ctx.storage.sql);
        const result = await this.providerData((token) => createClickUpTask(token, args), expectedRevision);
        if (!result.ok) return result.response;
        const created = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
        const createdTaskId = safeProviderId(created.id);
        if (createdTaskId) clearClickUpTaskTombstone(this.ctx.storage.sql, args.workspaceId, createdTaskId);
        return json({ ok: true, result: result.data });
      }
      case 'updateTask': {
        const args = validateClickUpToolArguments('clickup.updateTask', command.arguments);
        const taskScope = await this.verifyTaskScope(args.workspaceId, args.taskId, false, expectedRevision);
        if (!taskScope.ok) return taskScope.response;
        if (args.parentTaskId) {
          const parentScope = await this.verifyTaskScope(args.workspaceId, args.parentTaskId, false, expectedRevision);
          if (!parentScope.ok) return parentScope.response;
        }
        const assigneeIds = [
          ...(args.assignees?.add ?? []),
          ...(args.assignees?.remove ?? []),
        ];
        const invalidAssignees = await this.validateFreshWorkspaceUsers(args.workspaceId, assigneeIds, expectedRevision);
        if (invalidAssignees) return invalidAssignees;

        // Remove the stale row and advance the index invalidation generation
        // before the provider mutation. This closes the crash window where
        // ClickUp accepts the update but Elara dies before clearing its cache.
        removeClickUpTaskFromAllIndexes(this.ctx.storage.sql, args.taskId);
        markAllClickUpTaskIndexesStale(this.ctx.storage.sql);
        const result = await this.providerData((token) => updateClickUpTask(token, args), expectedRevision);
        if (!result.ok) return result.response;
        return json({ ok: true, result: result.data });
      }
      case 'createTaskComment': {
        const args = validateClickUpToolArguments('clickup.createTaskComment', command.arguments);
        const taskScope = await this.verifyTaskScope(args.workspaceId, args.taskId, false, expectedRevision);
        if (!taskScope.ok) return taskScope.response;
        const invalidMentions = await this.validateFreshWorkspaceUsers(args.workspaceId, args.mentionUserIds, expectedRevision);
        if (invalidMentions) return invalidMentions;
        return this.runProvider((token) => createClickUpTaskComment(token, args), expectedRevision);
      }
      case 'replyToComment': {
        const args = validateClickUpToolArguments('clickup.replyToComment', command.arguments);
        const commentScope = await this.verifyCommentBelongsToTask(args.workspaceId, args.taskId, args.commentId, expectedRevision);
        if (!commentScope.ok) return commentScope.response;
        const invalidMentions = await this.validateFreshWorkspaceUsers(args.workspaceId, args.mentionUserIds, expectedRevision);
        if (invalidMentions) return invalidMentions;
        return this.runProvider((token) => replyToClickUpComment(token, args), expectedRevision);
      }
      case 'setCustomField':
      case 'clearCustomField': {
        const taskScope = await this.verifyTaskScope(command.workspaceId, command.taskId, false, expectedRevision);
        if (!taskScope.ok) return taskScope.response;
        const list = taskScope.task.list && typeof taskScope.task.list === 'object' && !Array.isArray(taskScope.task.list)
          ? taskScope.task.list as Record<string, unknown>
          : undefined;
        const listId = safeProviderId(list?.id);
        if (!listId) return json({ code: 'resource_scope_unverifiable', message: 'ClickUp did not return the task List needed to validate its Custom Field.' }, 502);
        const fieldsResult = await this.providerData((token) => getClickUpListCustomFields(token, listId), expectedRevision);
        if (!fieldsResult.ok) return fieldsResult.response;
        const fieldsRoot = fieldsResult.data && typeof fieldsResult.data === 'object' ? fieldsResult.data as Record<string, unknown> : {};
        const fields: unknown[] = Array.isArray(fieldsRoot.fields) ? fieldsRoot.fields as unknown[] : [];
        const field = fields.find((entry) => safeProviderId(
          entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).id
            : undefined,
        ) === command.fieldId);
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          return this.scopeDenied('The requested ClickUp Custom Field is not available on the admitted task.');
        }

        // ClickUp can expose a List field that is restricted to specific
        // custom task types. The provider returns 400 when a field's
        // applied_objects does not include this task's custom_item_id, so
        // reject that predictable mismatch before an approved mutation.
        const fieldRecord = field as Record<string, unknown>;
        const appliedObjects: unknown[] = Array.isArray(fieldRecord.applied_objects)
          ? fieldRecord.applied_objects as unknown[]
          : [];
        if (appliedObjects.length) {
          const taskCustomItemId = safeProviderId(taskScope.task.custom_item_id) ?? '0';
          const applicable = appliedObjects.some((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const applied = entry as Record<string, unknown>;
            return safeProviderId(applied.object_type) === '19'
              && safeProviderId(applied.object_id) === taskCustomItemId;
          });
          if (!applicable) {
            return json({
              code: 'custom_field_not_applicable',
              message: 'The requested ClickUp Custom Field is not applicable to this task type.',
            }, 400);
          }
        }

        if (command.operation === 'setCustomField') {
          const fieldType = typeof fieldRecord.type === 'string' ? fieldRecord.type.trim() : '';

          if (fieldType === 'users') {
            const references = this.customFieldDeltaIds(command.value, 100);
            if (!references.ok) return references.response;
            const invalidUsers = await this.validateFreshWorkspaceUsers(
              command.workspaceId,
              references.ids,
              expectedRevision,
            );
            if (invalidUsers) return invalidUsers;
          }

          if (fieldType === 'tasks') {
            // Relationship Custom Fields can carry arbitrary provider task IDs
            // inside the value. Treat each one as a direct-ID capability and
            // independently bind it to the admitted Workspace before egress.
            const references = this.customFieldDeltaIds(command.value, 20);
            if (!references.ok) return references.response;
            for (const taskId of references.ids) {
              const relatedScope = await this.verifyTaskScope(
                command.workspaceId,
                taskId,
                false,
                expectedRevision,
              );
              if (!relatedScope.ok) return relatedScope.response;
            }
          }
        }

        // Custom Fields are part of the persisted task projection/search
        // material. Invalidate before provider egress so a crash after ClickUp
        // commits cannot leave the pre-write task snapshot marked as current.
        // The generation bump also prevents an in-flight refresh from
        // re-committing evidence captured before this mutation.
        removeClickUpTaskFromAllIndexes(this.ctx.storage.sql, command.taskId);
        markAllClickUpTaskIndexesStale(this.ctx.storage.sql);

        const mutation = command.operation === 'setCustomField'
          ? await this.providerData((token) => setClickUpTaskCustomField(token, command.taskId, command.fieldId, command.value), expectedRevision)
          : await this.providerData((token) => clearClickUpTaskCustomField(token, command.taskId, command.fieldId), expectedRevision);
        if (!mutation.ok) return mutation.response;
        return json({ ok: true, result: mutation.data });
      }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ code: 'validation', message: 'ClickUp semantic command arguments were invalid.' }, 400);
      }
      throw error;
    }
  }

  private async executeAttachmentUpload(request: Request, expectedRevision: number): Promise<Response> {
    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.toLocaleLowerCase().startsWith('multipart/form-data;')) {
      return json({ code: 'validation', message: 'ClickUp attachment transport requires multipart/form-data.' }, 415);
    }

    const form = await request.formData();
    const workspaceId = typeof form.get('workspaceId') === 'string' ? String(form.get('workspaceId')) : '';
    const taskId = typeof form.get('taskId') === 'string' ? String(form.get('taskId')) : '';
    const artifactId = typeof form.get('artifactId') === 'string' ? String(form.get('artifactId')) : '';
    const filename = typeof form.get('filename') === 'string' ? String(form.get('filename')) : undefined;
    const file = form.get('file');

    let args;
    try {
      args = validateClickUpToolArguments('clickup.attachArtifact', {
        workspaceId,
        taskId,
        artifactId,
        ...(filename ? { filename } : {}),
      });
    } catch {
      return json({ code: 'validation', message: 'ClickUp attachment metadata was invalid.' }, 400);
    }

    if (!(file instanceof File)) {
      return json({ code: 'validation', message: 'ClickUp attachment payload is missing.' }, 400);
    }
    if (file.size > ARTIFACT_LIMITS.maxAttachmentBytes) {
      return json({ code: 'artifact-too-large', message: 'The attachment exceeds Elara\'s upload limit.' }, 413);
    }

    const taskScope = await this.verifyTaskScope(args.workspaceId, args.taskId, false, expectedRevision);
    if (!taskScope.ok) return taskScope.response;

    const result = await this.providerData((token) => uploadClickUpTaskAttachment(
      token,
      args.taskId,
      file,
      args.filename ?? file.name,
    ), expectedRevision);
    if (!result.ok) return result.response;

    const raw = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    const attachmentId = typeof raw.id === 'string'
      ? raw.id.trim()
      : typeof raw.id === 'number' && Number.isSafeInteger(raw.id)
        ? String(raw.id)
        : undefined;
    const providerTitle = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 500)
      : undefined;

    return json({
      ok: true,
      result: {
        trust: 'untrusted-external',
        provider: 'clickup',
        workspaceId: args.workspaceId,
        taskId: args.taskId,
        artifactId: args.artifactId,
        filename: args.filename ?? file.name,
        size: file.size,
        ...(attachmentId ? { attachmentId } : {}),
        ...(providerTitle ? { providerTitle } : {}),
      },
    });
  }

  private webhookRows(): WebhookRow[] {
    return this.ctx.storage.sql.exec<WebhookRow>(
      'SELECT webhook_id, workspace_id, secret_cipher, secret_iv, endpoint, updated_at FROM clickup_webhooks ORDER BY workspace_id ASC',
    ).toArray();
  }

  private detachStoredWebhooks(): WebhookRow[] {
    const rows = this.webhookRows();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhooks');
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhook_deliveries');
    });
    return rows;
  }

  private async deleteProviderWebhooks(accessToken: string, rows: readonly WebhookRow[]): Promise<void> {
    for (const row of rows) {
      try {
        await deleteClickUpWebhook(accessToken, row.webhook_id);
      } catch {
        // Local secret removal is authoritative even if provider cleanup is unavailable.
      }
    }
  }

  private async clearStoredWebhooks(accessToken?: string | null): Promise<void> {
    const rows = this.detachStoredWebhooks();
    if (accessToken && rows.length) await this.deleteProviderWebhooks(accessToken, rows);
  }

  private grantLifecycleCurrent(epoch: number, revision: number): boolean {
    return this.connectionEpoch() === epoch && this.credentialRow()?.updated_at === revision;
  }

  private async cleanupCreatedWebhook(accessToken: string, webhookId: string | null): Promise<void> {
    if (!webhookId) return;
    try {
      await deleteClickUpWebhook(accessToken, webhookId);
    } catch {
      // Best-effort provider cleanup; without a local secret/row, callbacks are ignored.
    }
  }

  private async registerTaskIndexWebhooks(
    accessToken: string,
    workspaces: readonly { id: string }[],
    endpoint: string | null,
    expectedEpoch: number,
    expectedRevision: number,
  ): Promise<void> {
    if (!endpoint) return;
    for (const workspace of workspaces) {
      if (!this.grantLifecycleCurrent(expectedEpoch, expectedRevision)) return;

      // Webhook registration is provider egress under the same token as normal
      // tool calls, so it must consume the same durable rate authority before
      // leaving the vault. A failed/network-ambiguous registration keeps its
      // reservation consumed conservatively.
      const reservation = this.reserveProviderCall();
      if (reservation.blocked) return;

      try {
        const result = await createClickUpWebhook(
          accessToken,
          workspace.id,
          endpoint,
          CLICKUP_TASK_INDEX_WEBHOOK_EVENTS,
        );
        const root = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
        const webhook = root.webhook && typeof root.webhook === 'object'
          ? root.webhook as Record<string, unknown>
          : root;
        const webhookId = safeProviderId(webhook.id);
        const secret = typeof webhook.secret === 'string' ? webhook.secret.trim() : '';

        if (!this.grantLifecycleCurrent(expectedEpoch, expectedRevision)) {
          await this.cleanupCreatedWebhook(accessToken, webhookId);
          return;
        }

        this.recordRateLimit(result.rateLimit);

        if (!webhookId || !secret || secret.length > 16_384) {
          await this.cleanupCreatedWebhook(accessToken, webhookId);
          continue;
        }

        const encrypted = await encryptToken(this.vaultSecret(), secret);
        if (!this.grantLifecycleCurrent(expectedEpoch, expectedRevision)) {
          await this.cleanupCreatedWebhook(accessToken, webhookId);
          return;
        }

        const stored = this.ctx.storage.transactionSync(() => {
          if (!this.grantLifecycleCurrent(expectedEpoch, expectedRevision)) return false;
          this.ctx.storage.sql.exec(`
            INSERT INTO clickup_webhooks (
              webhook_id, workspace_id, secret_cipher, secret_iv, endpoint, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              webhook_id = excluded.webhook_id,
              secret_cipher = excluded.secret_cipher,
              secret_iv = excluded.secret_iv,
              endpoint = excluded.endpoint,
              updated_at = excluded.updated_at
          `, webhookId, workspace.id, encrypted.cipher, encrypted.iv, endpoint, Date.now());
          return true;
        });

        if (!stored) {
          await this.cleanupCreatedWebhook(accessToken, webhookId);
          return;
        }

        if (result.rateLimit.remaining !== null && result.rateLimit.remaining <= 1) break;
      } catch (error) {
        if (error instanceof ClickUpProviderError) {
          if (this.grantLifecycleCurrent(expectedEpoch, expectedRevision)) {
            this.recordRateLimit(error.rateLimit);
          }
          if (this.providerCredentialRevoked(error)) break;
        }
        // Webhooks optimize freshness only. OAuth remains usable without them.
      }
    }
  }

  private async executeWebhook(body: string, signatureHeader: string | null): Promise<Response> {
    if (!signatureHeader || !/^[a-f0-9]{64}$/i.test(signatureHeader)) {
      return json({ code: 'webhook_signature', message: 'ClickUp webhook signature is invalid.' }, 401);
    }

    const parsed = webhookPayloadSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'webhook_payload', message: 'ClickUp webhook payload is invalid.' }, 400);
    const payload = parsed.data;
    const row = this.ctx.storage.sql.exec<WebhookRow>(
      'SELECT webhook_id, workspace_id, secret_cipher, secret_iv, endpoint, updated_at FROM clickup_webhooks WHERE webhook_id = ?',
      payload.webhook_id,
    ).toArray()[0];

    // Old/orphan provider registrations are intentionally acknowledged after
    // local reconnect/disconnect so they cannot create a delivery retry storm.
    if (!row) return json({ accepted: true, ignored: true });

    const secret = await decryptToken(this.vaultSecret(), row.secret_cipher, row.secret_iv);
    const expected = await hmacHex(secret, body);
    if (!constantTimeEqual(signatureHeader.toLocaleLowerCase(), expected)) {
      return json({ code: 'webhook_signature', message: 'ClickUp webhook signature is invalid.' }, 401);
    }

    const historyKeys = (payload.history_items ?? []).flatMap((item) => {
      const historyId = safeProviderId(item.id);
      return historyId ? [`${payload.webhook_id}:${historyId}`] : [];
    });
    const keys = historyKeys.length
      ? [...new Set(historyKeys)]
      : [`${payload.webhook_id}:body:${await sha256Hex(body)}`];

    const now = Date.now();
    const taskId = safeProviderId(payload.task_id);
    const accepted = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'DELETE FROM clickup_webhook_deliveries WHERE received_at < ?',
        now - WEBHOOK_DELIVERY_RETENTION_MS,
      );
      const unseen = keys.filter((key) => !this.ctx.storage.sql.exec<{ dedupe_key: string }>(
        'SELECT dedupe_key FROM clickup_webhook_deliveries WHERE dedupe_key = ?',
        key,
      ).toArray()[0]);
      if (!unseen.length) return false;

      // Commit webhook idempotency and its cache/index effect together. If the
      // Durable Object is interrupted after this transaction commits, a
      // provider redelivery cannot be mistaken for "already processed" while
      // the corresponding delete/stale mutation was actually lost.
      for (const key of unseen) {
        this.ctx.storage.sql.exec(
          'INSERT INTO clickup_webhook_deliveries (dedupe_key, received_at) VALUES (?, ?)',
          key,
          now,
        );
      }
      if (payload.event === 'taskDeleted' && taskId) {
        tombstoneClickUpTask(this.ctx.storage.sql, row.workspace_id, taskId, now);
      } else if (payload.event === 'taskCreated' && taskId) {
        clearClickUpTaskTombstone(this.ctx.storage.sql, row.workspace_id, taskId);
      }
      if (payload.event.startsWith('task')) {
        markClickUpWorkspaceTaskIndexStale(this.ctx.storage.sql, row.workspace_id);
      }
      return true;
    });

    if (!accepted) return json({ accepted: true, duplicate: true });
    return json({ accepted: true });
  }

  private async verifyRead(request: Request): Promise<boolean> {
    const presented = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    return verifyBearerToken(presented, this.installationToken());
  }

  private async verifyWrite(request: Request, body: string): Promise<{ ok: boolean; code?: string }> {
    const verified = await verifySignedWrite({
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp: request.headers.get(ELARA_AUTH_TIMESTAMP_HEADER) ?? '',
      nonce: request.headers.get(ELARA_AUTH_NONCE_HEADER) ?? '',
      signature: request.headers.get(ELARA_AUTH_SIGNATURE_HEADER) ?? '',
      body,
    }, this.installationToken(), Date.now());
    if (!verified.ok) return { ok: false, code: verified.code ?? 'bad-signature' };

    const nonce = request.headers.get(ELARA_AUTH_NONCE_HEADER) ?? '';
    const now = Date.now();
    const accepted = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_nonces WHERE used_at < ?', now - NONCE_RETENTION_MS);
      const existing = this.ctx.storage.sql.exec<{ nonce: string }>('SELECT nonce FROM clickup_oauth_nonces WHERE nonce = ?', nonce).toArray()[0];
      if (existing) return false;
      this.ctx.storage.sql.exec('INSERT INTO clickup_oauth_nonces (nonce, used_at) VALUES (?, ?)', nonce, now);
      return true;
    });
    return accepted ? { ok: true } : { ok: false, code: 'replayed-nonce' };
  }

  private authorizationContext() {
    const row = this.credentialRow();
    if (!row) return null;
    let workspaces: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(row.workspaces_json) as unknown;
      if (Array.isArray(parsed)) {
        workspaces = parsed.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object').slice(0, 100);
      }
    } catch {
      workspaces = [];
    }
    return {
      account: {
        id: row.user_id,
        ...(row.username ? { username: row.username } : {}),
        ...(row.email ? { email: row.email } : {}),
      },
      workspaces,
      updatedAt: row.updated_at,
    };
  }

  private status() {
    const context = this.authorizationContext();
    if (!context) return { connected: false, workspaces: [] as unknown[] };
    const workspaces = context.workspaces.flatMap((workspace) => {
      const id = typeof workspace.id === 'string' ? workspace.id.trim() : '';
      const name = typeof workspace.name === 'string' ? workspace.name.trim() : '';
      return id && name ? [{ id, name }] : [];
    });
    return {
      connected: true,
      account: context.account,
      workspaces,
      updatedAt: context.updatedAt,
    };
  }

  private workspaceAuthorized(workspaceId: string): boolean {
    const context = this.authorizationContext();
    return Boolean(context?.workspaces.some((workspace) => String(workspace.id ?? '') === workspaceId));
  }

  private async refreshWorkspaceAuthorization(
    workspaceId: string,
    expectedRevision: number,
  ): Promise<{ ok: true; workspace: Record<string, unknown> } | { ok: false; response: Response }> {
    if (!this.workspaceAuthorized(workspaceId)) {
      return {
        ok: false,
        response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403),
      };
    }

    const result = await this.providerData(
      (token) => fetchAuthorizedClickUpWorkspaces(token),
      expectedRevision,
    );
    if (!result.ok) return { ok: false, response: result.response };

    const fresh = result.data.find((workspace) => workspace.id === workspaceId);
    if (!fresh) {
      this.revokeWorkspaceIfRevision(workspaceId, result.grantRevision);
      return {
        ok: false,
        response: json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is no longer available to this grant.' }, 403),
      };
    }

    const committed = this.ctx.storage.transactionSync(() => {
      const row = this.credentialRow();
      if (!row || row.updated_at !== result.grantRevision) return false;

      let current: Array<Record<string, unknown>>;
      try {
        const parsed = JSON.parse(row.workspaces_json) as unknown;
        current = Array.isArray(parsed)
          ? parsed.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
          : [];
      } catch {
        current = [];
      }

      const index = current.findIndex((workspace) => String(workspace.id ?? '') === workspaceId);
      if (index < 0) return false;

      // Refresh only an already-admitted Workspace. Provider-visible Workspaces
      // that were not in the original Elara grant are intentionally ignored.
      current[index] = {
        id: fresh.id,
        name: fresh.name,
        members: fresh.members.map((member) => ({
          id: member.id,
          ...(member.username ? { username: member.username } : {}),
          ...(member.email ? { email: member.email } : {}),
          ...(member.profilePicture ? { profilePicture: member.profilePicture } : {}),
        })),
      };

      this.ctx.storage.sql.exec(
        'UPDATE clickup_oauth_credential SET workspaces_json = ? WHERE slot = 1 AND updated_at = ?',
        JSON.stringify(current),
        result.grantRevision,
      );
      return true;
    });

    if (!committed) {
      return {
        ok: false,
        response: json({ code: 'grant_changed', message: 'ClickUp authorization changed while Workspace membership was refreshing.' }, 409),
      };
    }

    return {
      ok: true,
      workspace: {
        id: fresh.id,
        name: fresh.name,
        members: fresh.members,
      },
    };
  }

  private revokeWorkspaceIfRevision(workspaceId: string, revision: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      const row = this.credentialRow();
      if (!row || row.updated_at !== revision) return false;

      let workspaces: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(row.workspaces_json) as unknown;
        if (Array.isArray(parsed)) {
          workspaces = parsed.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object');
        }
      } catch {
        workspaces = [];
      }

      const filtered = workspaces.filter((workspace) => String(workspace.id ?? '') !== workspaceId);
      clearClickUpWorkspaceTaskIndex(this.ctx.storage.sql, workspaceId);
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhooks WHERE workspace_id = ?', workspaceId);

      if (filtered.length === workspaces.length) return false;
      if (!filtered.length) {
        this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_credential WHERE slot = 1');
        this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
        this.ctx.storage.sql.exec('DELETE FROM clickup_webhooks');
        return true;
      }

      const nextRevision = Math.max(Date.now(), row.updated_at + 1);
      this.ctx.storage.sql.exec(
        'UPDATE clickup_oauth_credential SET workspaces_json = ?, updated_at = ? WHERE slot = 1 AND updated_at = ?',
        JSON.stringify(filtered),
        nextRevision,
        revision,
      );
      return true;
    });
  }

  private async start(request: Request, body: string): Promise<Response> {
    const parsed = startSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'validation', message: 'ClickUp OAuth start payload was invalid.' }, 400);
    const origin = normalizeOrigin(request.headers.get('Origin'));
    if (!origin || !validRedirectUri(parsed.data.redirectUri, origin)) {
      return json({ code: 'redirect_uri', message: 'ClickUp OAuth redirect URI must use HTTPS and match the calling origin.' }, 400);
    }

    const state = randomState();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      // Only the newest explicit Connect gesture may remain authoritative.
      // Advance the epoch as well as replacing pending state so a previous
      // exchange already awaiting ClickUp cannot resume later and overwrite
      // the account chosen by this newer Connect flow.
      const nextEpoch = this.connectionEpoch() + 1;
      this.ctx.storage.sql.exec('UPDATE clickup_connection_epoch SET epoch = ? WHERE slot = 1', nextEpoch);
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states');
      this.ctx.storage.sql.exec('INSERT INTO clickup_oauth_states (state, redirect_uri, created_at) VALUES (?, ?, ?)', state, parsed.data.redirectUri, now);
    });
    const authorize = new URL('https://app.clickup.com/api');
    authorize.searchParams.set('client_id', this.clientId());
    authorize.searchParams.set('redirect_uri', parsed.data.redirectUri);
    authorize.searchParams.set('state', state);
    return json({ authorizationUrl: authorize.toString(), state, expiresAt: now + STATE_TTL_MS });
  }

  private async exchange(request: Request, body: string): Promise<Response> {
    const parsed = exchangeSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'validation', message: 'ClickUp OAuth exchange payload was invalid.' }, 400);
    const origin = normalizeOrigin(request.headers.get('Origin'));
    if (!origin || !validRedirectUri(parsed.data.redirectUri, origin)) {
      return json({ code: 'redirect_uri', message: 'ClickUp OAuth redirect URI must use HTTPS and match the calling origin.' }, 400);
    }

    const now = Date.now();
    const acceptedState = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states WHERE created_at < ?', now - STATE_TTL_MS);
      const row = this.ctx.storage.sql.exec<{ redirect_uri: string; created_at: number }>(
        'SELECT redirect_uri, created_at FROM clickup_oauth_states WHERE state = ?',
        parsed.data.state,
      ).toArray()[0];
      if (!row || row.redirect_uri !== parsed.data.redirectUri || now - row.created_at > STATE_TTL_MS) return false;
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states WHERE state = ?', parsed.data.state);
      return true;
    });
    if (!acceptedState) return json({ code: 'oauth_state', message: 'ClickUp OAuth state is missing, expired, replayed, or does not match this redirect.' }, 409);

    const exchangeEpoch = this.advanceConnectionEpoch();
    const previousAccessToken = await this.accessToken().catch(() => null);

    // Do not tear down the currently-valid grant's webhook state until the
    // replacement authorization is fully validated. A failed reconnect must
    // leave the old credential + auxiliary webhook state intact.
    const accessToken = await exchangeClickUpAuthorizationCode(this.oauthEnv, parsed.data.code);
    const [account, workspaces] = await Promise.all([
      fetchAuthorizedClickUpUser(accessToken),
      fetchAuthorizedClickUpWorkspaces(accessToken),
    ]);
    if (!workspaces.data.length) {
      return json({ code: 'no_workspace', message: 'ClickUp authorized no Workspaces for this integration.' }, 409);
    }
    if (this.connectionEpoch() !== exchangeEpoch) {
      return json({ code: 'oauth_superseded', message: 'This ClickUp authorization was superseded by a newer connect or disconnect action.' }, 409);
    }
    const encrypted = await encryptToken(this.vaultSecret(), accessToken);
    if (this.connectionEpoch() !== exchangeEpoch) {
      return json({ code: 'oauth_superseded', message: 'This ClickUp authorization was superseded by a newer connect or disconnect action.' }, 409);
    }
    const initialRateLimit = mergeRateLimits(account.rateLimit, workspaces.rateLimit);
    // Credential replacement and all grant-scoped local state move as one
    // SQLite transaction. A crash must never expose a new account alongside
    // task/index/webhook/rate state that was populated by the previous grant.
    const replacement = this.ctx.storage.transactionSync(() => {
      if (this.connectionEpoch() !== exchangeEpoch) return null;
      const previous = this.credentialRow();
      const revision = Math.max(now, (previous?.updated_at ?? 0) + 1);
      const previousWebhookRows = this.webhookRows();

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
      `, encrypted.cipher, encrypted.iv, account.data.id, account.data.username ?? null, account.data.email ?? null, JSON.stringify(workspaces.data), revision);
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhooks');
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhook_deliveries');
      this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
      if (
        initialRateLimit.limit !== null
        || initialRateLimit.remaining !== null
        || initialRateLimit.resetAt !== null
      ) {
        this.ctx.storage.sql.exec(
          'INSERT INTO clickup_rate_limit (slot, limit_count, remaining, reset_at, updated_at) VALUES (1, ?, ?, ?, ?)',
          initialRateLimit.limit,
          initialRateLimit.remaining,
          initialRateLimit.resetAt,
          Date.now(),
        );
      }
      clearClickUpTaskIndex(this.ctx.storage.sql);

      return { revision, previousWebhookRows };
    });
    if (!replacement) {
      return json({ code: 'oauth_superseded', message: 'This ClickUp authorization was superseded by a newer connect or disconnect action.' }, 409);
    }
    const { revision, previousWebhookRows } = replacement;

    if (previousAccessToken && previousWebhookRows.length) {
      await this.deleteProviderWebhooks(previousAccessToken, previousWebhookRows);
    }
    if (!this.grantLifecycleCurrent(exchangeEpoch, revision)) {
      return json({ code: 'oauth_superseded', message: 'This ClickUp authorization was superseded by a newer connect or disconnect action.' }, 409);
    }

    await this.registerTaskIndexWebhooks(
      accessToken,
      workspaces.data,
      validWebhookEndpoint(request.headers.get(CLICKUP_WEBHOOK_ENDPOINT_HEADER)),
      exchangeEpoch,
      revision,
    );
    if (!this.grantLifecycleCurrent(exchangeEpoch, revision)) {
      return json({ code: 'oauth_superseded', message: 'This ClickUp authorization was superseded by a newer connect or disconnect action.' }, 409);
    }

    return json(this.status());
  }

  private async disconnect(body: string): Promise<Response> {
    if (!emptySchema.safeParse(parseJson(body)).success) {
      return json({ code: 'validation', message: 'ClickUp disconnect payload was invalid.' }, 400);
    }

    // Local disconnect is atomic before the first await. A crash or reconnect
    // cannot leave a usable credential paired with partially-cleared grant
    // state, and provider cleanup can safely remain best-effort afterward.
    const detached = this.ctx.storage.transactionSync(() => {
      const nextEpoch = this.connectionEpoch() + 1;
      this.ctx.storage.sql.exec('UPDATE clickup_connection_epoch SET epoch = ? WHERE slot = 1', nextEpoch);
      const previous = this.credentialRow();
      const webhookRows = this.webhookRows();
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhooks');
      this.ctx.storage.sql.exec('DELETE FROM clickup_webhook_deliveries');
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_credential WHERE slot = 1');
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states');
      this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
      clearClickUpTaskIndex(this.ctx.storage.sql);
      return { previous, webhookRows };
    });
    const { previous, webhookRows } = detached;

    let token: string | null = null;
    if (previous) {
      try {
        token = await decryptToken(this.vaultSecret(), previous.access_cipher, previous.access_iv);
      } catch {
        token = null;
      }
    }
    if (token && webhookRows.length) {
      await this.deleteProviderWebhooks(token, webhookRows);
    }

    return json({ disconnected: true, providerRevoked: false });
  }

  /** Provider execution consumes credential material only inside this Durable Object. */
  private async accessGrant(): Promise<{ token: string; revision: number } | null> {
    const row = this.credentialRow();
    if (!row) return null;
    return {
      token: await decryptToken(this.vaultSecret(), row.access_cipher, row.access_iv),
      revision: row.updated_at,
    };
  }

  protected async accessToken(): Promise<string | null> {
    return (await this.accessGrant())?.token ?? null;
  }
}
