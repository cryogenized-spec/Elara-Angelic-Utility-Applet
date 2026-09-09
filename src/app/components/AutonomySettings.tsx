import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MAX_ROUTINES,
  ROUTINE_GOOGLE_CAPABILITIES,
  elaraRoutineSchema,
  type ElaraRoutine,
  type RoutineGoogleCapability,
  type RoutineRunRecord,
  type AutonomousEvent,
} from '../../autonomy/contracts';
import {
  blankDraft,
  customDaysLabel,
  type RoutineDraft,
  draftFromRoutine,
  draftToRoutine,
  selectOptions,
  COOLDOWN_PRESETS,
  RUNS_PER_DAY_PRESETS,
  TIME_PRESETS,
  TOOLCALL_PRESETS,
} from './autonomy-draft';
import { computeNextOccurrence, describeSchedule } from '../../autonomy/schedule';
import { executeRoutineRun } from '../../autonomy/runner';
import {
  AUTONOMY_UPDATED_EVENT,
  RoutineLimitError,
  deleteRoutine,
  listEvents,
  listRoutines,
  listRuns,
  markAllEventsRead,
  markEventRead,
  saveRoutine,
} from '../../persistence/autonomy';
import { loadAutonomyPreferences, saveAutonomyPreferences } from '../../persistence/preferences';
import type { AutonomyPreferences } from '../../domain/preferences';
import { RangeSlider } from './RangeSlider';

// ---------------------------------------------------------------------------
// Autonomy settings — routines, Run Now, Autonomy Inbox, and run history.
// Self-contained: loads and saves its own local stores, exactly like the
// Memory Bank and Google panels. Scheduled execution (Phase B) will reuse the
// same routine records; today every run is manual ("Run now").
// ---------------------------------------------------------------------------

const CAPABILITY_LABELS: Record<RoutineGoogleCapability, string> = {
  'calendar.events.read': 'Calendar — events',
  'calendar.list.read': 'Calendar — calendars',
  'calendar.settings.read': 'Calendar — settings',
  'tasks.read': 'Tasks',
  'docs.read': 'Docs',
  'chat.read': 'Chat',
  'gmail.read': 'Gmail',
  'drive.files.app.read': 'Drive — app files',
  'drive.library.read': 'Drive — full library',
  'sheets.read': 'Sheets',
};

function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

function formatNextOccurrence(routine: ElaraRoutine): string | null {
  if (!isValidTimezone(routine.timezone)) return null;
  try {
    const next = computeNextOccurrence(routine.schedule, routine.timezone, Date.now());
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: routine.timezone }).format(new Date(next));
  } catch {
    return null;
  }
}

function describeRunOutcome(run: RoutineRunRecord): string {
  if (run.state === 'skipped') {
    if (run.errorCode === 'AUTONOMY_DISABLED') return 'Skipped — autonomous routines are switched off.';
    if (run.errorCode === 'ROUTINE_DISABLED') return 'Skipped — this routine is disabled.';
    if (run.errorCode === 'RUN_IN_FLIGHT') return 'Skipped — this routine is already running.';
    return 'Skipped.';
  }
  if (run.state === 'cancelled') return 'Cancelled.';
  if (run.outcome === 'event') return 'Event delivered to the Autonomy Inbox.';
  if (run.outcome === 'no-op') return run.reason ? `Nothing noteworthy (${run.reason}).` : 'Nothing noteworthy.';
  if (run.outcome === 'suppressed') return `Held back by policy (${run.suppressedReason ?? 'policy'}).`;
  if (run.outcome === 'error') return `Failed — ${run.errorCode ?? 'unknown error'}`;
  return run.state;
}

export function AutonomySettings() {
  const [prefs, setPrefs] = useState<AutonomyPreferences | null>(null);
  const [routines, setRoutines] = useState<ElaraRoutine[]>([]);
  const [events, setEvents] = useState<AutonomousEvent[]>([]);
  const [runs, setRuns] = useState<RoutineRunRecord[]>([]);
  const [runningIds, setRunningIds] = useState<readonly string[]>([]);
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [preferences, routineList, eventList, runList] = await Promise.all([
        loadAutonomyPreferences(),
        listRoutines(),
        listEvents(100),
        listRuns(20),
      ]);
      setPrefs(preferences);
      setRoutines(routineList);
      setEvents(eventList);
      setRuns(runList);
    } catch {
      setNotice('The autonomy store could not be read.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener(AUTONOMY_UPDATED_EVENT, handler);
    return () => window.removeEventListener(AUTONOMY_UPDATED_EVENT, handler);
  }, [refresh]);

  const unreadCount = useMemo(() => events.filter((event) => event.readAt === null).length, [events]);
  const atLimit = routines.length >= MAX_ROUTINES;

  const updatePrefs = useCallback(async (next: Partial<AutonomyPreferences>) => {
    if (!prefs) return;
    const saved = await saveAutonomyPreferences({ ...prefs, ...next });
    setPrefs(saved);
  }, [prefs]);

  const toggleRoutine = useCallback(async (routine: ElaraRoutine) => {
    try {
      await saveRoutine({ ...routine, enabled: !routine.enabled });
    } catch {
      setNotice('The routine could not be saved.');
    }
  }, []);

  const removeRoutine = useCallback(async (routine: ElaraRoutine) => {
    try {
      await deleteRoutine(routine.id);
    } catch {
      setNotice('The routine could not be deleted.');
    }
  }, []);

  const runNow = useCallback(async (routine: ElaraRoutine) => {
    if (!prefs) return;
    setRunningIds((prev) => [...prev, routine.id]);
    setRunStatus((prev) => ({ ...prev, [routine.id]: 'Running…' }));
    try {
      const { run } = await executeRoutineRun(routine, prefs, 'manual');
      setRunStatus((prev) => ({ ...prev, [routine.id]: describeRunOutcome(run) }));
    } catch (error) {
      setRunStatus((prev) => ({ ...prev, [routine.id]: error instanceof RoutineLimitError ? error.message : 'The run could not be started.' }));
    } finally {
      setRunningIds((prev) => prev.filter((id) => id !== routine.id));
      void refresh();
    }
  }, [prefs, refresh]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const existing = draft.id ? routines.find((routine) => routine.id === draft.id) : undefined;
    const routine = draftToRoutine(draft, existing);
    const parsed = elaraRoutineSchema.safeParse(routine);
    if (!parsed.success) {
      setDraftErrors(parsed.error.issues.map((issue) => `${issue.path.length ? issue.path.join('.') : 'routine'}: ${issue.message}`));
      return;
    }
    try {
      await saveRoutine(parsed.data);
      setDraft(null);
      setDraftErrors([]);
    } catch (error) {
      setDraftErrors([error instanceof RoutineLimitError ? error.message : 'The routine could not be saved.']);
    }
  }, [draft, routines]);

  if (!prefs) {
    return <div className="autonomy-settings"><div className="autonomy-empty">{notice ?? 'Loading autonomy…'}</div></div>;
  }

  return (
    <div className="autonomy-settings">
      <div className="autonomy-toggle-card">
        <div className="autonomy-toggle-card__copy">
          <strong>Autonomous routines</strong>
          <span>When off, nothing runs on its own: no scheduled execution, no routine triggers. Manual “Run now” is also gated by this switch.</span>
        </div>
        <button type="button" className={`autonomy-switch${prefs.enabled ? ' is-on' : ''}`} role="switch" aria-checked={prefs.enabled} aria-label="Autonomous routines master switch" onClick={() => { void updatePrefs({ enabled: !prefs.enabled }); }}>
          <span className="autonomy-switch__track"><span className="autonomy-switch__thumb" /></span>
        </button>
      </div>

      <div className="autonomy-policy-card">
        <strong>Event budget</strong>
        <span>Hard cap on AutonomousEvents per rolling 24 hours, across all routines. The model proposes; this code decides.</span>
        <RangeSlider
          id="autonomy-max-events"
          label="Maximum events per day"
          min={1}
          max={30}
          step={1}
          value={Math.min(30, prefs.maxEventsPerDay)}
          valueLabel={String(prefs.maxEventsPerDay)}
          minLabel="1"
          maxLabel="30"
          onChange={(value) => { void updatePrefs({ maxEventsPerDay: value }); }}
        />
      </div>

      <div className="autonomy-section-heading">
        <div>
          <span className="autonomy-section-kicker">ROUTINES</span>
          <strong>Routine library</strong>
        </div>
        <button type="button" className="autonomy-button autonomy-button--primary" disabled={atLimit || draft !== null} onClick={() => { setDraft(blankDraft(localTimezone())); setDraftErrors([]); }}>
          {atLimit ? `Limit ${MAX_ROUTINES}` : '+ Routine'}
        </button>
      </div>

      {draft && (
        <div className="autonomy-editor">
          <strong>{draft.id ? 'Edit routine' : 'New routine'}</strong>
          <label className="autonomy-field">
            <span>Name</span>
            <input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Morning calendar brief" />
          </label>
          <label className="autonomy-field">
            <span>Instruction — what Elara should do each run</span>
            <textarea rows={4} value={draft.instruction} maxLength={4_000} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} placeholder={'Review today’s calendar events and tell me only about changes that affect my morning: moved meetings, conflicts, early starts.'} />
          </label>
          <div className="autonomy-field-grid">
            <label className="autonomy-field">
              <span>Schedule</span>
              <select value={draft.scheduleKind} onChange={(event) => setDraft({ ...draft, scheduleKind: event.target.value as RoutineDraft['scheduleKind'] })}>
                <option value="daily">Daily at a time</option>
                <option value="interval">Every N minutes</option>
              </select>
            </label>
            {draft.scheduleKind === 'daily' ? (
              <>
                <label className="autonomy-field">
                  <span>Time (routine’s timezone)</span>
                  <input value={draft.time} inputMode="numeric" placeholder="HH:mm" onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
                </label>
                <label className="autonomy-field">
                  <span>Days</span>
                  <select value={draft.days} onChange={(event) => setDraft({ ...draft, days: event.target.value as RoutineDraft['days'] })}>
                    <option value="every">Every day</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekends">Weekends</option>
                    {draft.days === 'custom' && <option value="custom">{customDaysLabel(routines.find((routine) => routine.id === draft.id))}</option>}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="autonomy-field">
                  <span>Every (minutes)</span>
                  <select value={draft.everyMinutes} onChange={(event) => setDraft({ ...draft, everyMinutes: event.target.value })}>
                    {selectOptions(TIME_PRESETS, draft.everyMinutes).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="autonomy-check">
                  <input type="checkbox" checked={draft.betweenEnabled} onChange={(event) => setDraft({ ...draft, betweenEnabled: event.target.checked })} />
                  <span>Only during a waking window</span>
                </label>
                {draft.betweenEnabled && (
                  <>
                    <label className="autonomy-field">
                      <span>Window start</span>
                      <input value={draft.betweenStart} placeholder="HH:mm" onChange={(event) => setDraft({ ...draft, betweenStart: event.target.value })} />
                    </label>
                    <label className="autonomy-field">
                      <span>Window end</span>
                      <input value={draft.betweenEnd} placeholder="HH:mm" onChange={(event) => setDraft({ ...draft, betweenEnd: event.target.value })} />
                    </label>
                  </>
                )}
              </>
            )}
          </div>
          <div className="autonomy-field-grid">
            <label className="autonomy-field">
              <span>Timezone</span>
              <input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} placeholder="Africa/Johannesburg" aria-invalid={!isValidTimezone(draft.timezone)} />
            </label>
            <button type="button" className="autonomy-button" onClick={() => setDraft({ ...draft, timezone: localTimezone() })}>Use mine</button>
          </div>
          {!isValidTimezone(draft.timezone) && <small className="autonomy-field-warning">Unknown timezone — saving will fall back to UTC.</small>}

          <div className="autonomy-field">
            <span>Read permissions — granted tools (writes are never available to routines)</span>
            <div className="autonomy-capabilities" role="group" aria-label="Google read permissions">
              {ROUTINE_GOOGLE_CAPABILITIES.map((capability) => (
                <label key={capability} className={`autonomy-check${draft.capabilities.includes(capability) ? ' is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={draft.capabilities.includes(capability)}
                    onChange={(event) => setDraft({ ...draft, capabilities: event.target.checked ? [...draft.capabilities, capability] : draft.capabilities.filter((item) => item !== capability) })}
                  />
                  <span>{CAPABILITY_LABELS[capability]}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="autonomy-check autonomy-check--standalone">
            <input type="checkbox" checked={draft.memory} onChange={(event) => setDraft({ ...draft, memory: event.target.checked })} />
            <span>Read global durable memory as context</span>
          </label>

          <div className="autonomy-field-grid">
            <label className="autonomy-field">
              <span>Cooldown (hours)</span>
              <select value={draft.cooldownHours} onChange={(event) => setDraft({ ...draft, cooldownHours: event.target.value })}>
                {selectOptions(COOLDOWN_PRESETS, draft.cooldownHours).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="autonomy-field">
              <span>Max tool calls per run</span>
              <select value={draft.maxToolCalls} onChange={(event) => setDraft({ ...draft, maxToolCalls: event.target.value })}>
                {selectOptions(TOOLCALL_PRESETS, draft.maxToolCalls).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="autonomy-field">
              <span>Max scheduled runs per day</span>
              <select value={draft.maxRunsPerDay} onChange={(event) => setDraft({ ...draft, maxRunsPerDay: event.target.value })}>
                {selectOptions(RUNS_PER_DAY_PRESETS, draft.maxRunsPerDay).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <small className="autonomy-policy-note">The scheduled-run budget is applied when scheduled execution arrives (cloud scheduler, next phase). Manual “Run now” is not counted against it.</small>

          {draftErrors.length > 0 && (
            <ul className="autonomy-errors" role="alert">
              {draftErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}

          <div className="autonomy-editor__actions">
            <button type="button" className="autonomy-button" onClick={() => { setDraft(null); setDraftErrors([]); }}>Cancel</button>
            <button type="button" className="autonomy-button autonomy-button--primary" onClick={() => { void saveDraft(); }}>Save routine</button>
          </div>
        </div>
      )}

      {routines.length === 0 && draft === null && (
        <div className="autonomy-empty">No routines yet. A routine is a saved instruction Elara runs on a schedule — for now you trigger runs manually with “Run now”.</div>
      )}

      {routines.map((routine) => {
        const isRunning = runningIds.includes(routine.id);
        const next = routine.enabled ? formatNextOccurrence(routine) : null;
        return (
          <div key={routine.id} className={`autonomy-routine${routine.enabled ? '' : ' is-disabled'}`}>
            <div className="autonomy-routine__head">
              <div className="autonomy-routine__title">
                <strong>{routine.name}</strong>
                <span>{describeSchedule(routine.schedule)} · {routine.timezone}{routine.permissions.google.length > 0 ? ` · ${routine.permissions.google.length} Google read${routine.permissions.google.length > 1 ? 's' : ''}` : ''}{routine.permissions.memory ? ' · memory' : ''}</span>
              </div>
              <button type="button" className={`autonomy-switch${routine.enabled ? ' is-on' : ''}`} role="switch" aria-checked={routine.enabled} aria-label={`Enable ${routine.name}`} onClick={() => { void toggleRoutine(routine); }}>
                <span className="autonomy-switch__track"><span className="autonomy-switch__thumb" /></span>
              </button>
            </div>
            <p className="autonomy-routine__instruction">{routine.instruction}</p>
            <div className="autonomy-routine__meta">
              {routine.lastRunAt !== undefined && routine.lastResult && <span>Last run: {formatTimestamp(routine.lastRunAt)} · {routine.lastResult.state}{routine.lastResult.outcome ? ` (${routine.lastResult.outcome})` : ''}</span>}
              {next && <span>Next: {next} (shown for planning — local scheduled firing arrives with the cloud scheduler)</span>}
            </div>
            {runStatus[routine.id] && <div className="autonomy-routine__status" role="status">{runStatus[routine.id]}</div>}
            <div className="autonomy-routine__actions">
              <button type="button" className="autonomy-button autonomy-button--primary" disabled={isRunning || draft !== null} onClick={() => { void runNow(routine); }}>
                {isRunning ? 'Running…' : 'Run now'}
              </button>
              <button type="button" className="autonomy-button" disabled={draft !== null} onClick={() => { setDraft(draftFromRoutine(routine)); setDraftErrors([]); }}>Edit</button>
              <button type="button" className="autonomy-button autonomy-button--danger" disabled={draft !== null} onClick={() => { void removeRoutine(routine); }}>Delete</button>
            </div>
          </div>
        );
      })}

      <div className="autonomy-section-heading">
        <div>
          <span className="autonomy-section-kicker">INBOX</span>
          <strong>Autonomy Inbox{unreadCount > 0 ? ` · ${unreadCount} new` : ''}</strong>
        </div>
        {unreadCount > 0 && <button type="button" className="autonomy-button" onClick={() => { void markAllEventsRead(); }}>Mark all read</button>}
      </div>
      {events.length === 0 && <div className="autonomy-empty">Quiet. When a routine run produces something worth telling you, it lands here — nothing else will.</div>}
      {events.map((event) => {
        const routine = routines.find((item) => item.id === event.routineId);
        return (
          <button key={event.id} type="button" className={`autonomy-event${event.readAt === null ? ' is-unread' : ''}`} onClick={() => { if (event.readAt === null) void markEventRead(event.id); }}>
            <div className="autonomy-event__head">
              {event.readAt === null && <span className="autonomy-event__dot" aria-label="Unread" />}
              <strong>{event.title}</strong>
              <span className="autonomy-event__importance" data-importance={event.importance}>{'●'.repeat(event.importance)}{'○'.repeat(3 - event.importance)}</span>
            </div>
            <p>{event.summary}</p>
            <div className="autonomy-event__meta">
              <span>{routine?.name ?? 'Deleted routine'}</span>
              <span>{formatTimestamp(event.createdAt)}</span>
              <span>importance {event.importance}/3 · confidence {event.confidence}/3</span>
              {event.evidence.length > 0 && <span>{event.evidence.length} evidence item{event.evidence.length > 1 ? 's' : ''}</span>}
            </div>
            {event.evidence.length > 0 && (
              <span className="autonomy-event__evidence">
                {event.evidence.map((item, index) => (
                  <span key={index} className="autonomy-event__evidence-item" data-kind={item.kind}>{item.kind}: {item.ref}{item.note ? ` — ${item.note}` : ''}</span>
                ))}
              </span>
            )}
          </button>
        );
      })}

      <div className="autonomy-section-heading">
        <div>
          <span className="autonomy-section-kicker">HISTORY</span>
          <strong>Recent runs</strong>
        </div>
      </div>
      {runs.length === 0 && <div className="autonomy-empty">No runs recorded yet.</div>}
      {runs.length > 0 && (
        <div className="autonomy-runs">
          {runs.map((run) => (
            <div key={run.id} className={`autonomy-run is-${run.state}`}>
              <span className="autonomy-run__state">{run.state}</span>
              <span className="autonomy-run__name">{run.routineName}</span>
              <span className="autonomy-run__detail">{run.executionMode}{run.outcome ? ` · ${run.outcome}` : ''}{run.suppressedReason ? ` (${run.suppressedReason})` : ''}{run.errorCode ? ` · ${run.errorCode}` : ''}</span>
              <span className="autonomy-run__time">{formatTimestamp(run.startedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
