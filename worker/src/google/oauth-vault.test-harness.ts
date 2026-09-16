import { GoogleOAuthVault } from './oauth-vault';

export class TestGoogleOAuthVault extends GoogleOAuthVault {
  credentialSnapshot(): {
    refreshCipher: string;
    refreshIv: string;
    scopes: string;
    subject: string | null;
    email: string | null;
    displayName: string | null;
    updatedAt: number;
    refreshExpiresAt: number | null;
  } | null {
    const row = this.credentialRow();
    if (!row) return null;
    return {
      refreshCipher: row.refresh_cipher,
      refreshIv: row.refresh_iv,
      scopes: row.scopes,
      subject: row.subject,
      email: row.email,
      displayName: row.display_name,
      updatedAt: row.updated_at,
      refreshExpiresAt: row.refresh_expires_at,
    };
  }

  /** Test-only adversarial hook for proving grant revisions stay monotonic. */
  forceCredentialUpdatedAt(updatedAt: number): void {
    this.ctx.storage.sql.exec('UPDATE google_oauth_credential SET updated_at = ? WHERE slot = 1', updatedAt);
  }
}
