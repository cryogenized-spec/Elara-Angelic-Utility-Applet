export type DemoStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'completed'; durationMs: number; executionSteps: string[] }
  | { type: 'failed'; message: string };

export const demoTurnPort = {
  async *streamReply(input: string): AsyncGenerator<DemoStreamEvent> {
    const reply = `Demo response received: ${input}`;
    const startedAt = performance.now();
    for (const chunk of reply.match(/.{1,12}/g) ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 12));
      yield { type: 'text-delta', text: chunk };
    }
    yield {
      type: 'completed',
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      executionSteps: [
        'Accepted the message and prepared the turn.',
        'Generated a response through the active chat transport.',
        'Finalized the streamed assistant message.',
      ],
    };
  },
};
