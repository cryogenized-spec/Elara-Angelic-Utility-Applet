const workerUrl = (process.env.GEMINI_WORKER_URL || '').trim().replace(/\/$/, '');
const expectedOrigin = (process.env.GEMINI_ALLOWED_ORIGIN || 'https://cryogenized-spec.github.io').trim();

if (!/^https:\/\//.test(workerUrl)) {
  throw new Error('GEMINI_WORKER_URL must be an HTTPS URL.');
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Worker returned non-JSON content (HTTP ${response.status}).`);
  }
}

console.log(`Verifying Gemini Worker: ${workerUrl}`);

const healthResponse = await fetch(`${workerUrl}/health`, {
  headers: {
    Accept: 'application/json',
    Origin: expectedOrigin,
  },
});

if (!healthResponse.ok) {
  throw new Error(`Worker health endpoint returned HTTP ${healthResponse.status}.`);
}

const health = await readJson(healthResponse);
if (health?.api !== true || health?.status !== 'healthy') {
  throw new Error(`Worker health is not healthy: ${JSON.stringify({ api: health?.api ?? null, status: health?.status ?? null })}`);
}

const allowOrigin = healthResponse.headers.get('access-control-allow-origin');
if (allowOrigin !== expectedOrigin) {
  throw new Error(`Worker CORS origin mismatch: expected ${expectedOrigin}, received ${allowOrigin ?? 'missing'}.`);
}

const preflightResponse = await fetch(workerUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: expectedOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
});

if (!preflightResponse.ok) {
  throw new Error(`Worker CORS preflight returned HTTP ${preflightResponse.status}.`);
}

const preflightOrigin = preflightResponse.headers.get('access-control-allow-origin');
const preflightMethods = preflightResponse.headers.get('access-control-allow-methods') || '';
if (preflightOrigin !== expectedOrigin) {
  throw new Error(`Preflight CORS origin mismatch: expected ${expectedOrigin}, received ${preflightOrigin ?? 'missing'}.`);
}
if (!preflightMethods.split(',').map((value) => value.trim()).includes('POST')) {
  throw new Error(`Preflight CORS methods do not permit POST: ${preflightMethods || 'missing'}.`);
}

console.log('Gemini Worker health, production CORS, and POST preflight checks passed.');
