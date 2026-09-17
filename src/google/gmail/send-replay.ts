const MAX_GMAIL_SEND_REPLAYS = 64;

export interface GmailSendReplayContext {
  readonly tool: 'gmail.sendMessage' | 'gmail.replyMessage';
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

function electedTurnKey(context: GmailSendReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: GmailSendReplayContext, turnKey: string): string | undefined {
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
 * Prevents the exact same Gmail send/reply tool call from issuing a second
 * messages.send request for the lifetime of the currently elected turn.
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
  const key = replayKey(context, turnKey);
  if (!key) return operation();

  electTurn(turnKey);
  const signature = await payloadSignature(payload);
  const existing = replayEntries.get(key);
  if (existing) {
    if (existing.signature !== signature) throw new Error('Gmail send replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (replayEntries.size >= MAX_GMAIL_SEND_REPLAYS) {
    throw new Error('Gmail send replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(operation);
  replayEntries.set(key, { signature, promise });
  return promise;
}

export function resetGmailSendReplayForTests(): void {
  replayEntries.clear();
  activeTurnKey = undefined;
}
