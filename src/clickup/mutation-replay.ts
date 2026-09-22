import type { ClickUpArtifactApprovalSnapshot } from './attachment-authority';
import type { ClickUpToolName } from './tool-schema';

const MAX_CLICKUP_REPLAYS_PER_TURN = 128;
const MAX_CLICKUP_REPLAY_TURNS = 8;

export type ClickUpReplayTool =
  | 'clickup.createTask'
  | 'clickup.createTaskComment'
  | 'clickup.replyToComment'
  | 'clickup.attachArtifact';

export interface ClickUpMutationReplayContext {
  readonly tool: ClickUpReplayTool;
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, stableValue(record[key])]),
  );
}

async function payloadSignature(
  payload: unknown,
  approvedArtifact?: ClickUpArtifactApprovalSnapshot,
): Promise<string> {
  const artifactEvidence = approvedArtifact
    ? {
        artifactId: approvedArtifact.artifactId,
        artifactName: approvedArtifact.artifactName,
        uploadName: approvedArtifact.uploadName,
        mimeType: approvedArtifact.mimeType,
        metadataSize: approvedArtifact.metadataSize,
        payloadSize: approvedArtifact.payloadSize,
        sha256: approvedArtifact.sha256,
      }
    : undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue({
    payload,
    ...(artifactEvidence ? { approvedArtifact: artifactEvidence } : {}),
  })));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function electedTurnKey(context: ClickUpMutationReplayContext): string | undefined {
  const conversationId = context.conversationId?.trim();
  const messageId = context.messageId?.trim();
  const generationId = context.generationId?.trim();
  if (!conversationId || !messageId || !generationId) return undefined;
  return `${conversationId}\u0000${messageId}\u0000${generationId}`;
}

function replayKey(context: ClickUpMutationReplayContext): string | undefined {
  const callId = context.callId?.trim();
  if (!callId) return undefined;
  return `${context.tool}\u0000${callId}`;
}

function contextIsActive(
  context: Pick<ClickUpMutationReplayContext, 'signal' | 'isGenerationActive'>,
): boolean {
  return !context.signal?.aborted && context.isGenerationActive?.() !== false;
}

function assertTurnActive(context: ClickUpMutationReplayContext): void {
  if (!contextIsActive(context)) {
    throw new DOMException('The ClickUp mutation replay lost turn authority.', 'AbortError');
  }
}

function pruneInactiveTurns(): void {
  for (const [key, turn] of replayTurns) {
    if (!contextIsActive(turn)) replayTurns.delete(key);
  }
}

function replayTurn(context: ClickUpMutationReplayContext, turnKey: string): ReplayTurn {
  const existing = replayTurns.get(turnKey);
  if (existing) return existing;

  pruneInactiveTurns();
  if (replayTurns.size >= MAX_CLICKUP_REPLAY_TURNS) {
    throw new Error('ClickUp mutation replay turn capacity was exhausted; retry after older turns retire.');
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
 * Same-live-turn replay fence for ClickUp POST-style mutations that can create
 * duplicate provider state when an ambiguous response is replayed.
 *
 * Exact replays of the same Gemini call share the first promise/result/failure.
 * Reusing a call id with changed validated arguments (or a changed approved
 * attachment snapshot) fails closed. Distinct call ids remain independent so
 * two intentional identical comments/tasks/attachments are still possible.
 *
 * This is deliberately not provider-level exactly-once delivery. ClickUp does
 * not expose a general client idempotency key for these operations, so a full
 * browser/runtime restart after ambiguous provider acceptance still requires
 * human/provider reconciliation before retrying.
 */
export async function runClickUpMutationOnce<T>(
  context: ClickUpMutationReplayContext,
  payload: unknown,
  operation: () => Promise<T>,
  approvedArtifact?: ClickUpArtifactApprovalSnapshot,
): Promise<T> {
  const turnKey = electedTurnKey(context);
  const key = replayKey(context);
  if (!turnKey || !key) return operation();

  assertTurnActive(context);
  const signature = await payloadSignature(payload, approvedArtifact);
  assertTurnActive(context);

  const turn = replayTurn(context, turnKey);
  const existing = turn.entries.get(key);
  if (existing) {
    if (existing.signature !== signature) {
      throw new Error('ClickUp mutation replay changed arguments for the same tool call.');
    }
    return existing.promise as Promise<T>;
  }

  if (turn.entries.size >= MAX_CLICKUP_REPLAYS_PER_TURN) {
    throw new Error('ClickUp mutation replay capacity was exhausted for the current elected turn.');
  }

  const promise = Promise.resolve().then(() => {
    assertTurnActive(context);
    return operation();
  });
  turn.entries.set(key, { signature, promise });
  return promise;
}

export function isClickUpReplayTool(tool: ClickUpToolName): tool is ClickUpReplayTool {
  return tool === 'clickup.createTask'
    || tool === 'clickup.createTaskComment'
    || tool === 'clickup.replyToComment'
    || tool === 'clickup.attachArtifact';
}

export function resetClickUpMutationReplayForTests(): void {
  replayTurns.clear();
}
