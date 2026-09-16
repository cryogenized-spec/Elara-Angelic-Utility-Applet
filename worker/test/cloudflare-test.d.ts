// Typed test bindings: the real worker Env surface under test.
declare module 'cloudflare:test' {
  import type { Env } from '../src/entry';
  export const env: Env;
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  export const fetchMock: {
    activate(): void;
    disableNetConnect(): void;
    assertNoPendingInterceptors(): void;
    get(origin: string): {
      intercept(options: { path: string; method?: string }): {
        reply(statusCode: number, data: string, responseOptions?: { headers?: Record<string, string> }): unknown;
      };
    };
  };
  /** Deletes all Durable Object instances and their storage (test isolation). */
  export function reset(): Promise<void>;
  /** Creates the ScheduledController for invoking a worker's scheduled() handler. */
  export function createScheduledController(options?: { cron?: string; scheduledTime?: number; noRetry?: boolean }): ScheduledController;
  /** Creates an ExecutionContext for invoking worker handlers in tests. */
  export function createExecutionContext(): ExecutionContext;
  /** Immediately runs and removes the DO alarm if one is scheduled; true if it ran. */
  export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>;
}
