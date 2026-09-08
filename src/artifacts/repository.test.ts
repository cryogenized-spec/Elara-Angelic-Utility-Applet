import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { artifactRepository } from './repository';
import { db } from '../persistence/conversation';
import type { ChatMessage } from '../domain/chat';

describe('artifact repository', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.messages, db.threads, db.artifactMetadata, db.artifactBlobs, async () => {
      await db.messages.clear();
      await db.threads.clear();
      await db.artifactMetadata.clear();
      await db.artifactBlobs.clear();
      await db.threads.put({ id: 'thread-1', title: 'Test', createdAt: 1, updatedAt: 1, archived: false });
    });
  });

  it('creates and retrieves an attachment Blob with metadata', async () => {
    const data = new Blob(['hello'], { type: 'text/plain' });
    const created = await artifactRepository.create({ artifactType: 'attachment', name: 'receipt.txt', mimeType: 'text/plain', kind: 'text', data });
    expect(created).toMatchObject({ name: 'receipt.txt', mimeType: 'text/plain', size: 5, status: 'processing', provenance: 'user_upload' });
    if (created.artifactType !== 'attachment') throw new Error('Expected attachment');
    const loaded = await artifactRepository.get(created.id);
    expect(loaded.artifactType).toBe('attachment');
    expect(await new Response((loaded as typeof created).data).text()).toBe('hello');
  });

  it('updates lifecycle status and metadata without changing the Blob', async () => {
    const created = await artifactRepository.create({ artifactType: 'attachment', name: 'photo.png', mimeType: 'image/png', kind: 'image', data: new Blob(['bytes'], { type: 'image/png' }) });
    await artifactRepository.setStatus(created.id, 'ready');
    const updated = await artifactRepository.updateMetadata(created.id, { name: 'renamed.png' });
    expect(updated.name).toBe('renamed.png');
    expect(updated.status).toBe('ready');
    if (updated.artifactType !== 'attachment') throw new Error('Expected attachment');
    expect(await new Response(updated.data).text()).toBe('bytes');
  });

  it('reports a missing attachment payload instead of fabricating an empty Blob', async () => {
    const artifact = await artifactRepository.create({ artifactType: 'attachment', name: 'missing.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['payload']) });
    await db.artifactBlobs.delete(artifact.id);
    await expect(artifactRepository.get(artifact.id)).rejects.toMatchObject({ code: 'ARTIFACT_STORAGE_FAILED' });
    await expect(artifactRepository.list()).rejects.toMatchObject({ code: 'ARTIFACT_STORAGE_FAILED' });
    expect(await db.artifactBlobs.get(artifact.id)).toBeUndefined();
  });

  it('reports corrupt metadata and ready artifacts with missing output', async () => {
    const generated = await artifactRepository.create({ artifactType: 'generated', name: 'missing.pdf', mimeType: 'application/pdf', sourceCode: { language: 'lualatex', content: '\\documentclass{article}' }, status: 'pending' });
    const generatedMetadata = await db.artifactMetadata.get(generated.id);
    await db.artifactMetadata.put({ ...generatedMetadata!, status: 'ready' });
    await expect(artifactRepository.get(generated.id)).rejects.toMatchObject({ code: 'ARTIFACT_STORAGE_FAILED' });

    const source = await artifactRepository.create({ artifactType: 'attachment', name: 'corrupt.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['payload']) });
    await db.artifactMetadata.put({ ...await db.artifactMetadata.get(source.id), artifactType: 'corrupt' } as never);
    await expect(artifactRepository.get(source.id)).rejects.toMatchObject({ code: 'ARTIFACT_STORAGE_FAILED' });
  });

  it('associates one artifact with multiple messages without duplicating storage', async () => {
    const first: ChatMessage = { id: 'message-1', role: 'user', text: 'one', conversationId: 'thread-1', createdAt: 1 };
    const second: ChatMessage = { id: 'message-2', role: 'user', text: 'two', conversationId: 'thread-1', createdAt: 2 };
    await db.messages.bulkPut([first, second]);
    const artifact = await artifactRepository.create({ artifactType: 'attachment', name: 'a.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['same']) });
    await artifactRepository.attachToMessage(artifact.id, first.id, 'thread-1');
    await artifactRepository.attachToMessage(artifact.id, second.id, 'thread-1');
    expect((await db.messages.get(first.id))?.attachments).toEqual([artifact.id]);
    expect((await db.messages.get(second.id))?.attachments).toEqual([artifact.id]);
    expect(await db.artifactBlobs.count()).toBe(1);
    await artifactRepository.detachFromMessage(artifact.id, first.id, 'thread-1');
    expect((await db.messages.get(first.id))?.attachments).toBeUndefined();
    expect((await db.messages.get(second.id))?.attachments).toEqual([artifact.id]);
  });

  it('deletes metadata, Blob, and all message references', async () => {
    const first: ChatMessage = { id: 'message-1', role: 'user', text: 'one', conversationId: 'thread-1', createdAt: 1 };
    const second: ChatMessage = { id: 'message-2', role: 'assistant', text: 'two', conversationId: 'thread-1', createdAt: 2 };
    await db.messages.bulkPut([first, second]);
    const artifact = await artifactRepository.create({ artifactType: 'generated', name: 'output.pdf', mimeType: 'application/pdf', outputBlob: new Blob(['pdf'], { type: 'application/pdf' }), status: 'ready', toolName: 'document.create_pdf' });
    await artifactRepository.attachToMessage(artifact.id, first.id, 'thread-1');
    await artifactRepository.attachToMessage(artifact.id, second.id, 'thread-1');
    await artifactRepository.delete(artifact.id);
    await expect(artifactRepository.get(artifact.id)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
    expect(await db.artifactBlobs.count()).toBe(0);
    expect((await db.messages.get(first.id))?.artifacts).toBeUndefined();
    expect((await db.messages.get(second.id))?.artifacts).toBeUndefined();
  });
});
