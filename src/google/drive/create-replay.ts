const MAX_DRIVE_CREATE_REPLAYS_PER_TURN = 128;
const MAX_DRIVE_REPLAY_TURNS = 8;

export interface DriveCreateReplayContext {
  readonly tool: 'drive.createFile';
  readonly callId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly generationId?: string;
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
}

interface ReplayEntry {
  readonly signature: string;
  readonly promise: Promise<unknown>;
}

interface ReplayTurn {
  readonly entries: Map<string, ReplayEntry>;
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
}

const replayTurns = new Map<string, ReplayTurn>();

async function payloadSignature(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function electedTurnKey(context: DriveCreateReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: DriveCreateReplayContext): string | undefined {
  const callId = context.callId?.trim();
  if (!callId) return undefined;
  return `${context.tool}\u0000${callId}`;
}

function contextIsActive(context: Pick<DriveCreateReplayContext, 'signal' | 'isGenerationActive'>): boolean {
  return !context.signal?.aborted && context.isGenerationActive?.() !== false;
}

function assertReplayTurnActive(context: DriveCreateReplayContext): void {
  if (!contextIsActive(context)) throw new DOMException('The Drive create replay lost turn authority.', 'AbortError');
}

function pruneInactiveTurns(): void {
  for (const [key, turn] of replayTurns) {
    if (!contextIsActive(turn)) replayTurns.delete(key);
  }
}

function replayTurn(context: DriveCreateReplayContext, turnKey: string): ReplayTurn {
  const existing = replayTurns.get(turnKey);
  if (existing) return existing;

  pruneInactiveTurns();
  if (replayTurns.size >= MAX_DRIVE_REPLAY_TURNS) {
    throw new Error('Google Drive create replay turn capacity was exhausted; retry after older turns retire.');
  }

  const created: ReplayTurn = {
    entries: new Map<string, ReplayEntry>(),
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.isGenerationActive ? { isGenerationActive: context.isGenerationActive } : {}),
  };
  replayTurns.set(turnKey, created);
  return created;
}

/**
 * Prevents the exact same Gemini Drive create call from issuing a second
 * files.create request for the lifetime of its elected turn.
 *
 * Replay state is independently keyed by turn. A stale or slower generation
 * never clears another live turn's entries. Inactive turn buckets are pruned
 * opportunistically; active buckets are never evicted to make room.
 *
 * This is a live-runtime replay fence, not provider idempotency. Drive does not
 * expose a client-chosen file id in this contract, so an ambiguous create cannot
 * be reconciled deterministically after a full page/runtime restart.
 */
export async function runDriveCreateOnce<T>(
  context: DriveCreateReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
  _now = Date.now(),
): Promise<T> {
  const turnKey = electedTurnKey(context);
  if (!turnKey) return operation();
  const key = replayKey(context);
  if (!key) return operation();

  assertReplayTurnActive(context);
  const signature = await payloadSignature(payload);
  assertReplayTurnActive(context);
  const turn = replayTurn(context, turnKey);
  const existing = turn.entries.get(key);
  if (existing) {
    if (existing.signature !== signature) throw new Error('Google Drive create replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (turn.entries.size >= MAX_DRIVE_CREATE_REPLAYS_PER_TURN) {
    throw new Error('Google Drive create replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(() => {
    assertReplayTurnActive(context);
    return operation();
  });
  turn.entries.set(key, { signature, promise });
  return promise;
}

export function resetDriveCreateReplayForTests(): void {
  replayTurns.clear();
}
