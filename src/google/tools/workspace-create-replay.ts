const MAX_CREATE_REPLAYS_PER_TURN = 128;
const MAX_REPLAY_TURNS = 8;

export type WorkspaceCreateTool = 'docs.createDocument' | 'sheets.createSpreadsheet' | 'sheets.addSheet';

export interface WorkspaceCreateReplayContext {
  readonly tool: WorkspaceCreateTool;
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

function electedTurnKey(context: WorkspaceCreateReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: WorkspaceCreateReplayContext): string | undefined {
  const callId = context.callId?.trim();
  if (!callId) return undefined;
  return `${context.tool}\u0000${callId}`;
}

function contextIsActive(context: Pick<WorkspaceCreateReplayContext, 'signal' | 'isGenerationActive'>): boolean {
  return !context.signal?.aborted && context.isGenerationActive?.() !== false;
}

function assertTurnActive(context: WorkspaceCreateReplayContext): void {
  if (!contextIsActive(context)) throw new DOMException('The Workspace create replay lost turn authority.', 'AbortError');
}

function pruneInactiveTurns(): void {
  for (const [key, turn] of replayTurns) {
    if (!contextIsActive(turn)) replayTurns.delete(key);
  }
}

function replayTurn(context: WorkspaceCreateReplayContext, turnKey: string): ReplayTurn {
  const existing = replayTurns.get(turnKey);
  if (existing) return existing;

  pruneInactiveTurns();
  if (replayTurns.size >= MAX_REPLAY_TURNS) {
    throw new Error('Google Workspace create replay turn capacity was exhausted; retry after older turns retire.');
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
 * Same-live-turn replay fence for creation operations that do not expose a
 * provider-supported client-chosen resource id. Exact replays share the first
 * result/ambiguous failure; changed arguments under the same call id fail
 * closed. This deliberately does not claim exactly-once behavior after a full
 * runtime restart.
 */
export async function runWorkspaceCreateOnce<T>(
  context: WorkspaceCreateReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const turnKey = electedTurnKey(context);
  const key = replayKey(context);
  if (!turnKey || !key) return operation();

  assertTurnActive(context);
  const signature = await payloadSignature(payload);
  assertTurnActive(context);
  const turn = replayTurn(context, turnKey);
  const existing = turn.entries.get(key);
  if (existing) {
    if (existing.signature !== signature) throw new Error('Google Workspace create replay changed arguments for the same tool call.');
    return existing.promise as Promise<T>;
  }

  if (turn.entries.size >= MAX_CREATE_REPLAYS_PER_TURN) {
    throw new Error('Google Workspace create replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(() => {
    assertTurnActive(context);
    return operation();
  });
  turn.entries.set(key, { signature, promise });
  return promise;
}

export function resetWorkspaceCreateReplayForTests(): void {
  replayTurns.clear();
}
