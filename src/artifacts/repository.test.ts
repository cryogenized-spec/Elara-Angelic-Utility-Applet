import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { artifactRepository } from './repository';
import { db, deleteMessage, loadConversation } from '../persistence/conversation';
import type { ChatMessage } from '../domain/chat';

function deferredBlob(text: string, type: string): { blob: Blob; release: () => void } {
  const blob = new Blob([text], { type });
  let release!: () => void;
  Object.defineProperty(blob, 'arrayBuffer', {
    configurable: true,
    value: () => new Promise<ArrayBuffer>((resolve) => {
      release = () => resolve(new TextEncoder().encode(text).buffer);
    }),
  });
  return { blob, release: () => release() };
}

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
    expect(await (loaded as typeof created).data.text()).toBe('hello');
  });

  it('updates lifecycle status and metadata without changing the Blob', async () => {
    const created = await artifactRepository.create({ artifactType: 'attachment', name: 'photo.png', mimeType: 'image/png', kind: 'image', data: new Blob(['bytes'], { type: 'image/png' }) });
    await artifactRepository.setStatus(created.id, 'ready');
    const updated = await artifactRepository.updateMetadata(created.id, { name: 'renamed.png' });
    expect(updated.name).toBe('renamed.png');
    expect(updated.status).toBe('ready');
    if (updated.artifactType !== 'attachment') throw new Error('Expected attachment');
    expect(await updated.data.text()).toBe('bytes');
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

  it('atomically appends a message with deduplicated artifact IDs and preserves repeated prompt lineage', async () => {
    const first = await artifactRepository.create({ artifactType: 'attachment', name: 'first.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['first']) });
    const second = await artifactRepository.create({ artifactType: 'attachment', name: 'second.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['second']) });
    const firstMessage: ChatMessage = { id: 'repeated-prompt-1', role: 'user', text: 'same prompt', conversationId: 'thread-1', createdAt: 10 };
    const secondMessage: ChatMessage = { id: 'repeated-prompt-2', role: 'user', text: 'same prompt', conversationId: 'thread-1', createdAt: 11 };
    await artifactRepository.appendMessageWithArtifacts(firstMessage, 'thread-1', [first.id, first.id]);
    await artifactRepository.appendMessageWithArtifacts(secondMessage, 'thread-1', [second.id]);
    expect((await db.messages.get(firstMessage.id))?.attachments).toEqual([first.id]);
    expect((await db.messages.get(secondMessage.id))?.attachments).toEqual([second.id]);
  });

  it('rolls back the message when any attachment is missing or the transaction is interrupted', async () => {
    const valid = await artifactRepository.create({ artifactType: 'attachment', name: 'valid.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['valid']) });
    await expect(artifactRepository.appendMessageWithArtifacts({ id: 'missing-message', role: 'user', text: 'missing', conversationId: 'thread-1', createdAt: 1 }, 'thread-1', [valid.id, 'missing-artifact'])).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
    expect(await db.messages.get('missing-message')).toBeUndefined();
    const interrupt = (_changes: unknown, primKey: string) => { if (primKey === 'thread-1') throw new Error('simulated interruption'); };
    db.threads.hook('updating').subscribe(interrupt);
    try {
      await expect(artifactRepository.appendMessageWithArtifacts({ id: 'interrupted-message', role: 'user', text: 'interrupted', conversationId: 'thread-1', createdAt: 2 }, 'thread-1', [valid.id])).rejects.toMatchObject({ code: 'ARTIFACT_STORAGE_FAILED' });
    } finally {
      db.threads.hook('updating').unsubscribe(interrupt);
    }
    expect(await db.messages.get('interrupted-message')).toBeUndefined();
  });

  it('reloads an atomically associated message and keeps separately-owned artifacts after message deletion', async () => {
    const artifact = await artifactRepository.create({ artifactType: 'attachment', name: 'reload.txt', mimeType: 'text/plain', kind: 'text', data: new Blob(['reload']) });
    const message: ChatMessage = { id: 'reload-message', role: 'user', text: 'reload', conversationId: 'thread-1', createdAt: 1 };
    await artifactRepository.appendMessageWithArtifacts(message, 'thread-1', [artifact.id]);
    db.close();
    await db.open();
    expect((await loadConversation('thread-1')).messages.find((item) => item.id === message.id)?.attachments).toEqual([artifact.id]);
    await deleteMessage(message.id, 'thread-1');
    expect(await artifactRepository.get(artifact.id)).toMatchObject({ id: artifact.id });
    expect(await db.messages.get(message.id)).toBeUndefined();
  });

  it('atomically creates and associates a derived artifact only while its parent and message exist', async () => {
    const source = await artifactRepository.create({ artifactType: 'attachment', name: 'source.png', mimeType: 'image/png', kind: 'image', data: new Blob(['source']), status: 'ready' });
    const message: ChatMessage = { id: 'ocr-message', role: 'assistant', text: 'response', conversationId: 'thread-1', createdAt: 1 };
    await db.messages.put(message);
    const derived = await artifactRepository.createAndAttach({ artifactType: 'derived', name: 'ocr.txt', mimeType: 'text/plain', sourceCode: { language: 'markdown', content: 'recognized' }, outputBlob: new Blob(['recognized'], { type: 'text/plain' }), parentArtifactIds: [source.id], transformation: 'image-to-ocr-text', sourceMessageId: message.id, status: 'ready', operationId: 'ocr-operation' }, message.id, 'thread-1');
    expect((await db.messages.get(message.id))?.artifacts).toEqual([derived.id]);
    await artifactRepository.delete(source.id);
    await expect(artifactRepository.createAndAttach({ artifactType: 'derived', name: 'stale.txt', mimeType: 'text/plain', outputBlob: new Blob(['stale']), parentArtifactIds: [source.id], transformation: 'image-to-ocr-text', sourceMessageId: message.id, status: 'ready' }, message.id, 'thread-1')).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
  });

  it('rolls back an OCR association when validity flips during awaited payload preparation', async () => {
    const source = await artifactRepository.create({ artifactType: 'attachment', name: 'source.png', mimeType: 'image/png', kind: 'image', data: new Blob(['source']), status: 'ready' });
    const message: ChatMessage = { id: 'ocr-race-message', role: 'assistant', text: 'response', conversationId: 'thread-1', createdAt: 1 };
    await db.messages.put(message);
    const pending = deferredBlob('recognized late', 'text/plain');
    let valid = true;
    const operationId = 'ocr-race-operation';
    const association = artifactRepository.createAndAttach({ artifactType: 'derived', name: 'ocr-race.txt', mimeType: 'text/plain', outputBlob: pending.blob, parentArtifactIds: [source.id], transformation: 'image-to-ocr-text', sourceMessageId: message.id, status: 'ready', operationId }, message.id, 'thread-1', { operationId, expectedStatus: 'ready', isValid: () => valid });
    valid = false;
    pending.release();
    await expect(association).rejects.toMatchObject({ code: 'ARTIFACT_OPERATION_STALE' });
    expect(await db.artifactMetadata.count()).toBe(1);
    expect(await db.artifactBlobs.count()).toBe(1);
    expect((await db.messages.get(message.id))?.artifacts).toBeUndefined();
  });

  it('does not persist stale compiler output prepared across an awaited operation or transition it to ready', async () => {
    const artifact = await artifactRepository.create({ artifactType: 'generated', name: 'race-output.pdf', mimeType: 'application/pdf', sourceCode: { language: 'lualatex', content: '\\documentclass{article}' }, status: 'processing', operationId: 'compiler-race-operation' });
    const pending = deferredBlob('late pdf', 'application/pdf');
    let valid = true;
    const guard = { operationId: 'compiler-race-operation', expectedStatus: 'processing' as const, isValid: () => valid };
    const update = artifactRepository.updateMetadata(artifact.id, { outputBlob: pending.blob, compilationLog: 'late' }, guard);
    valid = false;
    pending.release();
    await expect(update).rejects.toMatchObject({ code: 'ARTIFACT_OPERATION_STALE' });
    expect(await db.artifactBlobs.get(artifact.id)).toBeUndefined();
    expect(await db.artifactMetadata.get(artifact.id)).toMatchObject({ status: 'processing', compilationLog: undefined });
    await expect(artifactRepository.setStatus(artifact.id, 'ready', undefined, guard)).rejects.toMatchObject({ code: 'ARTIFACT_OPERATION_STALE' });
    expect((await db.artifactMetadata.get(artifact.id))?.status).toBe('processing');
  });

  it('rejects stale lifecycle finalization after supersession', async () => {
    const artifact = await artifactRepository.create({ artifactType: 'generated', name: 'race.pdf', mimeType: 'application/pdf', sourceCode: { language: 'lualatex', content: '\\documentclass{article}' }, operationId: 'operation-a' });
    await artifactRepository.setStatus(artifact.id, 'processing', undefined, { operationId: 'operation-a', expectedStatus: 'pending' });
    await artifactRepository.beginOperation(artifact.id, 'operation-b', 'processing');
    await expect(artifactRepository.setStatus(artifact.id, 'ready', undefined, { operationId: 'operation-a', expectedStatus: 'processing' })).rejects.toMatchObject({ code: 'ARTIFACT_OPERATION_STALE' });
    expect((await db.artifactMetadata.get(artifact.id))?.status).toBe('processing');
    await artifactRepository.setStatus(artifact.id, 'failed', { code: 'DOCUMENT_COMPILATION_FAILED', message: 'superseded' }, { operationId: 'operation-b', expectedStatus: 'processing' });
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
