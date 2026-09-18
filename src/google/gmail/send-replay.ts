const MAX_GMAIL_SEND_REPLAYS_PER_TURN = 64;
const MAX_GMAIL_REPLAY_TURNS = 8;

export interface GmailSendReplayContext {
  readonly tool: 'gmail.sendMessage' | 'gmail.replyMessage';
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

function electedTurnKey(context: GmailSendReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: GmailSendReplayContext): string | undefined {
  const callId = context.callId?.trim();
  if (!callId) return undefined;
  return `${context.tool}\u0000${callId}`;
}

function contextIsActive(context: Pick<GmailSendReplayContext, 'signal' | 'isGenerationActive'>): boolean {
  return !context.signal?.aborted && context.isGenerationActive?.() !== false;
}

function assertReplayTurnActive(context: GmailSendReplayContext): void {
  if (!contextIsActive(context)) {
    throw new DOMException('The Gmail send replay lost turn authority.', 'AbortError');
  }
}

function pruneInactiveTurns(): void {
  for (const [key, turn] of replayTurns) {
    if (!contextIsActive(turn)) replayTurns.delete(key);
  }
}

function replayTurn(context: GmailSendReplayContext, turnKey: string): ReplayTurn {
  const existing = replayTurns.get(turnKey);
  if (existing) return existing;

  pruneInactiveTurns();
  if (replayTurns.size >= MAX_GMAIL_REPLAY_TURNS) {
    throw new Error('Gmail send replay turn capacity was exhausted; retry after older turns retire.');
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
 * Prevents the exact same Gmail send/reply tool call from issuing a second
 * messages.send request for the lifetime of its elected turn.
 *
 * Replay state is independently keyed by turn. A stale or slower generation
 * never clears another live turn's entries. Inactive turn buckets are pruned
 * opportunistically; active buckets are never evicted to make room.
 *
 * This is a live-runtime replay fence, not a provider idempotency authority.
 * Google Gmail messages.send does not expose a client-chosen resource id that
 * Elara can deterministically reconcile after a full page/runtime restart.
 */
export async function runGmailSendOnce<T>(
  context: GmailSendReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
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
    if (existing.signature !== signature) throw new Error('Gmail send replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (turn.entries.size >= MAX_GMAIL_SEND_REPLAYS_PER_TURN) {
    throw new Error('Gmail send replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(() => {
    assertReplayTurnActive(context);
    return operation();
  });
  turn.entries.set(key, { signature, promise });
  return promise;
}

export function resetGmailSendReplayForTests(): void {
  replayTurns.clear();
}
