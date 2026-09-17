const TASK_CREATE_REPLAY_TTL_MS = 10 * 60 * 1000;
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
  readonly expiresAt: number;
  readonly promise: Promise<unknown>;
}

const replayEntries = new Map<string, ReplayEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of replayEntries) {
    if (entry.expiresAt <= now) replayEntries.delete(key);
  }
}

function reserveCapacity(): void {
  while (replayEntries.size >= MAX_TASK_CREATE_REPLAYS) {
    const oldest = replayEntries.keys().next().value as string | undefined;
    if (!oldest) return;
    replayEntries.delete(oldest);
  }
}

async function payloadSignature(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function replayKey(context: TaskCreateReplayContext): string | undefined {
  const callId = context.callId?.trim();
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!callId || !conversationId || !messageId || !generationId) return undefined;
  return `${context.tool}\u0000${conversationId}\u0000${messageId}\u0000${generationId}\u0000${callId}`;
}

/**
 * Prevents the exact same Gemini create call from issuing a second Google Tasks
 * POST while the elected turn is still represented by this live runtime.
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
  now = Date.now(),
): Promise<T> {
  const key = replayKey(context);
  if (!key) return operation();

  pruneExpired(now);
  const signature = await payloadSignature(payload);
  const existing = replayEntries.get(key);
  if (existing) {
    if (existing.signature !== signature) throw new Error('Google Tasks create replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  reserveCapacity();
  const promise = Promise.resolve().then(operation);
  replayEntries.set(key, { signature, expiresAt: now + TASK_CREATE_REPLAY_TTL_MS, promise });
  return promise;
}

export function resetTaskCreateReplayForTests(): void {
  replayEntries.clear();
}
