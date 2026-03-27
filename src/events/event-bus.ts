import { EventEmitter } from 'events';

export interface NewMessageEvent {
  id: string;
  conversation: string;
  sender: string;
  content: string;
  timestamp: string;
  thread?: string;
}

export interface AgentStateEvent {
  agentId: string;
  status: string;
  currentTask?: string;
  pid?: number;
  lastHeartbeat?: string;
}

export interface AuditInvocationEvent {
  id: string;
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  channel?: string;
}

export interface HiveEventMap {
  'message:new': [NewMessageEvent];
  'agent:state': [AgentStateEvent];
  'audit:invocation': [AuditInvocationEvent];
}

/**
 * Typed in-process event bus for real-time Hive events.
 * Replaces SQLite polling with instant push notifications.
 */
export class HiveEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE clients to subscribe
    this.emitter.setMaxListeners(100);
  }

  emit<K extends keyof HiveEventMap>(event: K, ...args: HiveEventMap[K]): void {
    this.emitter.emit(event, ...args);
  }

  on<K extends keyof HiveEventMap>(event: K, handler: (...args: HiveEventMap[K]) => void): void {
    this.emitter.on(event, handler as (...args: any[]) => void);
  }

  off<K extends keyof HiveEventMap>(event: K, handler: (...args: HiveEventMap[K]) => void): void {
    this.emitter.off(event, handler as (...args: any[]) => void);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
