const workerUrl = (process.env.GEMINI_WORKER_URL || 'https://elara-gemini.cryogenized.workers.dev').replace(/\/$/, '');
const origin = process.env.PAGES_ORIGIN || 'https://cryogenized-spec.github.io';

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Worker request failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const health = await request(`${workerUrl}/health`, { headers: { Origin: origin } });
  const healthBody = await health.text();
  if (health.status !== 200) throw new Error(`Worker health HTTP ${health.status}: ${healthBody}`);
  if (health.headers.get('access-control-allow-origin') !== origin) throw new Error(`Worker health CORS mismatch: ${health.headers.get('access-control-allow-origin') ?? '(missing)'}`);
  if (!healthBody.includes('"api":true') || !healthBody.includes('"status":"healthy"')) throw new Error(`Worker health payload is not healthy: ${healthBody}`);

  const options = await request(`${workerUrl}/api/gemini`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  if (options.status !== 204) throw new Error(`Worker preflight HTTP ${options.status}.`);
  if (options.headers.get('access-control-allow-origin') !== origin) throw new Error('Worker preflight CORS origin mismatch.');
  const methods = options.headers.get('access-control-allow-methods') || '';
  if (!methods.toUpperCase().includes('POST')) throw new Error(`Worker preflight does not allow POST: ${methods || '(missing)'}`);
  const headers = options.headers.get('access-control-allow-headers') || '';
  if (!headers.toLowerCase().includes('content-type')) throw new Error(`Worker preflight does not allow Content-Type: ${headers || '(missing)'}`);

  const behavior = await request(`${workerUrl}/api/gemini`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash',
      input: 'Reply with a single short sentence confirming that the supplied master instruction was received.',
      systemInstruction: 'You are performing a transport verification. Follow this supplied instruction and keep the response to one short sentence.',
      generationConfig: { maxOutputTokens: 24 },
    }),
  });
  if (!behavior.ok) throw new Error(`Worker supplied-instruction test HTTP ${behavior.status}: ${await behavior.text()}`);
  const body = await behavior.text();
  if (!body.includes('data:')) throw new Error(`Worker supplied-instruction test returned no streaming events: ${body}`);
  if (body.includes('"error"')) throw new Error(`Worker supplied-instruction test returned an error event: ${body}`);

  console.log('Live Worker browser transport verification passed.');
  console.log('Live Worker supplied-master-instruction request verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
