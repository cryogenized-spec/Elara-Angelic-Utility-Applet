// ---------------------------------------------------------------------------
// Minimal ambient types for the Cloudflare runtime surface this worker uses.
// Hand-rolled and deliberately narrow (the repository keeps a disciplined
// dependency footprint — no @cloudflare/workers-types dependency): only the
// Durable Object, SQL storage, alarm, binding, and cron APIs actually
// consumed are declared here.
// ---------------------------------------------------------------------------

/** DO SQL cursor: iterable rows as plain objects keyed by column name. */
interface SqlCursor<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
}

interface DurableObjectSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlCursor<T>;
}

interface DurableObjectStorage {
  sql: DurableObjectSql;
  setAlarm(time: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<boolean>;
  transaction<T>(closure: () => Promise<T>): Promise<T>;
  /** Synchronous SQLite transaction: all exec() calls inside commit or roll back together. */
  transactionSync<T>(closure: () => T): T;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  id: DurableObjectId;
  container?: unknown;
  abortSignal?: AbortSignal;
}

interface DurableObjectId {
  name: string | null;
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  id: DurableObjectId;
}

interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(hex: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

/** Alarm retry metadata (at-least-once delivery: up to 6 automatic retries, 2 s backoff). */
interface DurableObjectAlarmInfo {
  isRetry: boolean;
  retryCount: number;
}

/** Cron invocation controller passed to the scheduled() handler. */
interface ScheduledController {
  cron?: string;
  scheduledTime: number;
  noRetry(): void;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface WorkflowInstance {
  readonly id: string;
  status(): Promise<{ status: string }>;
}

interface Workflow<Params = unknown> {
  create(options?: { id?: string; params?: Params }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

interface WorkflowEvent<T> {
  payload: Readonly<T>;
  timestamp: Date;
  instanceId: string;
}

interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

declare module 'cloudflare:workers' {
  export class DurableObject {
    readonly ctx: DurableObjectState;
    readonly env: Record<string, unknown>;
    constructor(ctx: DurableObjectState, env: Record<string, unknown>);
    fetch(request: Request): Promise<Response>;
  }

  export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    readonly env: Env;
    constructor(ctx: unknown, env: Env);
    run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
