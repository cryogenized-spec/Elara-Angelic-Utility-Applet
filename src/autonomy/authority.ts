import type { ElaraRoutine } from './contracts';
import type { AutonomyPreferences } from '../domain/preferences';

// ---------------------------------------------------------------------------
// Autonomy authority — the application-side permission gate.
//
// Nothing may execute a routine without passing this check. Today it answers
// to the local master switch and per-routine state; Phase B extends it with
// the cloud configuration generation (the same ladder the interactive
// confirmation boundary uses: application policy first, model never).
// ---------------------------------------------------------------------------

export type AutonomyDenialReason = 'master-disabled' | 'routine-disabled';

export interface AutonomyPermissionDecision {
  permitted: boolean;
  reason?: AutonomyDenialReason;
}

export function evaluateAutonomyPermission(settings: AutonomyPreferences, routine: ElaraRoutine): AutonomyPermissionDecision {
  if (!settings.enabled) return { permitted: false, reason: 'master-disabled' };
  if (!routine.enabled) return { permitted: false, reason: 'routine-disabled' };
  return { permitted: true };
}

export function describeDenial(reason: AutonomyDenialReason): string {
  if (reason === 'master-disabled') return 'Autonomous Elara is switched off.';
  return 'This routine is paused.';
}
