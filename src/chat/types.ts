export interface Person {
  id: number;
  alias: string;
  name: string;
  roleTemplate: string | null;
  status: string;
  folder: string | null;
}

export type ChannelType = 'dm' | 'group';

export interface ChatChannel {
  id: string;
  type: ChannelType;
  createdBy: number;
  createdAt: string;
  deleted: boolean;
}

export interface ChannelMember {
  channelId: string;
  personId: number;
  joinedAt: string;
}

export interface ChatMessage {
  seq: number;
  channelId: string;
  senderId: number;
  senderAlias: string;
  content: string;
  timestamp: string;
}

export interface HistoryResult {
  messages: ChatMessage[];
  total: number;
  channelId: string;
  showing: { from: number; to: number };
}

export interface SearchResult {
  messages: ChatMessage[];
  total: number;
  showing: { offset: number; limit: number };
}

export interface ReadCursor {
  personId: number;
  channelId: string;
  lastSeq: number;
  updatedAt: string;
}

export interface UnreadGroup {
  channelId: string;
  channelType: ChannelType;
  messages: ChatMessage[];
}
