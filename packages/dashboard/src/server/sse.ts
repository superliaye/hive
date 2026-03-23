import type { Request, Response } from 'express';
import type { HiveContext } from '../../../../src/context.js';
import type { AgentState } from '../../../../src/types.js';

interface SSEClient {
  id: string;
  res: Response;
}

export class SSEManager {
  private clients: SSEClient[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastStates: Map<string, AgentState> = new Map();
  private lastMessageTimestamp: string | null = null;

  constructor(private ctx: HiveContext) {}

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

    req.on('close', () => {
      this.clients = this.clients.filter(c => c.id !== client.id);
    });
  }

  startPolling(intervalMs = 2000): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      if (this.clients.length === 0) return;
      this.pollAgentStates();
      this.pollNewMessages();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  emitCeoWorking(status: 'started' | 'completed'): void {
    this.broadcast('ceo-working', { status });
  }

  private pollAgentStates(): void {
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

  private async pollNewMessages(): Promise<void> {
    const channels = await this.ctx.comms.listChannels();
    for (const ch of channels) {
      const since = this.lastMessageTimestamp
        ? new Date(this.lastMessageTimestamp)
        : new Date(Date.now() - 2000);
      const messages = await this.ctx.comms.readChannel(ch.name, { since });
      for (const msg of messages) {
        const ts = msg.timestamp.toISOString();
        if (!this.lastMessageTimestamp || ts > this.lastMessageTimestamp) {
          this.lastMessageTimestamp = ts;
        }
        this.broadcast('new-message', {
          channel: msg.channel,
          sender: msg.sender,
          content: msg.content,
          timestamp: ts,
          id: msg.id,
        });
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
