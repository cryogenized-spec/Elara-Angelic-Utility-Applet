import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { describe, expect, it } from 'vitest';
import { ElaraDatabase, type StoredGeminiSettings, type StoredConversationFolder, type StoredFolderAssignment } from './conversation';
import type { ChatMessage, ConversationThread } from '../domain/chat';
import type { DurableMemory } from '../domain/memory';
import type { StoredWorkspaceShortcut } from './workspace-shortcuts';

class LegacyV6Database extends Dexie {
  messages!: Table<ChatMessage, string>;
  threads!: Table<ConversationThread, string>;
  settings!: Table<StoredGeminiSettings, string>;
  workspaceShortcuts!: Table<StoredWorkspaceShortcut, string>;
  folders!: Table<StoredConversationFolder, string>;
  folderAssignments!: Table<StoredFolderAssignment, string>;
  memories!: Table<DurableMemory, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ messages: 'id, createdAt, role' });
    this.version(2).stores({ messages: 'id, conversationId, createdAt, role', threads: 'id, updatedAt, archived' });
    this.version(3).stores({ messages: 'id, conversationId, createdAt, role', threads: 'id, updatedAt, archived', settings: 'id, updatedAt' });
    this.version(4).stores({ messages: 'id, conversationId, createdAt, role', threads: 'id, updatedAt, archived', settings: 'id, updatedAt', workspaceShortcuts: 'id, service, enabled, order, updatedAt' });
    this.version(5).stores({ messages: 'id, conversationId, createdAt, role', threads: 'id, updatedAt, archived', settings: 'id, updatedAt', workspaceShortcuts: 'id, service, enabled, order, updatedAt', folders: 'id, parentId, contextScope, updatedAt', folderAssignments: 'id, threadId, folderId, updatedAt' });
    this.version(6).stores({ messages: 'id, conversationId, createdAt, role', threads: 'id, updatedAt, archived', settings: 'id, updatedAt', workspaceShortcuts: 'id, service, enabled, order, updatedAt', folders: 'id, parentId, contextScope, updatedAt', folderAssignments: 'id, threadId, folderId, updatedAt', memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt' });
  }
}

describe('Dexie v6 to v7 migration', () => {
  it('preserves legacy records, creates artifact stores, and tolerates malformed legacy values', async () => {
    const name = `elara-migration-${crypto.randomUUID()}`;
    const legacy = new LegacyV6Database(name);
    await legacy.open();
    await legacy.threads.put({ id: 'legacy-thread', title: 'Legacy thread', createdAt: 10, updatedAt: 20, archived: false });
    await legacy.messages.bulkPut([
      { id: 'legacy-user', role: 'user', text: 'Preserved prompt', conversationId: 'legacy-thread', createdAt: 11 },
      { id: 'malformed-legacy', role: 'user', text: null as never, conversationId: 'legacy-thread', createdAt: 12 },
    ]);
    await legacy.settings.put({ id: 'gemini', model: 'gemini-3.8-flash', perModel: {}, updatedAt: 13 });
    await legacy.close();

    const upgraded = new ElaraDatabase(name);
    await upgraded.open();
    expect(await upgraded.threads.get('legacy-thread')).toMatchObject({ title: 'Legacy thread', updatedAt: 20 });
    expect(await upgraded.messages.get('legacy-user')).toMatchObject({ text: 'Preserved prompt', conversationId: 'legacy-thread' });
    expect(await upgraded.messages.get('malformed-legacy')).toMatchObject({ id: 'malformed-legacy', conversationId: 'legacy-thread' });
    expect(await upgraded.settings.get('gemini')).toMatchObject({ model: 'gemini-3.8-flash' });
    expect(await upgraded.artifactMetadata.count()).toBe(0);
    expect(await upgraded.artifactBlobs.count()).toBe(0);
    await upgraded.transaction('rw', upgraded.threads, upgraded.messages, upgraded.artifactMetadata, upgraded.artifactBlobs, async () => {
      await upgraded.messages.add({ id: 'post-migration', role: 'assistant', text: 'Still operational', conversationId: 'legacy-thread', createdAt: 30 });
      await upgraded.threads.update('legacy-thread', { updatedAt: 30 });
      await upgraded.artifactMetadata.add({ id: 'post-migration-artifact', artifactType: 'generated', name: 'empty.txt', mimeType: 'text/plain', size: 0, createdAt: 30, provenance: 'generated_tool', status: 'pending' });
    });
    expect(await upgraded.messages.get('post-migration')).toMatchObject({ text: 'Still operational' });
    expect(await upgraded.artifactMetadata.get('post-migration-artifact')).toMatchObject({ status: 'pending' });
    await upgraded.delete();
  });
});
