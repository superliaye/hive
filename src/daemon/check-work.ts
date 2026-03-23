import type { AgentConfig } from '../types.js';
import type { ScoredMessage, TriageResult } from '../gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../gateway/types.js';
import { rankMessages } from '../gateway/scorer.js';
import { triageMessages } from '../gateway/triage.js';
import { spawnClaude, buildClaudeArgs } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { CheckWorkResult, UnreadMessage } from './types.js';
import fs from 'fs';
import path from 'path';

export interface CheckWorkContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  orgAgents: Map<string, AgentConfig>;

  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;
}

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

function buildWorkInput(messages: ScoredMessage[], triageResults: TriageResult[]): string {
  const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
  const actNowMessages = messages.filter(m =>
    actNow.some(r => r.messageId === m.messageId)
  );

  const sections = actNowMessages.map(m => {
    const result = actNow.find(r => r.messageId === m.messageId);
    return [
      `## Message from @${m.sender} in #${m.channel}`,
      `> ${m.content}`,
      '',
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
    'Review the above messages and take appropriate action.',
    'You may update your PRIORITIES.md if these messages change your work priorities.',
    'Post your response in the relevant channel(s).',
  ].join('\n');
}

/**
 * Append a note to the agent's memory file (memory/YYYY-MM-DD.md).
 */
function appendToMemoryFile(agentDir: string, entry: string): void {
  const memoryDir = path.join(agentDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const today = new Date().toISOString().slice(0, 10);
  const memoryFile = path.join(memoryDir, `${today}.md`);
  const existing = fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, 'utf-8') : '';
  fs.writeFileSync(memoryFile, existing + entry + '\n');
}

/**
 * CheckWork: the sole entry point for agent invocations.
 *
 * Flow:
 * 1. Guard: skip if agent is already working
 * 2. Read inbox (unread messages)
 * 3. If empty → return (ZERO LLM calls)
 * 4. Score deterministically
 * 5. Triage via LLM (haiku) → classify ACT_NOW / NOTE / IGNORE
 *    - No QUEUE dumping into PRIORITIES.md — agent manages its own priorities via Write tool
 * 6. Process NOTE → append to memory file, mark read
 * 7. Process IGNORE → mark read
 * 8. If any ACT_NOW → set state=working → spawn main agent → post results → set state=idle
 * 9. Mark ACT_NOW as read
 * 10. Return recheckImmediately=true if work was performed (catch new messages)
 */
export async function checkWork(ctx: CheckWorkContext): Promise<CheckWorkResult> {
  const start = Date.now();
  const { agent, stateStore } = ctx;

  // Guard: skip if already working
  const currentState = stateStore.get(agent.id);
  if (currentState?.status === 'working') {
    return {
      agentId: agent.id,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: `Agent ${agent.id} is already working (PID: ${currentState.pid})`,
    };
  }

  // Mark heartbeat
  stateStore.markHeartbeat(agent.id);

  try {
    // Read inbox
    const unread = await ctx.getUnread(agent.id);

    if (unread.length === 0) {
      return {
        agentId: agent.id,
        inboxCount: 0,
        agentInvoked: false,
        recheckImmediately: false,
        durationMs: Date.now() - start,
      };
    }

    // Score deterministically
    const scorerInputs = unread.map(toScorerInput);
    const ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

    // Triage via LLM
    const triageResults = await triageMessages(ranked, {
      agentId: agent.id,
      agentDir: agent.dir,
      priorities: agent.files.priorities,
      bureau: agent.files.bureau,
    });

    const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
    const notes = triageResults.filter(r => r.classification === 'NOTE');
    const ignore = triageResults.filter(r => r.classification === 'IGNORE');
    // QUEUE treated same as NOTE — agent internalizes during main invocation
    const queue = triageResults.filter(r => r.classification === 'QUEUE');

    // Process IGNORE — mark read
    if (ignore.length > 0) {
      await ctx.markRead(agent.id, ignore.map(r => r.messageId));
    }

    // Process NOTE + QUEUE — append to memory, mark read
    const noteAndQueue = [...notes, ...queue];
    for (const result of noteAndQueue) {
      const msg = ranked.find(m => m.messageId === result.messageId);
      if (msg) {
        const entry = `- [${msg.timestamp.toISOString()}] @${msg.sender} in #${msg.channel}: ${msg.content.slice(0, 200)}`;
        appendToMemoryFile(agent.dir, entry);
      }
    }
    if (noteAndQueue.length > 0) {
      await ctx.markRead(agent.id, noteAndQueue.map(r => r.messageId));
    }

    // Process ACT_NOW — invoke main agent
    let agentInvoked = false;
    if (actNow.length > 0) {
      stateStore.updateStatus(agent.id, 'working', {
        pid: process.pid,
        currentTask: `Processing ${actNow.length} message(s)`,
      });

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
          timeoutMs: 300_000,
        });

        // Post results to channels that had ACT_NOW messages
        if (workResult.exitCode === 0 && workResult.stdout.trim()) {
          const actNowMessages = ranked.filter(m =>
            actNow.some(r => r.messageId === m.messageId)
          );
          const byChannel = new Map<string, ScoredMessage[]>();
          for (const msg of actNowMessages) {
            const existing = byChannel.get(msg.channel) ?? [];
            existing.push(msg);
            byChannel.set(msg.channel, existing);
          }
          for (const [channel, msgs] of byChannel) {
            const thread = msgs[0].thread;
            await ctx.postMessage(agent.id, channel, workResult.stdout.trim(), thread ? { thread } : undefined);
          }
        }

        agentInvoked = true;
      } catch (err) {
        stateStore.updateStatus(agent.id, 'idle');
        return {
          agentId: agent.id,
          inboxCount: unread.length,
          agentInvoked: false,
          recheckImmediately: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await ctx.markRead(agent.id, actNow.map(r => r.messageId));
    }

    // Return to idle
    stateStore.updateStatus(agent.id, 'idle');

    return {
      agentId: agent.id,
      inboxCount: unread.length,
      agentInvoked,
      recheckImmediately: agentInvoked,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    stateStore.updateStatus(agent.id, 'idle');
    return {
      agentId: agent.id,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
