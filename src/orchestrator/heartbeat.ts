/**
 * @deprecated Use {@link import('../daemon/check-work.js').checkWork} instead.
 * The heartbeat pipeline is replaced by the daemon's CheckWork routine.
 */
import type { AgentConfig } from '../types.js';
import type { ScoredMessage, TriageResult } from '../gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../gateway/types.js';
import { rankMessages } from '../gateway/scorer.js';
import { triageMessages } from '../gateway/triage.js';
import { spawnClaude, buildClaudeArgs } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import type { AgentStateStore } from '../state/agent-state.js';

/**
 * Callback interfaces — injected by the orchestrator.
 * The heartbeat doesn't know where messages come from or how to persist.
 */
export interface HeartbeatContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  orgAgents: Map<string, AgentConfig>;

  // Comms callbacks — provided by the orchestrator (wrapping ICommsProvider)
  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;

  // File callbacks — provided by the orchestrator
  appendToMemory: (agentId: string, content: string) => Promise<void>;
  appendToPriorities: (agentId: string, content: string) => Promise<void>;
}

export interface UnreadMessage {
  id: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: Date;
  thread?: string;
  metadata?: Record<string, unknown>;
  mentions?: string[];
}

export interface HeartbeatResult {
  agentId: string;
  messagesProcessed: number;
  actNowCount: number;
  queueCount: number;
  noteCount: number;
  ignoreCount: number;
  workPerformed: boolean;
  durationMs: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Convert an unread message from comms to a ScoredMessage input (without score).
 */
function toScorerInput(msg: UnreadMessage): Omit<ScoredMessage, 'score'> {
  return {
    messageId: msg.id,
    channel: msg.channel,
    sender: msg.sender,
    content: msg.content,
    timestamp: msg.timestamp,
    thread: msg.thread,
    metadata: msg.metadata,
    mentions: msg.mentions,
  };
}

/**
 * Build the work prompt for ACT_NOW messages.
 * Combines the agent's system prompt with the messages that need action.
 */
function buildWorkInput(messages: ScoredMessage[], triageResults: TriageResult[]): string {
  const actNowResults = triageResults.filter(r => r.classification === 'ACT_NOW');
  const actNowMessages = messages.filter(m =>
    actNowResults.some(r => r.messageId === m.messageId)
  );

  const sections = actNowMessages.map(m => {
    const result = actNowResults.find(r => r.messageId === m.messageId);
    return [
      `## Message from @${m.sender} in #${m.channel}`,
      `> ${m.content}`,
      ``,
      `Triage: ${result?.reasoning ?? 'Needs immediate attention'}`,
    ].join('\n');
  });

  return [
    '# Messages Requiring Action',
    '',
    ...sections,
    '',
    '---',
    '',
    'Review the above messages and take appropriate action. Post your response in the relevant channel(s).',
  ].join('\n');
}

/**
 * Run a single heartbeat cycle for one agent.
 *
 * The heartbeat loop:
 * 1. Check agent state — skip if already working (concurrency guard)
 * 2. Fetch unread messages from comms
 * 3. Stage 1: Score messages deterministically
 * 4. Stage 2: Triage via LLM (Claude CLI haiku)
 * 5. Process results:
 *    - ACT_NOW → invoke Claude CLI for main work → post results
 *    - QUEUE → append to PRIORITIES.md
 *    - NOTE → append to memory/today.md
 *    - IGNORE → mark as read
 * 6. Update agent state
 *
 * This is NOT a loop — it's a single invocation that processes one cycle.
 * The orchestrator calls this on a schedule.
 */
export async function runHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatResult> {
  const start = Date.now();
  const { agent, stateStore } = ctx;

  // Concurrency guard: one invocation per agent at a time
  const currentState = stateStore.get(agent.id);
  if (currentState?.status === 'working') {
    return {
      agentId: agent.id,
      messagesProcessed: 0,
      actNowCount: 0,
      queueCount: 0,
      noteCount: 0,
      ignoreCount: 0,
      workPerformed: false,
      durationMs: Date.now() - start,
      skipped: true,
      skipReason: `Agent ${agent.id} is already working (PID: ${currentState.pid})`,
    };
  }

  // Mark heartbeat timestamp
  stateStore.markHeartbeat(agent.id);

  try {
    // Step 1: Fetch unread messages
    const unread = await ctx.getUnread(agent.id);

    if (unread.length === 0) {
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: Date.now() - start,
      };
    }

    // Step 2: Stage 1 — Deterministic scoring
    const scorerInputs = unread.map(toScorerInput);
    const ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

    // Step 3: Stage 2 — LLM triage
    const triageResults = await triageMessages(ranked, {
      agentId: agent.id,
      agentDir: agent.dir,
      priorities: agent.files.priorities,
      bureau: agent.files.bureau,
    });

    // Step 4: Process results by classification
    const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
    const queue = triageResults.filter(r => r.classification === 'QUEUE');
    const note = triageResults.filter(r => r.classification === 'NOTE');
    const ignore = triageResults.filter(r => r.classification === 'IGNORE');

    // Process IGNORE — mark as read immediately
    if (ignore.length > 0) {
      await ctx.markRead(agent.id, ignore.map(r => r.messageId));
    }

    // Process NOTE — append to memory, then mark as read
    for (const noteResult of note) {
      const msg = ranked.find(m => m.messageId === noteResult.messageId);
      if (msg) {
        const entry = `- [${msg.timestamp.toISOString()}] @${msg.sender} in #${msg.channel}: ${msg.content.slice(0, 200)}`;
        await ctx.appendToMemory(agent.id, entry);
      }
    }
    if (note.length > 0) {
      await ctx.markRead(agent.id, note.map(r => r.messageId));
    }

    // Process QUEUE — append to priorities, then mark as read
    for (const queueResult of queue) {
      const msg = ranked.find(m => m.messageId === queueResult.messageId);
      if (msg) {
        const entry = `- [QUEUED] ${msg.content.slice(0, 200)} (from @${msg.sender} in #${msg.channel})`;
        await ctx.appendToPriorities(agent.id, entry);
      }
    }
    if (queue.length > 0) {
      await ctx.markRead(agent.id, queue.map(r => r.messageId));
    }

    // Process ACT_NOW — invoke Claude CLI for main work
    let workPerformed = false;
    if (actNow.length > 0) {
      stateStore.updateStatus(agent.id, 'working', { pid: process.pid, currentTask: `Processing ${actNow.length} urgent message(s)` });

      try {
        const systemPrompt = assemblePrompt(agent);
        const workInput = buildWorkInput(ranked, triageResults);

        const args = buildClaudeArgs({
          model: agent.identity.model,
          systemPrompt,
          tools: agent.identity.tools,
        });

        const workResult = await spawnClaude(args, {
          cwd: agent.dir,
          input: workInput,
          timeoutMs: 300_000, // 5 min for main work
        });

        // Post results to ALL channels that had ACT_NOW messages.
        // Group ACT_NOW messages by channel so each channel gets a response.
        if (workResult.exitCode === 0 && workResult.stdout.trim()) {
          const actNowMessages = ranked.filter(m =>
            actNow.some(r => r.messageId === m.messageId)
          );
          // Group by channel
          const byChannel = new Map<string, ScoredMessage[]>();
          for (const msg of actNowMessages) {
            const existing = byChannel.get(msg.channel) ?? [];
            existing.push(msg);
            byChannel.set(msg.channel, existing);
          }
          // Post response to each channel
          for (const [channel, msgs] of byChannel) {
            // Use the thread of the first message in the channel, if any
            const thread = msgs[0].thread;
            await ctx.postMessage(
              agent.id,
              channel,
              workResult.stdout.trim(),
              thread ? { thread } : undefined,
            );
          }
        }

        workPerformed = true;
      } catch (err) {
        // Main work failed — set agent back to idle and report error
        stateStore.updateStatus(agent.id, 'idle');
        return {
          agentId: agent.id,
          messagesProcessed: unread.length,
          actNowCount: actNow.length,
          queueCount: queue.length,
          noteCount: note.length,
          ignoreCount: ignore.length,
          workPerformed: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Mark ACT_NOW messages as read after processing
      await ctx.markRead(agent.id, actNow.map(r => r.messageId));
    }

    // Return to idle state
    stateStore.updateStatus(agent.id, 'idle');

    return {
      agentId: agent.id,
      messagesProcessed: unread.length,
      actNowCount: actNow.length,
      queueCount: queue.length,
      noteCount: note.length,
      ignoreCount: ignore.length,
      workPerformed,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Catch-all: ensure agent doesn't stay stuck in working state
    stateStore.updateStatus(agent.id, 'idle');
    return {
      agentId: agent.id,
      messagesProcessed: 0,
      actNowCount: 0,
      queueCount: 0,
      noteCount: 0,
      ignoreCount: 0,
      workPerformed: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
