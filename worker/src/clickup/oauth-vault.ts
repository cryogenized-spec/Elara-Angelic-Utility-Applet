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
  type ClickUpOAuthServerEnv,
  type ClickUpProviderResult,
  type ClickUpRateLimitSnapshot,
} from './provider';
import { validateClickUpToolArguments } from '../../../src/clickup/tool-schema';

interface ClickUpOAuthVaultEnv extends ClickUpOAuthServerEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH_VAULT_KEY?: string;
}

type RateLimitRow = {
  limit_count: number | null;
  remaining: number | null;
  reset_at: number | null;
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

const providerCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('getAuthorizationContext') }).strict(),
  z.object({ operation: z.literal('listSpaces'), workspaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolders'), spaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('getFolder'), folderId: z.string().trim().min(1).max(100), includeSubfolders: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolderLists'), folderId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('listFolderlessLists'), spaceId: z.string().trim().min(1).max(100), archived: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('getList'), listId: z.string().trim().min(1).max(100) }).strict(),
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
  z.object({ operation: z.literal('getTask'), arguments: z.unknown() }).strict(),
  z.object({
    operation: z.literal('getTaskComments'),
    taskId: z.string().trim().min(1).max(500),
    start: z.number().int().min(0).optional(),
    startId: z.string().trim().min(1).max(100).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.start === undefined) !== (value.startId === undefined)) {
      context.addIssue({ code: 'custom', message: 'Comment pagination requires start and startId together.' });
    }
  }),
  z.object({ operation: z.literal('getListCustomFields'), listId: z.string().trim().min(1).max(100) }).strict(),
  z.object({ operation: z.literal('createTask'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('updateTask'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('createTaskComment'), arguments: z.unknown() }).strict(),
  z.object({ operation: z.literal('replyToComment'), arguments: z.unknown() }).strict(),
  z.object({
    operation: z.literal('setCustomField'),
    taskId: z.string().trim().min(1).max(500),
    fieldId: z.string().trim().min(1).max(500),
    value: z.unknown(),
  }).strict(),
  z.object({
    operation: z.literal('clearCustomField'),
    taskId: z.string().trim().min(1).max(500),
    fieldId: z.string().trim().min(1).max(500),
  }).strict(),
]);
const MAX_BODY_CHARS = 16_384;
const STATE_TTL_MS = 10 * 60_000;
const NONCE_RETENTION_MS = 10 * 60_000;
const VAULT_KEY_CONTEXT = 'elara-clickup-oauth-vault-v1';

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
        updated_at INTEGER NOT NULL
      )
    `);
  }

  protected credentialRow(): CredentialRow | null {
    return this.ctx.storage.sql.exec<CredentialRow>(
      'SELECT access_cipher, access_iv, user_id, username, email, workspaces_json, updated_at FROM clickup_oauth_credential WHERE slot = 1',
    ).toArray()[0] ?? null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/internal/clickup/command') {
        if (!(await this.verifyInternal(request))) return json({ code: 'auth', message: 'Binding-internal ClickUp authority is required.' }, 401);
        const body = await request.text();
        if (body.length > 64_000) return json({ code: 'validation', message: 'ClickUp internal command is too large.' }, 413);
        return this.executeProviderCommand(body);
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

      if (url.pathname === '/clickup/oauth/start') return this.start(request, body);
      if (url.pathname === '/clickup/oauth/exchange') return this.exchange(request, body);
      if (url.pathname === '/clickup/oauth/disconnect') return this.disconnect(body);
      return json({ code: 'not_found', message: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof ClickUpProviderError) {
        return json({ code: error.code, message: error.message }, error.status);
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

  private rateLimitRow(): RateLimitRow | null {
    return this.ctx.storage.sql.exec<RateLimitRow>(
      'SELECT limit_count, remaining, reset_at, updated_at FROM clickup_rate_limit WHERE slot = 1',
    ).toArray()[0] ?? null;
  }

  private reserveProviderCall(): { blocked: boolean; retryAt?: number } {
    const row = this.rateLimitRow();
    if (!row) return { blocked: false };
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (row.reset_at !== null && row.reset_at <= nowSeconds) {
      this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
      return { blocked: false };
    }
    if (row.remaining !== null && row.remaining <= 0) {
      return { blocked: true, ...(row.reset_at !== null ? { retryAt: row.reset_at * 1000 } : {}) };
    }
    if (row.remaining !== null) {
      this.ctx.storage.sql.exec(
        'UPDATE clickup_rate_limit SET remaining = ?, updated_at = ? WHERE slot = 1',
        Math.max(0, row.remaining - 1),
        Date.now(),
      );
    }
    return { blocked: false };
  }

  private recordRateLimit(rateLimit: ClickUpRateLimitSnapshot): void {
    if (rateLimit.limit === null && rateLimit.remaining === null && rateLimit.resetAt === null) return;
    this.ctx.storage.sql.exec(`
      INSERT INTO clickup_rate_limit (slot, limit_count, remaining, reset_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET
        limit_count = excluded.limit_count,
        remaining = excluded.remaining,
        reset_at = excluded.reset_at,
        updated_at = excluded.updated_at
    `, rateLimit.limit, rateLimit.remaining, rateLimit.resetAt, Date.now());
  }

  private providerCredentialRevoked(error: ClickUpProviderError): boolean {
    return error.status === 401 || new Set(['OAUTH_019', 'OAUTH_021', 'OAUTH_025', 'OAUTH_077']).has(error.code);
  }

  private async runProvider<T>(
    run: (accessToken: string) => Promise<ClickUpProviderResult<T>>,
  ): Promise<Response> {
    const token = await this.accessToken();
    if (!token) return json({ code: 'authorization_required', message: 'Connect ClickUp before using ClickUp tools.' }, 401);
    const reservation = this.reserveProviderCall();
    if (reservation.blocked) {
      return json({
        code: 'rate_limited',
        message: 'ClickUp request budget is exhausted for the current provider window.',
        ...(reservation.retryAt ? { retryAt: reservation.retryAt } : {}),
      }, 429);
    }
    try {
      const result = await run(token);
      this.recordRateLimit(result.rateLimit);
      return json({ ok: true, result: result.data });
    } catch (error) {
      if (!(error instanceof ClickUpProviderError)) throw error;
      this.recordRateLimit(error.rateLimit);
      if (this.providerCredentialRevoked(error)) {
        this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_credential WHERE slot = 1');
        this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
      }
      return json({
        code: error.code,
        message: error.message,
        ...(error.rateLimit.resetAt ? { retryAt: error.rateLimit.resetAt * 1000 } : {}),
      }, error.status);
    }
  }

  private async executeProviderCommand(body: string): Promise<Response> {
    const parsed = providerCommandSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'validation', message: 'ClickUp internal provider command was invalid.' }, 400);
    const command = parsed.data;
    try {
      switch (command.operation) {
      case 'getAuthorizationContext': {
        const context = this.authorizationContext();
        return context
          ? json({ ok: true, result: context })
          : json({ code: 'authorization_required', message: 'Connect ClickUp before using ClickUp tools.' }, 401);
      }
      case 'listSpaces':
        if (!this.workspaceAuthorized(command.workspaceId)) {
          return json({ code: 'workspace_forbidden', message: 'The requested ClickUp Workspace is not part of the authorized grant.' }, 403);
        }
        return this.runProvider((token) => listClickUpSpaces(token, command.workspaceId, command.archived ?? false));
      case 'listFolders':
        return this.runProvider((token) => listClickUpFolders(token, command.spaceId, command.archived ?? false));
      case 'getFolder':
        return this.runProvider((token) => getClickUpFolder(token, command.folderId, command.includeSubfolders ?? true));
      case 'listFolderLists':
        return this.runProvider((token) => listClickUpFolderLists(token, command.folderId, command.archived ?? false));
      case 'listFolderlessLists':
        return this.runProvider((token) => listClickUpFolderlessLists(token, command.spaceId, command.archived ?? false));
      case 'getList':
        return this.runProvider((token) => getClickUpList(token, command.listId));
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
        }));
      case 'getTask': {
        const args = validateClickUpToolArguments('clickup.getTask', command.arguments);
        return this.runProvider((token) => getClickUpTask(token, args.taskId, args.includeSubtasks ?? false));
      }
      case 'getTaskComments':
        return this.runProvider((token) => getClickUpTaskComments(
          token,
          command.taskId,
          command.start !== undefined && command.startId ? { start: command.start, startId: command.startId } : undefined,
        ));
      case 'getListCustomFields':
        return this.runProvider((token) => getClickUpListCustomFields(token, command.listId));
      case 'createTask': {
        const args = validateClickUpToolArguments('clickup.createTask', command.arguments);
        return this.runProvider((token) => createClickUpTask(token, args));
      }
      case 'updateTask': {
        const args = validateClickUpToolArguments('clickup.updateTask', command.arguments);
        return this.runProvider((token) => updateClickUpTask(token, args));
      }
      case 'createTaskComment': {
        const args = validateClickUpToolArguments('clickup.createTaskComment', command.arguments);
        return this.runProvider((token) => createClickUpTaskComment(token, args));
      }
      case 'replyToComment': {
        const args = validateClickUpToolArguments('clickup.replyToComment', command.arguments);
        return this.runProvider((token) => replyToClickUpComment(token, args));
      }
      case 'setCustomField':
        return this.runProvider((token) => setClickUpTaskCustomField(token, command.taskId, command.fieldId, command.value));
      case 'clearCustomField':
        return this.runProvider((token) => clearClickUpTaskCustomField(token, command.taskId, command.fieldId));
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ code: 'validation', message: 'ClickUp semantic command arguments were invalid.' }, 400);
      }
      throw error;
    }
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
      this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states WHERE created_at < ?', now - STATE_TTL_MS);
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

    const accessToken = await exchangeClickUpAuthorizationCode(this.oauthEnv, parsed.data.code);
    const [account, workspaces] = await Promise.all([
      fetchAuthorizedClickUpUser(accessToken),
      fetchAuthorizedClickUpWorkspaces(accessToken),
    ]);
    if (!workspaces.data.length) {
      return json({ code: 'no_workspace', message: 'ClickUp authorized no Workspaces for this integration.' }, 409);
    }
    const encrypted = await encryptToken(this.vaultSecret(), accessToken);
    const previous = this.credentialRow();
    const revision = Math.max(now, (previous?.updated_at ?? 0) + 1);
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
    this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
    this.recordRateLimit(mergeRateLimits(account.rateLimit, workspaces.rateLimit));

    return json(this.status());
  }

  private async disconnect(body: string): Promise<Response> {
    if (!emptySchema.safeParse(parseJson(body)).success) {
      return json({ code: 'validation', message: 'ClickUp disconnect payload was invalid.' }, 400);
    }
    this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_credential WHERE slot = 1');
    this.ctx.storage.sql.exec('DELETE FROM clickup_oauth_states');
    this.ctx.storage.sql.exec('DELETE FROM clickup_rate_limit WHERE slot = 1');
    return json({ disconnected: true, providerRevoked: false });
  }

  /** Pass-3 MCP execution consumes the credential only inside this Durable Object. */
  protected async accessToken(): Promise<string | null> {
    const row = this.credentialRow();
    if (!row) return null;
    return decryptToken(this.vaultSecret(), row.access_cipher, row.access_iv);
  }
}
