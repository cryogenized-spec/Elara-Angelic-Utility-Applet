const MAX_TASK_CREATE_REPLAYS = 128;

export interface TaskCreateReplayContext {
  readonly tool: 'tasks.createTask' | 'tasks.createTaskList';
  readonly callId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly generationId?: string;
}

interface ReplayEntry {
  readonly signature: string;
  readonly promise: Promise<unknown>;
}

const replayEntries = new Map<string, ReplayEntry>();
let activeTurnKey: string | undefined;

async function payloadSignature(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function electedTurnKey(context: TaskCreateReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: TaskCreateReplayContext, turnKey: string): string | undefined {
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
 * Prevents the exact same Gemini create call from issuing a second Google Tasks
 * POST for the full lifetime of the currently elected turn in this live runtime.
 * A newly elected turn clears the prior turn's replay state; entries never expire
 * by wall clock while their turn remains elected.
 *
 * This is deliberately not title/content deduplication and not a provider-state
 * mirror. Distinct call ids can create identical tasks intentionally. Because
 * Google Tasks does not accept client-chosen task/task-list ids, this fence
 * cannot recover an ambiguous create across a full page/runtime restart.
 */
export async function runTaskCreateOnce<T>(
  context: TaskCreateReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
  _now = Date.now(),
): Promise<T> {
  const turnKey = electedTurnKey(context);
  if (!turnKey) return operation();
  const key = replayKey(context, turnKey);
  if (!key) return operation();

  electTurn(turnKey);
  const signature = await payloadSignature(payload);
  const existing = replayEntries.get(key);
  if (existing) {
    if (existing.signature !== signature) throw new Error('Google Tasks create replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (replayEntries.size >= MAX_TASK_CREATE_REPLAYS) {
    throw new Error('Google Tasks create replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(operation);
  replayEntries.set(key, { signature, promise });
  return promise;
}

export function resetTaskCreateReplayForTests(): void {
  replayEntries.clear();
  activeTurnKey = undefined;
}
