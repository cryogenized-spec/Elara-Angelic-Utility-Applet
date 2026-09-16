import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const vitestBin = join(root, 'node_modules/vitest/vitest.mjs');
const authorityPath = join(root, 'src/google/oauth/authority.ts');
const vaultPath = join(root, 'worker/src/google/oauth-vault.ts');
const originals = new Map([
  [authorityPath, readFileSync(authorityPath, 'utf8')],
  [vaultPath, readFileSync(vaultPath, 'utf8')],
]);

const failures = [];

const suites = {
  authority: ['run', 'src/google/oauth/authority.test.ts'],
  vault: ['run', '--config', 'vitest.workers.config.ts', 'worker/test/google-oauth-vault.test.ts'],
};

function restoreAll() {
  for (const [path, source] of originals) writeFileSync(path, source, 'utf8');
}

function mutateExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`${label}: mutation anchor disappeared`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`${label}: mutation anchor is no longer unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function runMutant({ label, path, before, after, suite, expectedFailure }) {
  restoreAll();
  const original = originals.get(path);
  if (!original) {
    failures.push(`${label}: unknown mutation target`);
    return;
  }
  let mutated;
  try {
    mutated = mutateExactly(original, before, after, label);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return;
  }
  writeFileSync(path, mutated, 'utf8');
  const result = spawnSync(process.execPath, [vitestBin, ...suites[suite]], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) {
    failures.push(`${label}: behavioral suite could not execute: ${result.error.message}`);
    return;
  }
  if (result.status === 0) {
    failures.push(`${label}: hostile mutation survived the behavioral suite`);
    return;
  }
  if (!output.includes(expectedFailure)) {
    failures.push(`${label}: suite failed, but not at the pinned regression proof (${expectedFailure})`);
  }
}

try {
  runMutant({
    label: 'stable-subject continuity removal',
    path: vaultPath,
    before: 'account.subject !== existing.subject',
    after: 'account.subject === existing.subject',
    suite: 'vault',
    expectedFailure: 'rejects refresh-token reuse across Google accounts and deletes the unsafe local credential',
  });

  runMutant({
    label: 'revoked-grant recovery removal',
    path: vaultPath,
    before: "error.code === 'invalid_grant'",
    after: "error.code === 'never_invalid_grant'",
    suite: 'vault',
    expectedFailure: 'turns provider invalid_grant into explicit reauthorization and deletes the revoked durable grant',
  });

  runMutant({
    label: 'grant-revision invalidation removal',
    path: authorityPath,
    before: 'session.vaultUpdatedAt !== remoteRevision',
    after: 'session.vaultUpdatedAt === remoteRevision',
    suite: 'authority',
    expectedFailure: 'invalidates an unexpired paired browser token when the authoritative vault revision changes',
  });

  runMutant({
    label: 'grant-revision stability removal',
    path: vaultPath,
    before: 'const revision = sameScopeSet(scopes, existingScopes) ? existing.updated_at : nextGrantRevision(existing.updated_at, now);',
    after: 'const revision = nextGrantRevision(existing.updated_at, now);',
    suite: 'vault',
    expectedFailure: 'exchanges a code, stores only encrypted refresh material, and refreshes without browser interaction',
  });

  runMutant({
    label: 'monotonic grant revision removal',
    path: vaultPath,
    before: 'const revision = nextGrantRevision(existing?.updated_at, now);',
    after: 'const revision = now;',
    suite: 'vault',
    expectedFailure: 'advances a replacement grant revision even when the stored revision is ahead of wall clock',
  });

  runMutant({
    label: 'provider-scope local capability escalation',
    path: authorityPath,
    before: 'const status = currentStatus();\n    const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities);',
    after: "let status = currentStatus();\n    if (!status.enabledCapabilities.includes(capability)) {\n      stored.enabledCapabilities = uniqueCapabilities([...stored.enabledCapabilities, capability]);\n      stored.needsReauthorization = false;\n      saveStored();\n      status = currentStatus();\n    }\n    const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities);",
    suite: 'authority',
    expectedFailure: 'does not let paired provider scopes silently enable a local write capability',
  });
} finally {
  restoreAll();
}

if (failures.length) {
  process.stderr.write(`Google OAuth behavioral mutation certification failed (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Google OAuth behavioral mutation certification passed: 6 hostile source mutations were executed and each was killed by its pinned runtime regression test.\n');
