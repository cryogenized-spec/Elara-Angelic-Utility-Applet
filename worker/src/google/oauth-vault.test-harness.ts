import { GoogleOAuthVault } from './oauth-vault';

export class TestGoogleOAuthVault extends GoogleOAuthVault {
  credentialSnapshot(): {
    refreshCipher: string;
    refreshIv: string;
    scopes: string;
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
      email: row.email,
      displayName: row.display_name,
      updatedAt: row.updated_at,
      refreshExpiresAt: row.refresh_expires_at,
    };
  }
}
