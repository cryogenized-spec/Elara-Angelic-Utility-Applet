const MAX_DRIVE_CREATE_REPLAYS = 128;

export interface DriveCreateReplayContext {
  readonly tool: 'drive.createFile';
  readonly callId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly generationId?: string;
}

interface ReplayEntry {
  readonly signature: Promise<string>;
  readonly promise: Promise<unknown>;
}

const replayEntries = new Map<string, ReplayEntry>();
let activeTurnKey: string | undefined;

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

function replayKey(context: DriveCreateReplayContext, turnKey: string): string | undefined {
  const callId = context.callId?.trim();
  if (!callId) return undefined;
  return `${context.tool}\u0000${turnKey}\u0000${callId}`;
}

function electTurn(turnKey: string): void {
  if (activeTurnKey === turnKey) return;
  replayEntries.clear();
  activeTurnKey = turnKey;
}

/**
 * Prevents the exact same Gemini create call from issuing a second Drive
 * `files.create` POST for the full lifetime of the currently elected turn in
 * this live runtime. A newly elected turn clears the prior turn's replay state;
 * entries never expire by wall clock while their turn remains elected.
 *
 * This is deliberately not name/content deduplication and not a provider-state
 * mirror: distinct call ids may create identically named files intentionally.
 * Drive accepts no client-chosen file id in this contract, so an ambiguous create
 * after a full page/runtime restart cannot be recovered deterministically; the
 * fence covers the live elected turn only and replaying the same call id with
 * different arguments fails closed instead of issuing a second POST.
 */
export async function runDriveCreateOnce<T>(
  context: DriveCreateReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
  _now = Date.now(),
): Promise<T> {
  const turnKey = electedTurnKey(context);
  if (!turnKey) return operation();
  const key = replayKey(context, turnKey);
  if (!key) return operation();

  electTurn(turnKey);
  // The digest starts before the duplicate check and the entry is published
  // without an intervening await, so two concurrent copies of the same call
  // cannot both miss the fence and issue a second create POST.
  const signature = payloadSignature(payload);
  const existing = replayEntries.get(key);
  if (existing) {
    const [entrySignature, callSignature] = await Promise.all([existing.signature, signature]);
    if (entrySignature !== callSignature) throw new Error('Google Drive create replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (replayEntries.size >= MAX_DRIVE_CREATE_REPLAYS) {
    throw new Error('Google Drive create replay capacity was exhausted for the current elected turn.');
  }

  const promise = signature.then(() => operation());
  replayEntries.set(key, { signature, promise });
  return promise;
}

export function resetDriveCreateReplayForTests(): void {
  replayEntries.clear();
  activeTurnKey = undefined;
}
