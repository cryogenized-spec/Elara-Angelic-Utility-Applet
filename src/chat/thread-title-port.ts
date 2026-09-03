export interface ThreadTitlePort {
  generateTitle(input: string): Promise<string>;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'from', 'how', 'i', 'in', 'is', 'me', 'my', 'of', 'on', 'please', 'show', 'the', 'to', 'today', 'what', 'with', 'you',
]);

function fallbackTitle(input: string): string {
  const words = input
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word.toLocaleLowerCase()))
    .slice(0, 7);

  if (words.length >= 3) return words.map((word) => word[0]?.toLocaleUpperCase() + word.slice(1)).join(' ');

  const fallback = input.replace(/\s+/g, ' ').trim().slice(0, 48);
  return fallback ? `Chat about ${fallback}` : 'New conversation';
}

export const demoThreadTitlePort: ThreadTitlePort = {
  async generateTitle(input: string) {
    return fallbackTitle(input).split(/\s+/).slice(0, 10).join(' ');
  },
};
