import { useState } from 'react';
import './worker-health.css';

const WORKER_URL = ((import.meta.env.VITE_GEMINI_WORKER_URL as string | undefined)?.trim() || 'https://elara-gemini.cryogenized.workers.dev').replace(/\/$/, '');

type HealthState = 'unknown' | 'checking' | 'healthy' | 'degraded' | 'offline';

const labels: Record<HealthState, string> = {
  unknown: 'Not checked',
  checking: 'Checking…',
  healthy: 'Healthy',
  degraded: 'Alert',
  offline: 'Failure / offline',
};

export function WorkerHealthPanel() {
  const [state, setState] = useState<HealthState>('unknown');
  const [detail, setDetail] = useState('Run a protected health check to verify the Worker is serving the API boundary.');

  async function checkWorker() {
    setState('checking');
    setDetail('Contacting the Cloudflare Worker…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${WORKER_URL}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
      const workerStatus = record.status;
      const api = record.api;

      if (response.ok && api === true && workerStatus === 'healthy') {
        setState('healthy');
        setDetail('Worker reachable. API boundary and protected configuration report healthy.');
      } else if (response.ok && api === true && workerStatus === 'degraded') {
        setState('degraded');
        setDetail('Worker reachable, but one or more protected configuration checks need attention.');
      } else {
        setState('offline');
        setDetail(`Worker responded unexpectedly (HTTP ${response.status}).`);
      }
    } catch (error) {
      setState('offline');
      setDetail(error instanceof DOMException && error.name === 'AbortError'
        ? 'The health check timed out after 8 seconds.'
        : 'The Worker could not be reached from this browser.');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <div className="worker-health" data-state={state}>
      <div className="worker-health__header">
        <div>
          <span className="panel-kicker">LOCKBOX</span>
          <h2>Cloudflare Gemini Worker</h2>
          <p>Protected execution boundary. The Gemini credential remains server-side.</p>
        </div>
        <span className="worker-health__status" role="status" aria-label={`Worker status: ${labels[state]}`}>
          <span className="worker-health__dot" aria-hidden="true" />
          {labels[state]}
        </span>
      </div>
      <div className="worker-health__endpoint" title={WORKER_URL}>{WORKER_URL}</div>
      <div className="worker-health__actions">
        <button className="model-settings__button worker-health__button" type="button" onClick={() => void checkWorker()} disabled={state === 'checking'}>
          {state === 'checking' ? 'Testing…' : 'Test Worker'}
        </button>
      </div>
      <p className="worker-health__detail" aria-live="polite">{detail}</p>
    </div>
  );
}
