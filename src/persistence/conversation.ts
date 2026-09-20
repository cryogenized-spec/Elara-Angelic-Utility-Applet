import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ConversationState, ConversationThread } from '../domain/chat';
import { freshMediaItems } from '../domain/media';
import type { DurableMemory } from '../domain/memory';
import type { StoredArtifactBlob, StoredArtifactMetadata } from '../domain/artifact';
import { DEFAULT_GEMINI_MODEL, getGeminiModel } from '../gemini/model-registry';
import { defaultsForModel, normalizeGeminiSettings, type GeminiSettings } from '../gemini/settings-engine';
import type { StoredWorkspaceShortcut } from './workspace-shortcuts';

const PRIMARY_ID = 'primary';
const DEFAULT_TITLE = 'New conversation';
const GEMINI_SETTINGS_ID = 'gemini';
const FOLDER_STORAGE_KEY = 'elara.conversation-folders.v1';

interface StoredThread extends ConversationThread { title: string; }
export interface StoredGeminiSettings {
  id: typeof GEMINI_SETTINGS_ID;
  model: string;
  perModel: Record<string, GeminiSettings>;
  updatedAt: number;
}

export interface StoredGooglePickerAdmissions {
  id: 'google-picker-admissions';
  files: Array<{ id: string; name: string; mimeType?: string; url?: string; admittedAt: number }>;
  revokedFileIds: string[];
  updatedAt: number;
}

export interface StoredGeminiQuotaLedger {
  id: 'gemini-quota-ledger-v1';
  entries: Array<{
    id: string;
    startedAt: number;
    reservedInputTokens: number;
    actualInputTokens?: number;
  }>;
  updatedAt: number;
}

export interface StoredConversationFolder {
  id: string;
  name: string;
  parentId: string | null;
  contextScope: 'folder' | 'global';
  createdAt: number;
  updatedAt: number;
}

export interface StoredFolderAssignment {
  id: string;
  threadId: string;
  folderId: string | null;
  updatedAt: number;
}

function stripLegacyEmbedUrls(value: unknown): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false };
  const entries: readonly unknown[] = value;
  let changed = false;
  const migrated = entries.map((entry): unknown => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'embedUrl')) return entry;
    const { embedUrl: _retired, ...withoutEmbedUrl } = record;
    changed = true;
    return withoutEmbedUrl;
  });
  return { value: migrated, changed };
}

export class ElaraDatabase extends Dexie {
  messages!: Table<ChatMessage, string>;
  threads!: Table<StoredThread, string>;
  settings!: Table<StoredGeminiSettings | StoredGooglePickerAdmissions | StoredGeminiQuotaLedger, string>;
  workspaceShortcuts!: Table<StoredWorkspaceShortcut, string>;
  folders!: Table<StoredConversationFolder, string>;
  folderAssignments!: Table<StoredFolderAssignment, string>;
  memories!: Table<DurableMemory, string>;
  artifactMetadata!: Table<StoredArtifactMetadata, string>;
  artifactBlobs!: Table<StoredArtifactBlob, string>;

  constructor(name = 'elara-angelic-utility-applet') {
    super(name);
    this.version(1).stores({ messages: 'id, createdAt, role' });
    this.version(2).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
    }).upgrade(async (transaction) => {
      await transaction.table('messages').toCollection().modify((message: ChatMessage) => {
        if (!message.conversationId) message.conversationId = PRIMARY_ID;
      });
    });
    this.version(3).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
    });
    this.version(4).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
    });
    this.version(5).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
    }).upgrade(async (transaction) => {
      const folderTable = transaction.table('folders');
      const assignmentTable = transaction.table('folderAssignments');
      try {
        const raw = window.localStorage.getItem(FOLDER_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          folders?: StoredConversationFolder[];
          assignments?: Record<string, string | null>;
        };
        if (Array.isArray(parsed.folders)) {
          const folders = parsed.folders.filter((folder) =>
            !!folder && typeof folder.id === 'string' && typeof folder.name === 'string' &&
            (typeof folder.parentId === 'string' || folder.parentId === null) &&
            (folder.contextScope === 'folder' || folder.contextScope === 'global') &&
            typeof folder.createdAt === 'number' && typeof folder.updatedAt === 'number',
          );
          await folderTable.bulkPut(folders);
        }
        if (parsed.assignments && typeof parsed.assignments === 'object') {
          const assignments = Object.entries(parsed.assignments)
            .filter(([threadId, folderId]) => typeof threadId === 'string' && (typeof folderId === 'string' || folderId === null))
            .map(([threadId, folderId]) => ({ id: threadId, threadId, folderId, updatedAt: Date.now() } satisfies StoredFolderAssignment));
          if (assignments.length) await assignmentTable.bulkPut(assignments);
        }
        window.localStorage.removeItem(FOLDER_STORAGE_KEY);
      } catch {
        // A malformed legacy cache should not block the database upgrade.
      }
    });
    this.version(6).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
      memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt',
    });
    this.version(7).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
      memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt',
      artifactMetadata: 'id, artifactType, provenance, status, createdAt, mimeType, sourceMessageId, toolName',
      artifactBlobs: 'id',
    });
    // v8: per-memory Autonomy Context consent flag (design §8.5) — index only,
    // no data migration: records predating the flag default to false (not
    // consented) when validated.
    this.version(8).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
      memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt, autonomyContext',
      artifactMetadata: 'id, artifactType, provenance, status, createdAt, mimeType, sourceMessageId, toolName',
      artifactBlobs: 'id',
    });
    // v9 retires the old derived iframe URL. Preserve every other raw field so
    // the ordinary strict validator still decides whether each migrated item is
    // trustworthy; this migration only removes the now-obsolete field.
    this.version(9).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
      memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt, autonomyContext',
      artifactMetadata: 'id, artifactType, provenance, status, createdAt, mimeType, sourceMessageId, toolName',
      artifactBlobs: 'id',
    }).upgrade(async (transaction) => {
      await transaction.table('messages').toCollection().modify((message: Record<string, unknown>) => {
        const migrated = stripLegacyEmbedUrls(message.media);
        if (migrated.changed) message.media = migrated.value;
      });
    });
  }
}

export const db = new ElaraDatabase();

function threadFromConversation(conversation: ConversationState): StoredThread {
  return { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, archived: false };
}

async function ensurePrimaryThread(): Promise<StoredThread> {
  const existing = await db.threads.get(PRIMARY_ID);
  if (existing) return existing;
  const now = Date.now();
  const primary: StoredThread = { id: PRIMARY_ID, title: DEFAULT_TITLE, createdAt: now, updatedAt: now, archived: false };
  await db.threads.put(primary);
  return primary;
}

function sanitizePersistedMedia(message: ChatMessage, now: number): { message: ChatMessage; changed: boolean } {
  if (message.media === undefined) return { message, changed: false };
  const rawMedia: unknown = message.media;
  const media = freshMediaItems(rawMedia, now);
  if (Array.isArray(rawMedia) && media.length === rawMedia.length) return { message, changed: false };
  const { media: _discarded, ...withoutMedia } = message;
  return media.length > 0
    ? { message: { ...withoutMedia, media }, changed: true }
    : { message: withoutMedia as ChatMessage, changed: true };
}

/**
 * Physically remove stale/corrupt YouTube API metadata from every conversation.
 * Message text, activity, artifacts and thread timestamps are deliberately left
 * alone: retention hygiene must not rewrite chat history or look like user edit.
 */
export async function pruneExpiredConversationMedia(now: number = Date.now()): Promise<number> {
  const messages = await db.messages.toArray();
  const updates: ChatMessage[] = [];
  for (const message of messages) {
    const sanitized = sanitizePersistedMedia(message, now);
    if (sanitized.changed) updates.push(sanitized.message);
  }
  if (updates.length) await db.messages.bulkPut(updates);
  return updates.length;
}

export async function loadThreads(includeArchived = false): Promise<ConversationThread[]> {
  await ensurePrimaryThread();
  const threads = await db.threads.orderBy('updatedAt').reverse().toArray();
  return (includeArchived ? threads : threads.filter((thread) => !thread.archived)).map(({ id, title, createdAt, updatedAt, archived }) => ({ id, title, createdAt, updatedAt, archived }));
}

export async function loadConversation(id = PRIMARY_ID, now: number = Date.now()): Promise<ConversationState> {
  const thread = (await db.threads.get(id)) ?? (id === PRIMARY_ID ? await ensurePrimaryThread() : undefined);
  if (!thread) throw new Error('Conversation thread not found.');
  const storedMessages = await db.messages.where('conversationId').equals(id).sortBy('createdAt');
  const messages: ChatMessage[] = [];
  const cleanup: ChatMessage[] = [];
  for (const stored of storedMessages) {
    const sanitized = sanitizePersistedMedia(stored, now);
    messages.push(sanitized.message);
    if (sanitized.changed) cleanup.push(sanitized.message);
  }
  // Read safety is authoritative even if physical cleanup fails. The user sees the
  // sanitized copy; best-effort persistence merely prevents rediscovering it.
  if (cleanup.length) await db.messages.bulkPut(cleanup).catch(() => undefined);
  return { id: thread.id, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messages };
}

export async function createThread(title = DEFAULT_TITLE): Promise<ConversationState> {
  const now = Date.now();
  const conversation: ConversationState = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, messages: [] };
  await db.threads.put(threadFromConversation(conversation));
  return conversation;
}

export async function appendMessage(message: ChatMessage, conversationId = message.conversationId ?? PRIMARY_ID): Promise<ConversationState> {
  const thread = (await db.threads.get(conversationId)) ?? (conversationId === PRIMARY_ID ? await ensurePrimaryThread() : undefined);
  if (!thread) throw new Error('Conversation thread not found.');
  const storedMessage: ChatMessage = { ...message, conversationId };
  const updatedAt = Date.now();
  await db.transaction('rw', db.messages, db.threads, async () => {
    await db.messages.put(storedMessage);
    await db.threads.update(conversationId, { updatedAt });
  });
  return loadConversation(conversationId);
}

export async function deleteMessage(id: string, conversationId: string): Promise<void> {
  const message = await db.messages.get(id);
  if (!message || message.conversationId !== conversationId) throw new Error('Message not found.');
  await db.transaction('rw', db.messages, db.threads, async () => {
    await db.messages.delete(id);
    await db.threads.update(conversationId, { updatedAt: Date.now() });
  });
}

export async function saveConversation(conversation: ConversationState): Promise<void> {
  await db.transaction('rw', db.messages, db.threads, async () => {
    await db.messages.bulkPut(conversation.messages.map((message) => ({ ...message, conversationId: conversation.id })));
    await db.threads.put(threadFromConversation(conversation));
  });
}

export async function renameThread(id: string, title: string): Promise<ConversationThread> {
  const cleaned = title.trim();
  if (cleaned.length < 1 || cleaned.length > 80) throw new Error('Thread title must be 1–80 characters.');
  await db.threads.update(id, { title: cleaned, updatedAt: Date.now() });
  const thread = await db.threads.get(id);
  if (!thread) throw new Error('Conversation thread not found.');
  return thread;
}

export async function archiveThread(id: string): Promise<void> {
  if (id === PRIMARY_ID) throw new Error('The primary conversation cannot be archived.');
  await db.threads.update(id, { archived: true, updatedAt: Date.now() });
}

export async function deleteThread(id: string): Promise<void> {
  if (id === PRIMARY_ID) throw new Error('The primary conversation cannot be deleted.');
  await db.transaction('rw', db.messages, db.threads, async () => {
    await db.messages.where('conversationId').equals(id).delete();
    await db.threads.delete(id);
  });
}

export async function searchThreads(query: string): Promise<ConversationThread[]> {
  const normalized = query.trim().toLocaleLowerCase();
  const threads = await loadThreads();
  if (!normalized) return threads;
  return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalized));
}

export async function loadGeminiSettings(): Promise<StoredGeminiSettings> {
  const existing = await db.settings.get(GEMINI_SETTINGS_ID);
  if (existing?.id === GEMINI_SETTINGS_ID && getGeminiModel(existing.model)) return existing;
  const now = Date.now();
  const initial: StoredGeminiSettings = {
    id: GEMINI_SETTINGS_ID,
    model: DEFAULT_GEMINI_MODEL,
    perModel: { [DEFAULT_GEMINI_MODEL]: defaultsForModel(DEFAULT_GEMINI_MODEL) },
    updatedAt: now,
  };
  await db.settings.put(initial);
  return initial;
}

export async function saveGeminiSettings(model: string, settings: GeminiSettings, perModelOverride?: Record<string, GeminiSettings>): Promise<StoredGeminiSettings> {
  const normalizedModel = getGeminiModel(model).id;
  const current = await loadGeminiSettings();
  const nextPerModel = { ...current.perModel, ...(perModelOverride ?? {}), [normalizedModel]: normalizeGeminiSettings(normalizedModel, settings) };
  const next: StoredGeminiSettings = { id: GEMINI_SETTINGS_ID, model: normalizedModel, perModel: nextPerModel, updatedAt: Date.now() };
  await db.settings.put(next);
  return next;
}

export async function loadWorkspaceShortcuts(): Promise<StoredWorkspaceShortcut[]> {
  return db.workspaceShortcuts.orderBy('order').toArray();
}

export async function saveWorkspaceShortcut(shortcut: StoredWorkspaceShortcut): Promise<void> {
  await db.workspaceShortcuts.put({ ...shortcut, updatedAt: Date.now() });
}

export async function deleteWorkspaceShortcut(id: string): Promise<void> {
  await db.workspaceShortcuts.delete(id);
}
