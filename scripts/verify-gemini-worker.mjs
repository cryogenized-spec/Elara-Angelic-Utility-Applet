const workerUrl = (process.env.GEMINI_WORKER_URL || 'https://elara-gemini.cryogenized.workers.dev').replace(/\/$/, '');
const origin = process.env.PAGES_ORIGIN || 'https://cryogenized-spec.github.io';

async function request(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const health = await request(`${workerUrl}/health`, {
    headers: { Origin: origin },
  });
  if (!health.ok) {
    throw new Error(`Worker health check failed with HTTP ${health.status}.`);
  }
  const healthBody = await health.text();
  if (!healthBody.includes('"api":true') || !healthBody.includes('"status":"healthy"')) {
    throw new Error(`Worker health response is not healthy: ${healthBody}`);
  }
  const healthAllowOrigin = health.headers.get('access-control-allow-origin');
  if (healthAllowOrigin !== origin) {
    throw new Error(`Worker health CORS origin mismatch: ${healthAllowOrigin ?? '(missing)'}`);
  }

  const options = await request(`${workerUrl}/api/gemini`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (options.status !== 204) {
    throw new Error(`Worker preflight failed with HTTP ${options.status}.`);
  }
  if (options.headers.get('access-control-allow-origin') !== origin) {
    throw new Error('Worker preflight CORS origin mismatch.');
  }
  if (!(options.headers.get('access-control-allow-methods') || '').toUpperCase().includes('POST')) {
    throw new Error('Worker preflight does not allow POST.');
  }
  if (!(options.headers.get('access-control-allow-headers') || '').toLowerCase().includes('content-type')) {
    throw new Error('Worker preflight does not allow Content-Type.');
  }

  console.log('Live Worker browser transport verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
