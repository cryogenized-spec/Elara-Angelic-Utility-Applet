import { formatMemoryContext, retrieveMemories } from '../memory/store';
import { ACTIVE_THREAD_KEY, resolveActiveMemoryScope } from '../memory/scope';

/** Build a bounded, folder-aware durable-memory context for the current thread. */
export async function loadMemoryContext(query: string): Promise<string> {
  if (typeof window === 'undefined') return '';
  const threadId = window.localStorage.getItem(ACTIVE_THREAD_KEY);
  if (!threadId) return '';

  // Scope resolution is shared with the memory.save write path so reads and
  // writes always agree on which folder context is active.
  const scope = await resolveActiveMemoryScope({ query });
  return formatMemoryContext(await retrieveMemories(scope));
}

/**
 * Compose durable memory into application context. Retrieval failures are
 * deliberately swallowed so a local-memory problem can never block Gemini.
 */
export async function loadMemoryContextSafely(query: string, loader: (query: string) => Promise<string> = loadMemoryContext): Promise<string> {
  try {
    return await loader(query);
  } catch {
    return '';
  }
}

/** Keep durable memory explicitly contextual and separate from Elara's identity instructions. */
export function appendMemoryContext(systemInstruction: string, memoryContext: string): string {
  const memory = memoryContext.trim();
  if (!memory) return systemInstruction;
  const base = systemInstruction.trim();
  return base ? `${base}\n\n[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}` : `[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}`;
}

/**
 * Build the final system instruction without making memory availability a
 * prerequisite for the provider request.
 */
export async function composeSystemInstruction(systemInstruction: string | undefined, query: string): Promise<string | undefined> {
  const contextual = appendMemoryContext(systemInstruction ?? '', await loadMemoryContextSafely(query));
  return contextual.trim() ? contextual : undefined;
}
