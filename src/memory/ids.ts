export function createMemoryId(): string {
  return `memory_${crypto.randomUUID()}`;
}
