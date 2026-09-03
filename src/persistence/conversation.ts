import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ConversationState, ConversationThread } from '../domain/chat';
import { DEFAULT_GEMINI_MODEL, getGeminiModel } from '../gemini/model-registry';
import { defaultsForModel, normalizeGeminiSettings, type GeminiSettings } from '../gemini/settings-engine';

const PRIMARY_ID = 'primary';
const DEFAULT_TITLE = 'New conversation';
const GEMINI_SETTINGS_ID = 'gemini';

interface StoredThread extends ConversationThread { title: string; }
export interface StoredGeminiSettings {
  id: typeof GEMINI_SETTINGS_ID;
  model: string;
  perModel: Record<string, GeminiSettings>;
  updatedAt: number;
}

class ElaraDatabase extends Dexie {
  messages!: Table<ChatMessage, string>;
  threads!: Table<StoredThread, string>;
  settings!: Table<StoredGeminiSettings, string>;

  constructor() {
    super('elara-angelic-utility-applet');
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
  }
}

const db = new ElaraDatabase();

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

export async function loadThreads(includeArchived = false): Promise<ConversationThread[]> {
  await ensurePrimaryThread();
  const threads = await db.threads.orderBy('updatedAt').reverse().toArray();
  return (includeArchived ? threads : threads.filter((thread) => !thread.archived)).map(({ id, title, createdAt, updatedAt, archived }) => ({ id, title, createdAt, updatedAt, archived }));
}

export async function loadConversation(id = PRIMARY_ID): Promise<ConversationState> {
  const thread = (await db.threads.get(id)) ?? (id === PRIMARY_ID ? await ensurePrimaryThread() : undefined);
  if (!thread) throw new Error('Conversation thread not found.');
  const messages = await db.messages.where('conversationId').equals(id).sortBy('createdAt');
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
  if (existing && getGeminiModel(existing.model)) return existing;
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
