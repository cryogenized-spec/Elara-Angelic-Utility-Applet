import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTONOMY_CONTEXT_MAX_BYTES, AUTONOMY_CONTEXT_MAX_RECORDS, isAutonomyContextEligible, type AutonomyContextProjection, type AutonomyContextSource } from '../../autonomy/context';
import { describeSchedule } from '../../autonomy/schedule';
import { listMemories, updateMemory } from '../../memory/store';
import { bumpConfigGeneration, clearPairing, loadPairing, savePairing, type AutonomyPairing } from '../../autonomy/cloud/pairing';
import { AutonomyCloudError, pairWithWorker } from '../../autonomy/cloud/client';
import { clearWorkerContext, fullSync, inspectContextProjection, syncConfiguration, type SyncStatus } from '../../autonomy/cloud/sync';
import { fetchSchedulerState, type CloudSchedulerState } from '../../autonomy/cloud/client';

// ---------------------------------------------------------------------------
// Cloud scheduler card — Settings ▸ Autonomy (Phase B, DRY-RUN).
//
// Truthful by construction: this card NEVER claims routines are executing in
// the cloud. Phase B's scheduler observes due occurrences and records them
// (skipped-dry-run / device-due / missed); execution arrives in Phase C. The
// Autonomy Context card shows exactly what would travel, before and after
// sync — consent is the per-memory flag, never inferred.
// ---------------------------------------------------------------------------

const CONFIG_CHANGED_EVENT = 'elara-autonomy-config-changed';

function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

export function AutonomyCloud({ onNotice }: { onNotice: (message: string | null) => void }) {
  const [pairing, setPairing] = useState<AutonomyPairing | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ phase: 'idle' });
  const [state, setState] = useState<CloudSchedulerState | null>(null);
  const [workerUrl, setWorkerUrl] = useState('');
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showInspect, setShowInspect] = useState(false);
  const [inspect, setInspect] = useState<{ projection: AutonomyContextProjection; eligible: AutonomyContextSource[] } | null>(null);
  const syncInFlight = useRef(false);

  const runFullSync = useCallback(async (current: AutonomyPairing) => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setStatus({ phase: 'syncing' });
    try {
      const result = await fullSync(current);
      setState(result.state);
      const contextNote = result.contextSynced ? ' · context updated' : ' · context unchanged';
      const staleNote = result.staleRejected ? ' · stale config rejected (another device is ahead)' : '';
      setStatus({ phase: 'synced', at: Date.now(), detail: `${result.state.routines.length} routine(s) mirrored${contextNote}${staleNote}` });
    } catch (error) {
      const message = error instanceof AutonomyCloudError ? error.message : error instanceof Error ? error.message : 'The cloud scheduler could not be reached.';
      setStatus({ phase: 'error', code: (error as { code?: string }).code ?? 'unknown', message });
    } finally {
      syncInFlight.current = false;
    }
  }, []);

  const runConfigSync = useCallback(async (current: AutonomyPairing) => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setStatus({ phase: 'syncing' });
    try {
      const { staleRejected } = await syncConfiguration(current);
      setState(await fetchSchedulerState(current));
      setStatus({ phase: 'synced', at: Date.now(), detail: staleRejected ? 'Configuration rejected as stale — another device is ahead.' : 'Configuration mirrored.' });
    } catch (error) {
      const message = error instanceof AutonomyCloudError ? error.message : 'The configuration could not be synced.';
      setStatus({ phase: 'error', code: (error as { code?: string }).code ?? 'unknown', message });
    } finally {
      syncInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const existing = loadPairing();
    setPairing(existing);
    if (existing) void runFullSync(existing);
    // Local autonomy configuration changed → mirror it (debounced by the event itself).
    const handler = () => { if (loadPairing()) void runConfigSync(loadPairing()!); };
    window.addEventListener(CONFIG_CHANGED_EVENT, handler);
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, handler);
  }, [runFullSync, runConfigSync]);

  const verify = useCallback(async () => {
    setVerifying(true);
    onNotice(null);
    try {
      const result = await pairWithWorker(workerUrl.trim(), token.trim());
      const pairing: AutonomyPairing = {
        workerUrl: workerUrl.trim().replace(/\/+$/, ''),
        token: token.trim(),
        installationId: result.installationId,
        workerVersion: result.version,
        schemaVersion: result.schemaVersion,
        pairedAt: Date.now(),
        lastSyncedAt: null,
        lastSyncedContextHash: null,
        lastPulledRunsAt: 0,
      };
      savePairing(pairing);
      setPairing(pairing);
      setToken('');
      // Pairing declares this app's configuration authoritative: the local
      // generation advances, so the first sync (and every later change) can
      // never be treated as older than whatever the worker already holds.
      bumpConfigGeneration();
      await runFullSync(pairing);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Pairing failed.');
    } finally {
      setVerifying(false);
    }
  }, [workerUrl, token, onNotice, runFullSync]);

  const unpair = useCallback(() => {
    clearPairing();
    setPairing(null);
    setState(null);
    setStatus({ phase: 'idle' });
    onNotice('Unpaired. Local routines and history are untouched; the worker keeps its mirror until you pair again.');
  }, [onNotice]);

  const refresh = useCallback(async () => {
    const current = loadPairing();
    if (current) await runFullSync(current);
  }, [runFullSync]);

  const refreshContext = useCallback(async () => {
    const current = loadPairing();
    if (!current) return;
    await runFullSync(current); // rebuild + hash-guarded replace + stats
    const projection = await inspectContextProjection();
    const eligible = (await listMemories()).filter((memory) => isAutonomyContextEligible(memory, Date.now()));
    setInspect({ projection, eligible });
  }, [runFullSync]);

  const clearContextPack = useCallback(async () => {
    const current = loadPairing();
    if (!current) return;
    try {
      await clearWorkerContext(current);
      await runFullSync(current);
      onNotice('The worker-side Autonomy Context was cleared.');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'The context could not be cleared.');
    }
  }, [runFullSync, onNotice]);

  const toggleConsent = useCallback(async (id: string, consent: boolean) => {
    try {
      await updateMemory(id, { autonomyContext: consent });
      const projection = await inspectContextProjection();
      const eligible = (await listMemories()).filter((memory) => isAutonomyContextEligible(memory, Date.now()));
      setInspect({ projection, eligible });
    } catch {
      onNotice('The memory consent could not be saved.');
    }
  }, [onNotice]);

  const contextSummary = useMemo(() => state?.context ?? null, [state]);

  // ---------------------------------------------------------------------
  // Not configured: honest setup state — no fake "connected" anywhere.
  // ---------------------------------------------------------------------
  if (!pairing) {
    return (
      <div className="autonomy-policy-card autonomy-cloud">
        <strong>Cloud scheduler — not connected</strong>
        <span>
          Elara can wake on a schedule in <em>your own</em> Cloudflare worker, decide when each routine is due, and leave the decision in your run history — while the app is closed.
          This phase records due occurrences as <strong>dry runs</strong>: no model runs in the cloud yet, and Google-backed routines stay on this device. Everything local keeps working without it.
        </span>
        <label className="autonomy-field">
          <span>Worker URL</span>
          <input value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder="https://elara-gemini.your-account.workers.dev" inputMode="url" />
        </label>
        <label className="autonomy-field">
          <span>Installation token (your worker's ELARA_INSTALLATION_TOKEN secret)</span>
          <input value={token} type="password" onChange={(event) => setToken(event.target.value)} placeholder="paste the secret" autoComplete="off" />
        </label>
        <div className="autonomy-cloud__actions">
          <button type="button" className="autonomy-button autonomy-button--primary" disabled={verifying || !workerUrl.trim() || !token.trim()} onClick={() => { void verify(); }}>
            {verifying ? 'Verifying…' : 'Verify & pair'}
          </button>
          <a className="autonomy-policy-note" href="https://github.com/cryogenized-spec/Elara-Angelic-Utility-Applet/blob/main/docs/AUTONOMOUS_ELARA.md" target="_blank" rel="noreferrer">Read the setup guide</a>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Paired: scheduler state + Autonomy Context, truthfully labeled.
  // ---------------------------------------------------------------------
  return (
    <div className="autonomy-policy-card autonomy-cloud is-paired">
      <div className="autonomy-cloud__head">
        <strong>Cloud scheduler <span className="autonomy-badge">dry run</span></strong>
        <button type="button" className="autonomy-button" onClick={unpair}>Unpair</button>
      </div>
      <span>
        Connected to <code>{pairing.workerUrl}</code> · installation {pairing.installationId.slice(0, 8)} · worker v{pairing.workerVersion}.
        The scheduler decides <em>when</em> each routine is due and records the observation — cloud execution itself arrives in the next phase.
      </span>
      <div className="autonomy-cloud__meta">
        <span>Master switch: {state?.autonomyEnabled ? 'on' : 'off'}</span>
        <span>Config generation: {state?.generation ?? '—'}</span>
        <span>Last heartbeat: {formatTimestamp(state?.lastHeartbeatAt ?? null)}</span>
        <span>Next scheduler wake: {formatTimestamp(state?.nextAlarmAt ?? null)}</span>
        <span>Last sync: {formatTimestamp(pairing.lastSyncedAt)}</span>
      </div>
      {status.phase === 'syncing' && <div className="autonomy-routine__status" role="status">Syncing…</div>}
      {status.phase === 'synced' && <div className="autonomy-routine__status" role="status">Synced · {status.detail}</div>}
      {status.phase === 'error' && <div className="autonomy-routine__status" role="alert">Sync failed ({status.code}): {status.message}</div>}

      {state && state.routines.length > 0 && (
        <div className="autonomy-cloud__schedules">
          {state.routines.map((routine) => (
            <div key={routine.id} className={`autonomy-cloud__schedule${routine.enabled ? '' : ' is-disabled'}`}>
              <strong>{routine.name}</strong>
              <span>
                {describeSchedule(routine.schedule as never)}
                {routine.locus === 'cloud' ? ' · runs in the worker (execution: next phase)' : ' · runs on this device (worker only records due)'}
              </span>
              <span>{routine.nextDueAt ? `Next due: ${formatTimestamp(routine.nextDueAt)}` : 'Not scheduled (disabled or off)'}</span>
            </div>
          ))}
        </div>
      )}
      {state && state.routines.length === 0 && <div className="autonomy-empty">No routines mirrored yet — save a routine to schedule it.</div>}

      {state && state.journal.length > 0 && (
        <details className="autonomy-cloud__journal">
          <summary>Scheduler decisions (last {Math.min(state.journal.length, 5)})</summary>
          {state.journal.slice(0, 5).map((entry, index) => (
            <div key={index} className="autonomy-cloud__journal-entry">
              <span>{formatTimestamp(entry.at)}</span>
              <span>{entry.kind}</span>
              {entry.routineId && <span>{state.routines.find((routine) => routine.id === entry.routineId)?.name ?? entry.routineId}</span>}
              {entry.detail && <span>{entry.detail}</span>}
            </div>
          ))}
        </details>
      )}

      <div className="autonomy-context">
        <div className="autonomy-context__head">
          <strong>Autonomy Context</strong>
          <span>These memories may be available during scheduled execution — only what you explicitly include ever leaves this device.</span>
        </div>
        <div className="autonomy-cloud__meta">
          <span>{contextSummary ? `${contextSummary.recordCount} record(s) · ${formatBytes(contextSummary.byteSize)} of ${formatBytes(AUTONOMY_CONTEXT_MAX_BYTES)}` : 'No pack synced'}</span>
          <span>{contextSummary ? `Last synced: ${formatTimestamp(contextSummary.syncedAt)}` : 'Never synced'}</span>
          {contextSummary?.stale && <span className="autonomy-field-warning">Context is stale (over 14 days old) — refresh it.</span>}
        </div>
        <div className="autonomy-cloud__actions">
          <button type="button" className="autonomy-button" onClick={() => { setShowInspect(true); void refreshContext(); }}>{showInspect ? 'Refresh inspection' : 'Inspect'}</button>
          <button type="button" className="autonomy-button" onClick={() => { void refresh(); }}>Refresh sync</button>
          <button type="button" className="autonomy-button autonomy-button--danger" onClick={() => { void clearContextPack(); }}>Clear</button>
        </div>
        {showInspect && inspect && (
          <div className="autonomy-context__inspect">
            <strong>Traveling now ({inspect.projection.recordCount} of ≤{AUTONOMY_CONTEXT_MAX_RECORDS} records, {formatBytes(inspect.projection.byteSize)})</strong>
            {inspect.projection.records.map((record) => (
              <label key={record.id} className="autonomy-check is-checked">
                <input type="checkbox" checked onChange={() => { void toggleConsent(record.id, false); }} />
                <span>{record.kind} · {record.title} · {formatBytes(record.body.length)}</span>
              </label>
            ))}
            {inspect.projection.truncated && <small className="autonomy-field-warning">Over budget — the lowest-ranked memories were left out.</small>}
            <strong>Eligible but not included</strong>
            {inspect.eligible.filter((memory) => !inspect.projection.records.some((record) => record.id === memory.id)).map((memory) => (
              <label key={memory.id} className="autonomy-check">
                <input type="checkbox" checked={false} onChange={() => { void toggleConsent(memory.id, true); }} />
                <span>{memory.kind} · {memory.title}</span>
              </label>
            ))}
            {inspect.eligible.length === 0 && <small className="autonomy-policy-note">Nothing is eligible yet. A memory becomes eligible when it is active, established (CORE/CONTEXTUAL/EPISODIC), not expired, and you tick it here.</small>}
          </div>
        )}
      </div>
    </div>
  );
}
