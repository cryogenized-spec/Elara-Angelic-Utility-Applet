export type DemoStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'completed' }
  | { type: 'failed'; message: string };

export const demoTurnPort = {
  async *streamReply(input: string): AsyncGenerator<DemoStreamEvent> {
    const reply = `Demo response received: ${input}`;
    for (const chunk of reply.match(/.{1,12}/g) ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 12));
      yield { type: 'text-delta', text: chunk };
    }
    yield { type: 'completed' };
  },
};
