import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const providerSource = read('worker/src/google/oauth-provider.ts');
const vaultSource = read('worker/src/google/oauth-vault.ts');
const authoritySource = read('src/google/oauth/authority.ts');
const browserTests = read('src/google/oauth/authority.test.ts');
const vaultTests = read('worker/test/google-oauth-vault.test.ts');
const errors = [];

const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) errors.push(message);
};
const requireText = (source, marker, message) => {
  if (!source.includes(marker)) errors.push(message);
};

// Refresh-token reuse is identity-sensitive. Email is profile data; the
// durable credential is bound to Google's stable OIDC subject instead.
requireMatch(vaultSource, /subject:\s*string\s*\|\s*null;/, 'Google OAuth vault credential row lost stable provider subject identity');
requireMatch(vaultSource, /subject\s+TEXT/, 'Google OAuth vault schema lost stable provider subject storage');
requireMatch(
  vaultSource,
  /!result\.refreshToken\s*&&\s*existing\s*&&\s*\(\s*!account\s*\|\|\s*!existing\.subject\s*\|\|\s*account\.subject\s*!==\s*existing\.subject\s*\)/,
  'Google OAuth refresh-token reuse no longer requires stable provider subject continuity',
);
requireText(vaultSource, 'account identity could not be safely matched', 'Google OAuth account-switch mismatch no longer fails closed');

// Provider refresh rejection is lifecycle information, not a generic 502.
requireText(providerSource, 'export class GoogleOAuthProviderError', 'Google OAuth provider lost its typed provider-error contract');
requireMatch(providerSource, /payload\?\.error\s*===?/, 'Google OAuth provider no longer reads the provider error code');
requireMatch(
  vaultSource,
  /error instanceof GoogleOAuthProviderError\s*&&\s*error\.code\s*===\s*['"]invalid_grant['"]/,
  'Google OAuth vault no longer recognizes provider invalid_grant as reauthorization state',
);
requireMatch(
  vaultSource,
  /error\.code\s*===\s*['"]invalid_grant['"][\s\S]{0,260}?DELETE FROM google_oauth_credential WHERE slot = 1[\s\S]{0,260}?reauthorization_required/,
  'Google OAuth revoked refresh grant no longer deletes the unusable durable credential and requests reauthorization',
);

// Grant revisions are monotonic across replacements and stable across a
// token-only refresh when the provider scope set has not changed.
requireMatch(vaultSource, /function nextGrantRevision\([\s\S]{0,180}?Math\.max\(now, \(previous \?\? 0\) \+ 1\)/, 'Google OAuth vault lost monotonic grant revision generation');
requireText(vaultSource, 'const revision = nextGrantRevision(existing?.updated_at, now);', 'Google OAuth exchange no longer advances the authoritative grant revision monotonically');
requireText(vaultSource, 'const revision = sameScopeSet(scopes, existingScopes) ? existing.updated_at : nextGrantRevision(existing.updated_at, now);', 'Google OAuth refresh no longer preserves revision stability for unchanged grants');
requireMatch(authoritySource, /vaultUpdatedAt\?:\s*number;/, 'Google OAuth browser session lost its durable grant revision binding');
requireMatch(
  authoritySource,
  /session\.vaultUpdatedAt\s*!==\s*remoteRevision[\s\S]{0,220}?session\s*=\s*null;/,
  'Google OAuth browser session no longer invalidates on authoritative vault revision change',
);
const revisionBindings = authoritySource.match(/vaultUpdatedAt:\s*durableRevision\(response\.updatedAt\)/g) ?? [];
if (revisionBindings.length < 2) errors.push('Google OAuth exchange/refresh paths must both bind the browser session to the durable grant revision');

// Provider scope is only one half of effective authority. A paired provider
// grant must never insert an Elara capability into the local enabled set.
const ensureTokenBody = authoritySource.match(/async function ensureToken\([\s\S]*?(?=\nasync function authorizedFetch)/)?.[0] ?? '';
if (!ensureTokenBody) errors.push('Google OAuth ensureToken lifecycle owner moved or disappeared');
else if (ensureTokenBody.includes('stored.enabledCapabilities')) errors.push('Google OAuth ensureToken can mutate local enabled capabilities from provider state');

// Pin the independent behavioral proofs consumed by focused CI and the true
// mutation verifier. Source markers here are secondary tripwires; runtime tests
// remain the authority for behavior.
for (const [source, marker, message] of [
  [vaultTests, 'reuses an existing encrypted refresh token only when the stable Google subject matches', 'Google OAuth lifecycle suite lost same-account refresh-token reuse proof'],
  [vaultTests, 'rejects refresh-token reuse across Google accounts and deletes the unsafe local credential', 'Google OAuth lifecycle suite lost cross-account refresh-token rejection proof'],
  [vaultTests, 'turns provider invalid_grant into explicit reauthorization and deletes the revoked durable grant', 'Google OAuth lifecycle suite lost revoked-refresh-grant recovery proof'],
  [vaultTests, 'advances a replacement grant revision even when the stored revision is ahead of wall clock', 'Google OAuth lifecycle suite lost monotonic revision proof'],
  [browserTests, 'does not let paired provider scopes silently enable a local write capability', 'Google OAuth lifecycle suite lost local-capability authority proof'],
  [browserTests, 'invalidates an unexpired paired browser token when the authoritative vault revision changes', 'Google OAuth lifecycle suite lost browser grant-revision invalidation proof'],
  [browserTests, "not.toContain('Bearer access-account-a')", 'Google OAuth lifecycle suite no longer proves stale account tokens stay off Google API egress'],
]) requireText(source, marker, message);

if (errors.length) {
  process.stderr.write(`Google OAuth lifecycle structural certification failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Google OAuth lifecycle structural certification passed: stable subject, revoked-grant recovery, monotonic/stable grant revisions, local capability authority, browser revision binding, and focused behavioral proof inventory verified.\n');
