const workerUrl = (process.env.AUTONOMY_WORKER_URL || '').replace(/\/+$/, '');
const token = process.env.ELARA_INSTALLATION_TOKEN || '';
const origin = process.env.PAGES_ORIGIN || 'https://cryogenized-spec.github.io';

// ---------------------------------------------------------------------------
// Live autonomy-worker smoke verification (design §15): proves a DEPLOYED
// worker's autonomy surface is healthy — health, authenticated pairing,
// scheduler observability, and a full Autonomy Context replace/clear
// round-trip with HMAC-signed writes — without triggering any autonomous
// external action and without any Google credential.
//
// Safety: the context round-trip wipes and replaces a disposable mirror (the
// app re-syncs the real pack on next open); the final step clears it again.
// The configuration probe sends generation 0 with NO routines — because the
// app ADVANCES its local generation at pairing, generation 0 can only ever be
// accepted by a deployment that has NEVER been synced by the app (harmless
// empty state); any app-synced deployment rejects it as stale, which is
// itself the generation guard proving itself.
//
// Usage:
//   AUTONOMY_WORKER_URL=https://… ELARA_INSTALLATION_TOKEN=… node scripts/verify-autonomy-worker.mjs
// ---------------------------------------------------------------------------

if (!workerUrl || !token) {
  process.stderr.write('AUTONOMY_WORKER_URL and ELARA_INSTALLATION_TOKEN are required.\n');
  process.exit(1);
}

const encoder = new TextEncoder();

async function hmacSha256(key, message) {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${workerUrl}${path}`, { ...init, signal: controller.signal, headers: { Origin: origin, ...(init.headers ?? {}) } });
  } catch (error) {
    throw new Error(`Worker request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function signedPost(path, body) {
  const timestamp = Date.now();
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const signature = await hmacSha256(token, `POST\n${path}\n${timestamp}\n${body}`);
  return request(path, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Elara-Timestamp': String(timestamp),
      'X-Elara-Nonce': nonce,
      'X-Elara-Signature': signature,
    },
  });
}

async function hashAutonomyContextRecords(records) {
  const canonical = JSON.stringify(records.map((record) => ({
    id: record.id, kind: record.kind, title: record.title, body: record.body, tags: record.tags,
    importance: record.importance, confidence: record.confidence, observedAt: record.observedAt, updatedAt: record.updatedAt,
  })));
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function main() {
  // 1. Public health: the autonomy surface is present and configured.
  const health = await request('/autonomy/health');
  const healthBody = await health.text();
  if (health.status !== 200) throw new Error(`Autonomy health HTTP ${health.status}: ${healthBody}`);
  const healthJson = JSON.parse(healthBody);
  if (healthJson.autonomy?.configured !== true) throw new Error(`Autonomy is not configured on the worker: ${healthBody}`);
  if (healthJson.autonomy.agentExecution !== true) throw new Error(`Expected live cloud execution (Phase C1): ${healthBody}`);
  process.stdout.write(`✓ health — worker v${healthJson.autonomy.version}, cron "${healthJson.autonomy.cron}", capabilities: ${healthJson.autonomy.capabilities.join(', ')}\n`);

  // 2. Authenticated pairing: token possession + capability manifest.
  const pair = await request('/autonomy/pair', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (pair.status !== 200) throw new Error(`Pairing HTTP ${pair.status}: ${await pair.text()}`);
  const pairBody = await pair.json();
  if (pairBody.installationId?.length !== 32) throw new Error(`Pairing returned no installation identity: ${JSON.stringify(pairBody)}`);
  process.stdout.write(`✓ pairing — installation ${pairBody.installationId.slice(0, 8)}…, schema v${pairBody.schemaVersion}\n`);

  // 3. Bad bearer must fail closed (auth boundary sanity).
  const badPair = await request('/autonomy/pair', { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } });
  if (badPair.status !== 401) throw new Error(`A wrong token was not rejected (HTTP ${badPair.status}).`);
  process.stdout.write('✓ auth — wrong token rejected\n');

  // 4. No public wake endpoint exists.
  const wake = await request('/autonomy/wake', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
  if (wake.status !== 404) throw new Error(`Public wake endpoint unexpectedly responded (HTTP ${wake.status}).`);
  process.stdout.write('✓ no public wake endpoint\n');

  // 5. Autonomy Context round-trip: clear → replace (1 marker record) →
  //    verify metadata → clear → verify empty. Disposable-mirror-safe.
  const markerRecord = {
    id: 'smoke-marker', kind: 'CONTEXTUAL', title: 'Smoke verification marker', body: 'A disposable marker record from verify-autonomy-worker.',
    tags: [], importance: 0.1, confidence: 0.1, observedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  };
  await signedPost('/autonomy/context', JSON.stringify({ clear: true }));
  const replace = await signedPost('/autonomy/context', JSON.stringify({
    contentHash: await hashAutonomyContextRecords([markerRecord]),
    records: [markerRecord],
  }));
  if (replace.status !== 200) throw new Error(`Context replace HTTP ${replace.status}: ${await replace.text()}`);
  process.stdout.write('✓ context — signed replace accepted\n');

  const metadata = await request('/autonomy/context', { headers: { Authorization: `Bearer ${token}` } });
  const metadataBody = await metadata.json();
  if (metadataBody.context?.recordCount !== 1) throw new Error(`Context metadata did not reflect the marker: ${JSON.stringify(metadataBody)}`);
  if (JSON.stringify(metadataBody).includes('disposable marker record')) throw new Error('Context CONTENT was echoed back — metadata only is allowed.');
  process.stdout.write('✓ context — metadata visible, content never echoed\n');

  await signedPost('/autonomy/context', JSON.stringify({ clear: true }));
  const cleared = await request('/autonomy/context', { headers: { Authorization: `Bearer ${token}` } });
  const clearedBody = await cleared.json();
  if (clearedBody.context !== null) throw new Error(`Context clear left a pack behind: ${JSON.stringify(clearedBody)}`);
  process.stdout.write('✓ context — cleared\n');

  // 6. Configuration generation guard: generation 0 with no routines is only
  //    acceptable on a never-configured deployment; a configured one must
  //    reject it as stale. Both outcomes are healthy.
  const probe = await signedPost('/autonomy/config', JSON.stringify({ generation: 0, enabled: false, maxEventsPerDay: 10, routines: [] }));
  const probeBody = await probe.json();
  if (probe.status === 200 && probeBody.accepted === true) {
    process.stdout.write('✓ config — fresh deployment accepted an initial (empty) configuration\n');
  } else if (probe.status === 409 && probeBody.code === 'stale-config') {
    process.stdout.write(`✓ config — stale generation correctly rejected (worker holds generation ${probeBody.generation})\n`);
  } else {
    throw new Error(`Unexpected configuration probe result (HTTP ${probe.status}): ${JSON.stringify(probeBody)}`);
  }

  // 7. Scheduler observability: state and recent scheduler decisions.
  const state = await request('/autonomy/state', { headers: { Authorization: `Bearer ${token}` } });
  if (state.status !== 200) throw new Error(`Scheduler state HTTP ${state.status}: ${await state.text()}`);
  const stateBody = await state.json();
  process.stdout.write(`✓ scheduler — generation ${stateBody.generation}, ${stateBody.routines.length} mirrored routine(s), ${stateBody.journal.length} recent decision(s), dry-run ${stateBody.dryRun}\n`);

  process.stdout.write('Live autonomy worker verification passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
