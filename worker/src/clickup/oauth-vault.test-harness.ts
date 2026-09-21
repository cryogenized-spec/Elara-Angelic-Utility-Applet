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
}
