import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleOAuthAccount,
  refreshGoogleAccessToken,
  revokeGoogleOAuthToken,
  type GoogleOAuthAccount,
  type GoogleOAuthServerEnv,
} from './oauth-provider';

interface GoogleOAuthVaultEnv extends GoogleOAuthServerEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly GOOGLE_OAUTH_VAULT_KEY?: string;
}

type CredentialRow = {
  refresh_cipher: string;
  refresh_iv: string;
  scopes: string;
  email: string | null;
  display_name: string | null;
  updated_at: number;
  refresh_expires_at: number | null;
};

const exchangeSchema = z.object({
  code: z.string().min(1).max(4096),
  redirectUri: z.string().url().max(2048),
}).strict();

const emptySchema = z.object({}).strict();
const MAX_BODY_CHARS = 16_384;
const NONCE_RETENTION_MS = 10 * 60_000;
const VAULT_KEY_CONTEXT = 'elara-google-oauth-vault-v1';

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

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function vaultKey(secret: string): Promise<CryptoKey> {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error('GOOGLE_OAUTH_VAULT_KEY must be at least 32 characters.');
  const material = new TextEncoder().encode(`${VAULT_KEY_CONTEXT}\n${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptRefreshToken(secret: string, token: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await vaultKey(secret),
    new TextEncoder().encode(token),
  );
  return { cipher: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptRefreshToken(secret: string, cipher: string, iv: string): Promise<string> {
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

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

export class GoogleOAuthVault extends DurableObject {
  private readonly oauthEnv: GoogleOAuthVaultEnv;

  constructor(ctx: DurableObjectState, env: GoogleOAuthVaultEnv) {
    super(ctx, env as unknown as Record<string, unknown>);
    this.oauthEnv = env;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS google_oauth_credential (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        refresh_cipher TEXT NOT NULL,
        refresh_iv TEXT NOT NULL,
        scopes TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        updated_at INTEGER NOT NULL,
        refresh_expires_at INTEGER
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS google_oauth_nonces (
        nonce TEXT PRIMARY KEY,
        used_at INTEGER NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/google/oauth/status') {
        if (!(await this.verifyRead(request))) return json({ code: 'auth', message: 'A valid installation credential is required.' }, 401);
        return json(this.status());
      }

      if (request.method !== 'POST') return json({ code: 'not_found', message: 'Not found.' }, 404);
      const body = await request.text();
      if (body.length > MAX_BODY_CHARS) return json({ code: 'validation', message: 'Google OAuth request body is too large.' }, 413);
      const writeAuth = await this.verifyWrite(request, body);
      if (!writeAuth.ok) {
        const status = writeAuth.code === 'stale-timestamp' || writeAuth.code === 'replayed-nonce' ? 409 : 401;
        return json({ code: writeAuth.code, message: `Google OAuth write rejected: ${writeAuth.code}.` }, status);
      }

      if (url.pathname === '/google/oauth/exchange') return this.exchange(request, body);
      if (url.pathname === '/google/oauth/token') return this.refresh(body);
      if (url.pathname === '/google/oauth/disconnect') return this.disconnect(body);
      return json({ code: 'not_found', message: 'Not found.' }, 404);
    } catch {
      return json({ code: 'oauth', message: 'Google OAuth vault could not complete the request.' }, 502);
    }
  }

  protected credentialRow(): CredentialRow | null {
    return this.ctx.storage.sql.exec<CredentialRow>(
      'SELECT refresh_cipher, refresh_iv, scopes, email, display_name, updated_at, refresh_expires_at FROM google_oauth_credential WHERE slot = 1',
    ).toArray()[0] ?? null;
  }

  private installationToken(): string {
    const token = this.oauthEnv.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
    if (!token) throw new Error('ELARA_INSTALLATION_TOKEN is not configured.');
    return token;
  }

  private vaultSecret(): string {
    const secret = this.oauthEnv.GOOGLE_OAUTH_VAULT_KEY?.trim() ?? '';
    if (!secret) throw new Error('GOOGLE_OAUTH_VAULT_KEY is not configured.');
    return secret;
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
      this.ctx.storage.sql.exec('DELETE FROM google_oauth_nonces WHERE used_at < ?', now - NONCE_RETENTION_MS);
      const existing = this.ctx.storage.sql.exec<{ nonce: string }>('SELECT nonce FROM google_oauth_nonces WHERE nonce = ?', nonce).toArray()[0];
      if (existing) return false;
      this.ctx.storage.sql.exec('INSERT INTO google_oauth_nonces (nonce, used_at) VALUES (?, ?)', nonce, now);
      return true;
    });
    return accepted ? { ok: true } : { ok: false, code: 'replayed-nonce' };
  }

  private status() {
    const row = this.credentialRow();
    if (!row) return { connected: false, scopes: [] as string[] };
    return {
      connected: true,
      scopes: parseScopes(row.scopes),
      account: row.email ? { email: row.email, ...(row.display_name ? { displayName: row.display_name } : {}) } : undefined,
      updatedAt: row.updated_at,
      ...(row.refresh_expires_at ? { refreshTokenExpiresAt: row.refresh_expires_at } : {}),
    };
  }

  private async exchange(request: Request, body: string): Promise<Response> {
    if (request.headers.get('X-Requested-With') !== 'XmlHttpRequest') {
      return json({ code: 'csrf', message: 'Google OAuth exchange requires the popup CSRF marker.' }, 403);
    }
    const parsed = exchangeSchema.safeParse(parseJson(body));
    if (!parsed.success) return json({ code: 'validation', message: 'Google OAuth exchange payload was invalid.' }, 400);

    const origin = request.headers.get('Origin');
    let normalizedOrigin = '';
    try { normalizedOrigin = origin ? new URL(origin).origin : ''; } catch { normalizedOrigin = ''; }
    if (!normalizedOrigin || parsed.data.redirectUri !== normalizedOrigin) {
      return json({ code: 'redirect_uri', message: 'Google OAuth redirect URI must match the calling origin.' }, 400);
    }

    const result = await exchangeGoogleAuthorizationCode(this.oauthEnv, parsed.data);
    const existing = this.credentialRow();
    const refreshToken = result.refreshToken
      ?? (existing ? await decryptRefreshToken(this.vaultSecret(), existing.refresh_cipher, existing.refresh_iv) : undefined);
    if (!refreshToken) {
      return json({ code: 'reauthorization_required', message: 'Google did not issue a refresh token. Revoke the existing grant and authorize again.' }, 409);
    }

    const encrypted = result.refreshToken
      ? await encryptRefreshToken(this.vaultSecret(), result.refreshToken)
      : { cipher: existing!.refresh_cipher, iv: existing!.refresh_iv };
    const account: GoogleOAuthAccount | null = await fetchGoogleOAuthAccount(result.accessToken).catch(() => null);
    const scopes = result.scopes.length ? result.scopes : existing ? parseScopes(existing.scopes) : [];
    const now = Date.now();
    const refreshExpiresAt = result.refreshTokenExpiresIn
      ? now + result.refreshTokenExpiresIn * 1000
      : existing?.refresh_expires_at ?? null;

    this.ctx.storage.sql.exec(`
      INSERT INTO google_oauth_credential (
        slot, refresh_cipher, refresh_iv, scopes, email, display_name, updated_at, refresh_expires_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET
        refresh_cipher = excluded.refresh_cipher,
        refresh_iv = excluded.refresh_iv,
        scopes = excluded.scopes,
        email = excluded.email,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at,
        refresh_expires_at = excluded.refresh_expires_at
    `,
    encrypted.cipher,
    encrypted.iv,
    JSON.stringify(scopes),
    account?.email ?? existing?.email ?? null,
    account?.displayName ?? existing?.display_name ?? null,
    now,
    refreshExpiresAt);

    return json({
      connected: true,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      scopes,
      account: account ?? (existing?.email ? { email: existing.email, ...(existing.display_name ? { displayName: existing.display_name } : {}) } : undefined),
      ...(refreshExpiresAt ? { refreshTokenExpiresAt: refreshExpiresAt } : {}),
    });
  }

  private async refresh(body: string): Promise<Response> {
    if (!emptySchema.safeParse(parseJson(body)).success) {
      return json({ code: 'validation', message: 'Google OAuth refresh payload was invalid.' }, 400);
    }
    const existing = this.credentialRow();
    if (!existing) return json({ code: 'not_connected', message: 'Google OAuth is not connected.' }, 409);

    const refreshToken = await decryptRefreshToken(this.vaultSecret(), existing.refresh_cipher, existing.refresh_iv);
    const result = await refreshGoogleAccessToken(this.oauthEnv, refreshToken);
    const scopes = result.scopes.length ? result.scopes : parseScopes(existing.scopes);
    const now = Date.now();
    const refreshExpiresAt = result.refreshTokenExpiresIn
      ? now + result.refreshTokenExpiresIn * 1000
      : existing.refresh_expires_at;
    this.ctx.storage.sql.exec(
      'UPDATE google_oauth_credential SET scopes = ?, updated_at = ?, refresh_expires_at = ? WHERE slot = 1',
      JSON.stringify(scopes),
      now,
      refreshExpiresAt,
    );
    return json({
      connected: true,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      scopes,
      account: existing.email ? { email: existing.email, ...(existing.display_name ? { displayName: existing.display_name } : {}) } : undefined,
      ...(refreshExpiresAt ? { refreshTokenExpiresAt: refreshExpiresAt } : {}),
    });
  }

  private async disconnect(body: string): Promise<Response> {
    if (!emptySchema.safeParse(parseJson(body)).success) {
      return json({ code: 'validation', message: 'Google OAuth disconnect payload was invalid.' }, 400);
    }
    const existing = this.credentialRow();
    let providerRevoked = true;
    if (existing) {
      try {
        const refreshToken = await decryptRefreshToken(this.vaultSecret(), existing.refresh_cipher, existing.refresh_iv);
        providerRevoked = await revokeGoogleOAuthToken(refreshToken);
      } catch {
        providerRevoked = false;
      }
    }
    this.ctx.storage.sql.exec('DELETE FROM google_oauth_credential WHERE slot = 1');
    return json({ disconnected: true, providerRevoked });
  }
}
