import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const vaultSource = read('worker/src/google/oauth-vault.ts');
const authoritySource = read('src/google/oauth/authority.ts');
const browserTests = read('src/google/oauth/authority.test.ts');
const vaultTests = read('worker/test/google-oauth-vault.test.ts');

function validateLifecycleContracts(vault, authority, browserTestSource, vaultTestSource) {
  const errors = [];
  const requireMatch = (source, pattern, message) => {
    if (!pattern.test(source)) errors.push(message);
  };
  const requireText = (source, marker, message) => {
    if (!source.includes(marker)) errors.push(message);
  };

  // Refresh-token reuse is identity-sensitive. Email is profile data; the
  // durable credential is bound to Google's stable OIDC subject instead.
  requireMatch(vault, /subject:\s*string\s*\|\s*null;/, 'Google OAuth vault credential row lost stable provider subject identity');
  requireMatch(vault, /subject\s+TEXT/, 'Google OAuth vault schema lost stable provider subject storage');
  requireMatch(
    vault,
    /!result\.refreshToken\s*&&\s*existing\s*&&\s*\(\s*!account\s*\|\|\s*!existing\.subject\s*\|\|\s*account\.subject\s*!==\s*existing\.subject\s*\)/,
    'Google OAuth refresh-token reuse no longer requires stable provider subject continuity',
  );
  requireText(vault, 'account identity could not be safely matched', 'Google OAuth account-switch mismatch no longer fails closed');

  // updated_at is a grant revision, not an access-token-refresh timestamp.
  // Browser sessions bind to it and must be invalidated before Google API use
  // whenever another device changes the authoritative durable grant.
  requireMatch(vault, /const revision = sameScopeSet\(scopes, existingScopes\) \? existing\.updated_at : now;/, 'Google OAuth vault revision no longer stays stable across token-only refresh');
  requireMatch(authority, /vaultUpdatedAt\?:\s*number;/, 'Google OAuth browser session lost its durable grant revision binding');
  requireMatch(
    authority,
    /session\.vaultUpdatedAt\s*!==\s*remoteRevision[\s\S]{0,220}?session\s*=\s*null;/,
    'Google OAuth browser session no longer invalidates on authoritative vault revision change',
  );
  const revisionBindings = authority.match(/vaultUpdatedAt:\s*durableRevision\(response\.updatedAt\)/g) ?? [];
  if (revisionBindings.length < 2) errors.push('Google OAuth exchange/refresh paths must both bind the browser session to the durable grant revision');

  // Keep the behavioral proof itself durable. These exact adversarial cases
  // must remain present in the focused CI suite.
  requireText(
    vaultTestSource,
    "reuses an existing encrypted refresh token only when the stable Google subject matches",
    'Google OAuth lifecycle suite lost the same-account refresh-token reuse proof',
  );
  requireText(
    vaultTestSource,
    "rejects refresh-token reuse across Google accounts and deletes the unsafe local credential",
    'Google OAuth lifecycle suite lost the cross-account refresh-token rejection proof',
  );
  requireText(
    browserTestSource,
    "invalidates an unexpired paired browser token when the authoritative vault revision changes",
    'Google OAuth lifecycle suite lost the browser grant-revision invalidation proof',
  );
  requireText(browserTestSource, "not.toContain('Bearer access-account-a')", 'Google OAuth lifecycle suite no longer proves the stale account token stays off Google API egress');

  return errors;
}

const failures = validateLifecycleContracts(vaultSource, authoritySource, browserTests, vaultTests);

function mutationMustFail(label, mutateVault, mutateAuthority) {
  const mutatedVault = mutateVault ? mutateVault(vaultSource) : vaultSource;
  const mutatedAuthority = mutateAuthority ? mutateAuthority(authoritySource) : authoritySource;
  if (mutatedVault === vaultSource && mutatedAuthority === authoritySource) {
    failures.push(`${label}: mutation fixture did not change the reviewed source`);
    return;
  }
  const rejected = validateLifecycleContracts(mutatedVault, mutatedAuthority, browserTests, vaultTests);
  if (!rejected.length) failures.push(`${label}: deliberate OAuth lifecycle mutation escaped certification`);
}

mutationMustFail(
  'stable-subject continuity removal',
  (source) => source.replace('account.subject !== existing.subject', 'account.subject === existing.subject'),
  null,
);
mutationMustFail(
  'grant-revision invalidation removal',
  null,
  (source) => source.replace('session.vaultUpdatedAt !== remoteRevision', 'session.vaultUpdatedAt === remoteRevision'),
);
mutationMustFail(
  'grant-revision churn on token refresh',
  (source) => source.replace('const revision = sameScopeSet(scopes, existingScopes) ? existing.updated_at : now;', 'const revision = now;'),
  null,
);

if (failures.length) {
  process.stderr.write(`Google OAuth lifecycle certification failed (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Google OAuth lifecycle certification passed: stable-subject refresh-token continuity, durable grant-revision binding, focused behavioral proofs, and 3 hostile lifecycle mutations verified.\n');
