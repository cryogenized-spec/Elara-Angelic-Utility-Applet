import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../domain/chat';
import type { MediaItem } from '../../domain/media';
import { hasRenderableMessageContent } from './message-content';

const MEDIA: MediaItem = {
  provider: 'youtube',
  id: 'video-1',
  kind: 'video',
  title: 'Video',
  webUrl: 'https://www.youtube.com/watch?v=video-1',
};

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    text: '',
    createdAt: 1,
    ...patch,
  };
}

describe('hasRenderableMessageContent', () => {
  it('treats blank prose with no structured payload as empty', () => {
    expect(hasRenderableMessageContent(message())).toBe(false);
    expect(hasRenderableMessageContent(message({ text: '   \n\t ' }))).toBe(false);
  });

  it('treats prose as renderable', () => {
    expect(hasRenderableMessageContent(message({ text: 'Hello.' }))).toBe(true);
  });

  it('treats media-only, artifact-only and attachment-only messages as renderable', () => {
    expect(hasRenderableMessageContent(message({ media: [MEDIA] }))).toBe(true);
    expect(hasRenderableMessageContent(message({ artifacts: ['artifact-1'] }))).toBe(true);
    expect(hasRenderableMessageContent(message({ attachments: ['attachment-1'] }))).toBe(true);
  });

  it('does not mistake empty structured arrays for content', () => {
    expect(hasRenderableMessageContent(message({ media: [], artifacts: [], attachments: [] }))).toBe(false);
  });
});
