const workerUrl = (process.env.GEMINI_WORKER_URL || 'https://elara-gemini.cryogenized.workers.dev').replace(/\/$/, '');
const origin = process.env.PAGES_ORIGIN || 'https://cryogenized-spec.github.io';
const installationToken = process.env.ELARA_INSTALLATION_TOKEN || '';

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Worker request failed: ${detail}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!installationToken) throw new Error('ELARA_INSTALLATION_TOKEN is required to verify protected Worker provider routes.');
  const health = await request(`${workerUrl}/health`, { headers: { Origin: origin } });
  const healthBody = await health.text();
  if (health.status !== 200) throw new Error(`Worker health HTTP ${health.status}: ${healthBody}`);
  if (health.headers.get('access-control-allow-origin') !== origin) throw new Error(`Worker health CORS mismatch: ${health.headers.get('access-control-allow-origin') ?? '(missing)'}`);
  if (!healthBody.includes('"api":true') || !healthBody.includes('"status":"healthy"')) throw new Error(`Worker health payload is not healthy: ${healthBody}`);

  const options = await request(`${workerUrl}/api/gemini`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' },
  });
  if (options.status !== 204) throw new Error(`Worker preflight HTTP ${options.status}.`);
  if (options.headers.get('access-control-allow-origin') !== origin) throw new Error('Worker preflight CORS origin mismatch.');
  const methods = options.headers.get('access-control-allow-methods') || '';
  if (!methods.toUpperCase().includes('POST')) throw new Error(`Worker preflight does not allow POST: ${methods || '(missing)'}`);
  const headers = options.headers.get('access-control-allow-headers') || '';
  if (!headers.toLowerCase().includes('content-type')) throw new Error(`Worker preflight does not allow Content-Type: ${headers || '(missing)'}`);
  if (!headers.toLowerCase().includes('authorization')) throw new Error(`Worker preflight does not allow Authorization: ${headers || '(missing)'}`);

  const unauthenticated = await request(`${workerUrl}/api/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.8-flash', input: 'admission probe', systemInstruction: 'verification' }),
  });
  if (unauthenticated.status !== 401) throw new Error(`Originless unauthenticated provider request did not fail closed: HTTP ${unauthenticated.status}.`);

  process.stdout.write('Live Worker health and browser transport verification passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
