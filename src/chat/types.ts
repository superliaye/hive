export interface Person {
  id: number;
  alias: string;
  name: string;
  roleTemplate: string | null;
  status: string;
  folder: string | null;
}

export type ConversationType = 'dm' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  createdBy: number;
  createdAt: string;
  deleted: boolean;
}

export interface ConversationMember {
  conversationId: string;
  personId: number;
  joinedAt: string;
}

export interface ChatMessage {
  seq: number;
  conversationId: string;
  senderId: number;
  senderAlias: string;
  content: string;
  timestamp: string;
}

export interface HistoryResult {
  messages: ChatMessage[];
  total: number;
  conversationId: string;
  showing: { from: number; to: number };
}

export interface SearchResult {
  messages: ChatMessage[];
  total: number;
  showing: { offset: number; limit: number };
}

export interface ReadCursor {
  personId: number;
  conversationId: string;
  lastSeq: number;
  updatedAt: string;
}

export interface UnreadGroup {
  conversationId: string;
  conversationType: ConversationType;
  messages: ChatMessage[];
}
