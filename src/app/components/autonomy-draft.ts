import {
  DEFAULT_ROUTINE_DELIVERY,
  DEFAULT_ROUTINE_POLICY,
  ROUTINE_GOOGLE_CAPABILITIES,
  type ElaraRoutine,
} from '../../autonomy/contracts';

// ---------------------------------------------------------------------------
// Routine editor draft mapping — pure, UI-independent, and exported for the
// custom-schedule preservation regression: a persisted custom weekday array
// must survive an edit/save cycle unless the user explicitly changes it.
// ---------------------------------------------------------------------------

export interface RoutineDraft {
  id: string | null;
  name: string;
  instruction: string;
  timezone: string;
  scheduleKind: 'daily' | 'interval';
  time: string;
  days: 'every' | 'weekdays' | 'weekends' | 'custom';
  everyMinutes: string;
  betweenEnabled: boolean;
  betweenStart: string;
  betweenEnd: string;
  memory: boolean;
  capabilities: string[];
  cooldownHours: string;
  maxToolCalls: string;
  maxRunsPerDay: string;
}

export const TIME_PRESETS = ['15', '30', '60', '120', '240', '360', '720', '1440'];
export const COOLDOWN_PRESETS = ['1', '6', '12', '24', '48', '72', '168'];
export const TOOLCALL_PRESETS = ['2', '4', '8', '12', '16', '20'];
export const RUNS_PER_DAY_PRESETS = ['1', '2', '4', '6', '8', '12'];

export function blankDraft(timezone: string): RoutineDraft {
  return {
    id: null,
    name: '',
    instruction: '',
    timezone,
    scheduleKind: 'daily',
    time: '09:00',
    days: 'every',
    everyMinutes: '60',
    betweenEnabled: false,
    betweenStart: '09:00',
    betweenEnd: '18:00',
    memory: false,
    capabilities: [],
    cooldownHours: String(DEFAULT_ROUTINE_POLICY.cooldownHours),
    maxToolCalls: String(DEFAULT_ROUTINE_POLICY.maxToolCalls),
    maxRunsPerDay: String(DEFAULT_ROUTINE_POLICY.maxRunsPerDay),
  };
}

export function draftDays(routine: ElaraRoutine): RoutineDraft['days'] {
  if (routine.schedule.kind !== 'daily') return 'every';
  const days = routine.schedule.days;
  // A persisted custom weekday list (store tampering or a future authoring
  // surface) is preserved through an edit/save cycle: it displays as its own
  // selectable option, and saving with it selected keeps the exact array. Only
  // an explicit switch to a named set rewrites the schedule.
  return days === 'every' || days === 'weekdays' || days === 'weekends' ? days : 'custom';
}

export function customDaysLabel(routine: ElaraRoutine | undefined): string {
  if (routine?.schedule.kind === 'daily' && Array.isArray(routine.schedule.days)) {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Custom (${routine.schedule.days.map((day) => labels[day]).join(' · ')})`;
  }
  return 'Custom days';
}

export function draftFromRoutine(routine: ElaraRoutine): RoutineDraft {
  const schedule = routine.schedule;
  return {
    id: routine.id,
    name: routine.name,
    instruction: routine.instruction,
    timezone: routine.timezone,
    scheduleKind: schedule.kind,
    time: schedule.kind === 'daily' ? schedule.time : '09:00',
    days: draftDays(routine),
    everyMinutes: schedule.kind === 'interval' ? String(schedule.everyMinutes) : '60',
    betweenEnabled: schedule.kind === 'interval' && Boolean(schedule.between),
    betweenStart: schedule.kind === 'interval' && schedule.between ? schedule.between.start : '09:00',
    betweenEnd: schedule.kind === 'interval' && schedule.between ? schedule.between.end : '18:00',
    memory: routine.permissions.memory,
    capabilities: [...routine.permissions.google],
    cooldownHours: String(routine.policy.cooldownHours),
    maxToolCalls: String(routine.policy.maxToolCalls),
    maxRunsPerDay: String(routine.policy.maxRunsPerDay),
  };
}

export function draftToRoutine(draft: RoutineDraft, existing: ElaraRoutine | undefined): ElaraRoutine {
  const everyMinutes = Math.max(15, Math.min(1_440, Number.parseInt(draft.everyMinutes, 10) || 60));
  // Preserve a custom weekday array through an edit/save cycle; 'custom' with
  // no persisted array (not reachable from this editor) falls back to 'every'.
  const existingDays = existing?.schedule.kind === 'daily' && Array.isArray(existing.schedule.days) ? existing.schedule.days : undefined;
  const days = draft.days === 'custom' ? (existingDays ?? 'every') : draft.days;
  const routine: ElaraRoutine = {
    id: draft.id ?? `routine-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    name: draft.name.trim(),
    enabled: existing?.enabled ?? true,
    instruction: draft.instruction.trim(),
    schedule: draft.scheduleKind === 'daily'
      ? { kind: 'daily', time: draft.time, days }
      : { kind: 'interval', everyMinutes, ...(draft.betweenEnabled ? { between: { start: draft.betweenStart, end: draft.betweenEnd } } : {}) },
    timezone: draft.timezone.trim() || 'UTC',
    permissions: {
      memory: draft.memory,
      google: ROUTINE_GOOGLE_CAPABILITIES.filter((capability) => draft.capabilities.includes(capability)),
    },
    delivery: existing?.delivery ?? DEFAULT_ROUTINE_DELIVERY,
    policy: {
      cooldownHours: Math.max(1, Math.min(168, Number.parseInt(draft.cooldownHours, 10) || DEFAULT_ROUTINE_POLICY.cooldownHours)),
      maxToolCalls: Math.max(1, Math.min(20, Number.parseInt(draft.maxToolCalls, 10) || DEFAULT_ROUTINE_POLICY.maxToolCalls)),
      maxRunsPerDay: Math.max(1, Math.min(12, Number.parseInt(draft.maxRunsPerDay, 10) || DEFAULT_ROUTINE_POLICY.maxRunsPerDay)),
    },
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    ...(existing?.lastRunAt !== undefined ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastResult !== undefined ? { lastResult: existing.lastResult } : {}),
  };
  return routine;
}

export function selectOptions(presets: readonly string[], current: string): { value: string; label: string }[] {
  const values = [...new Set([...presets, current])].sort((a, b) => Number(a) - Number(b));
  return values.map((value) => ({ value, label: value }));
}
