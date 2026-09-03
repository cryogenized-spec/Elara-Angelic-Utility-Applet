import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ConversationState } from '../domain/chat';

class ElaraDatabase extends Dexie {
  messages!: Table<ChatMessage, string>;

  constructor() {
    super('elara-angelic-utility-applet');
    this.version(1).stores({ messages: 'id, createdAt, role' });
  }
}

const db = new ElaraDatabase();

export async function loadConversation(): Promise<ConversationState> {
  const messages = await db.messages.orderBy('createdAt').toArray();
  return { id: 'primary', messages };
}

export async function appendMessage(message: ChatMessage): Promise<ConversationState> {
  await db.messages.put(message);
  return loadConversation();
}

export async function saveConversation(conversation: ConversationState): Promise<void> {
  await db.transaction('rw', db.messages, async () => {
    await db.messages.bulkPut(conversation.messages);
  });
}
