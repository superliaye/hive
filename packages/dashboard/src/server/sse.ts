import type { Request, Response } from 'express';
import type { HiveContext } from '../../../../src/context.js';
import type { AgentState } from '../../../../src/types.js';
import type { HiveEventBus, NewMessageEvent, AgentStateEvent, AuditInvocationEvent } from '../../../../src/events/event-bus.js';

interface SSEClient {
  id: string;
  res: Response;
}

export class SSEManager {
  private clients: SSEClient[] = [];
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastStates: Map<string, AgentState> = new Map();
  private eventBus: HiveEventBus | null;

  // Event handlers (stored for cleanup)
  private onMessage: ((msg: NewMessageEvent) => void) | null = null;
  private onAgentState: ((state: AgentStateEvent) => void) | null = null;
  private onAuditInvocation: ((inv: AuditInvocationEvent) => void) | null = null;

  constructor(private ctx: HiveContext, eventBus?: HiveEventBus) {
    this.eventBus = eventBus ?? null;
  }

  addClient(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client: SSEClient = {
      id: crypto.randomUUID(),
      res,
    };
    this.clients.push(client);

    this.sendEvent(res, 'connected', { clientId: client.id });

    // Send current agent states immediately so client is in sync
    this.sendFullStateSync(res);

    req.on('close', () => {
      this.clients = this.clients.filter(c => c.id !== client.id);
    });
  }

  /**
   * Start the SSE manager.
   * If event bus is available, subscribe for real-time push.
   * Always starts a slow heartbeat for state sync fallback.
   */
  start(): void {
    if (this.eventBus) {
      this.subscribeToEventBus(this.eventBus);
    }

    // Slow heartbeat: full state sync every 30s as fallback
    this.heartbeatInterval = setInterval(() => {
      if (this.clients.length === 0) return;
      this.syncAgentStates();
    }, 30_000);
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.eventBus) {
      if (this.onMessage) this.eventBus.off('message:new', this.onMessage);
      if (this.onAgentState) this.eventBus.off('agent:state', this.onAgentState);
      if (this.onAuditInvocation) this.eventBus.off('audit:invocation', this.onAuditInvocation);
    }
  }

  /** @deprecated Use start() instead */
  startPolling(intervalMs = 2000): void {
    this.start();
  }

  /** @deprecated Use stop() instead */
  stopPolling(): void {
    this.stop();
  }

  /** @deprecated No longer needed — agent:state events handle this */
  emitCeoWorking(_status: 'started' | 'completed'): void {
    // No-op: agent state changes are now pushed via event bus
  }

  private subscribeToEventBus(bus: HiveEventBus): void {
    this.onMessage = (msg) => {
      if (this.clients.length === 0) return;
      this.broadcast('new-message', {
        id: msg.id,
        conversation: msg.channel,
        sender: msg.sender,
        content: msg.content,
        timestamp: msg.timestamp,
        thread: msg.thread,
      });
    };

    this.onAgentState = (state) => {
      if (this.clients.length === 0) return;
      this.broadcast('agent-state', {
        agentId: state.agentId,
        status: state.status,
        currentTask: state.currentTask,
        pid: state.pid,
        lastHeartbeat: state.lastHeartbeat,
      });
    };

    this.onAuditInvocation = (inv) => {
      if (this.clients.length === 0) return;
      this.broadcast('audit-invocation', {
        id: inv.id,
        agentId: inv.agentId,
        invocationType: inv.invocationType,
        model: inv.model,
        tokensIn: inv.tokensIn,
        tokensOut: inv.tokensOut,
        durationMs: inv.durationMs,
        channel: inv.channel,
      });
    };

    bus.on('message:new', this.onMessage);
    bus.on('agent:state', this.onAgentState);
    bus.on('audit:invocation', this.onAuditInvocation);
  }

  /**
   * Send full agent state to a specific client (on initial connection).
   */
  private sendFullStateSync(res: Response): void {
    const states = this.ctx.state.listAll();
    for (const state of states) {
      this.sendEvent(res, 'agent-state', {
        agentId: state.agentId,
        status: state.status,
        currentTask: state.currentTask,
        lastHeartbeat: state.lastHeartbeat?.toISOString(),
      });
      this.lastStates.set(state.agentId, state);
    }
  }

  /**
   * Periodic full state sync — catches anything the event bus might have missed.
   */
  private syncAgentStates(): void {
    const states = this.ctx.state.listAll();
    for (const state of states) {
      const prev = this.lastStates.get(state.agentId);
      if (!prev || prev.status !== state.status || prev.currentTask !== state.currentTask) {
        this.broadcast('agent-state', {
          agentId: state.agentId,
          status: state.status,
          currentTask: state.currentTask,
          lastHeartbeat: state.lastHeartbeat?.toISOString(),
        });
        this.lastStates.set(state.agentId, state);
      }
    }
  }

  private broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected — will be cleaned up on next request close
      }
    }
  }

  private sendEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
