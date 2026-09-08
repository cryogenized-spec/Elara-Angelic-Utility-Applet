import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, upload, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  upload: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));

import { geminiTurnPort } from './provider';
import { artifactRepository } from '../artifacts/repository';
import { db } from '../persistence/conversation';

async function* events(...items: unknown[]) { for (const item of items) yield item; }

describe('Gemini multimodal artifact adapter', () => {
  beforeEach(async () => {
    createInteraction.mockReset();
    upload.mockReset();
    getGeminiApiKey.mockReset();
    getGeminiLockboxStatus.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction }; files: { upload: typeof upload } }) {
      this.interactions = { create: createInteraction };
      this.files = { upload };
    });
    getGeminiLockboxStatus.mockResolvedValue('unlocked');
    getGeminiApiKey.mockResolvedValue('test-key');
    await db.artifactMetadata.clear();
    await db.artifactBlobs.clear();
  });

  it('does not persist a stale oversized-upload result after generation supersession', async () => {
    const artifact = await artifactRepository.create({ artifactType: 'attachment', name: 'large.bin', mimeType: 'application/octet-stream', kind: 'document', data: new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'application/octet-stream' }), status: 'ready' });
    let releaseUpload!: (value: unknown) => void;
    upload.mockReturnValue(new Promise((resolve) => { releaseUpload = resolve; }));
    let active = true;
    const isGenerationActive = vi.fn(() => active);
    const pending = (async () => { const collected: unknown[] = []; for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Inspect this.', attachments: [artifact.id], generationId: 'generation-a', isGenerationActive }, undefined)) collected.push(event); return collected; })();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    active = false;
    releaseUpload({ uri: 'https://example.test/stale', expirationTime: new Date(Date.now() + 86_400_000).toISOString() });
    const collected = await pending;
    expect(collected.at(-1)).toMatchObject({ type: 'cancelled' });
    expect((await db.artifactMetadata.get(artifact.id))?.remoteRef).toBeUndefined();
  });

  it('maps a local image artifact to inline multimodal input without exposing its ID', async () => {
    const artifact = await artifactRepository.create({
      artifactType: 'attachment',
      name: 'photo.png',
      mimeType: 'image/png',
      kind: 'image',
      data: new Blob(['image bytes'], { type: 'image/png' }),
      status: 'ready',
    });
    createInteraction.mockResolvedValue(events(
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed' } },
    ));

    for await (const _event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'What is here?', attachments: [artifact.id] })) { /* consume */ }

    const request = createInteraction.mock.calls[0][0] as { input: unknown };
    expect(request.input).toEqual([
      { type: 'text', text: 'What is here?' },
      expect.objectContaining({ type: 'image', mime_type: 'image/png', data: expect.any(String) }),
    ]);
    expect(JSON.stringify(request.input)).not.toContain(artifact.id);
  });
});
