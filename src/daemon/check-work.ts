import type { AgentConfig } from '../types.js';
import type { ScoredMessage, TriageResult } from '../gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../gateway/types.js';
import { rankMessages } from '../gateway/scorer.js';
import { triageMessages } from '../gateway/triage.js';
import { spawnClaude, buildClaudeArgs, buildAgentGitEnv } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { AuditStore } from '../audit/store.js';
import type { CheckWorkResult, UnreadMessage } from './types.js';
import fs from 'fs';
import path from 'path';

export interface CheckWorkContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  audit: AuditStore;
  orgAgents: Map<string, AgentConfig>;

  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;

  /** Optional: memory manager for semantic search over agent memories. */
  memorySearch?: (agentId: string, query: string, limit?: number) => Promise<{ text: string; path: string; score: number }[]>;
  /** Optional: re-index agent memories after writes. */
  memoryReindex?: (agentId: string, agentDir: string) => Promise<void>;
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
    '',
    'Use `hive chat send @alias "message"` for follow-up messages. See the hive-comms skill for guidelines.',
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
 * Fire-and-forget haiku call to summarize what the agent did.
 * Updates the audit record's action_summary when complete.
 */
function summarizeAction(
  responseText: string,
  invocationId: string,
  audit: AuditStore,
  log: (msg: string) => void,
): void {
  const snippet = responseText.slice(0, 500);
  const args = buildClaudeArgs({
    model: 'haiku',
    systemPrompt: 'Summarize what this agent did in 3-6 words. Output ONLY the summary, nothing else. Examples: "Delegated task to platform-eng", "Posted status update to #board", "Clarified routing issue"',
    outputFormat: 'json',
  });

  spawnClaude(args, { cwd: process.cwd(), input: snippet, timeoutMs: 15_000 })
    .then(result => {
      let summary = result.stdout.trim();
      // Unwrap JSON envelope
      try {
        const envelope = JSON.parse(summary);
        if (envelope.result) summary = envelope.result;
      } catch { /* use raw */ }
      summary = summary.replace(/^["']|["']$/g, '').trim();
      if (summary && summary.length < 100) {
        audit.updateActionSummary(invocationId, summary);
        log(`action summary: ${summary}`);
      }
    })
    .catch(() => { /* best-effort, ignore failures */ });
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
 *    - Override: super-user messages → always ACT_NOW
 * 6. Process NOTE → append to memory file, mark read
 * 7. Process IGNORE → mark read
 * 8. If any ACT_NOW → set state=working → spawn main agent → log to audit → set state=idle
 * 9. Mark ACT_NOW as read
 * 10. Return recheckImmediately=true if work was performed (catch new messages)
 */
export async function checkWork(ctx: CheckWorkContext): Promise<CheckWorkResult> {
  const start = Date.now();
  const { agent, stateStore } = ctx;
  const log = (msg: string) => console.log(`[checkWork:${agent.person.alias}] ${msg}`);

  // Guard: skip if already working
  const currentState = stateStore.get(agent.person.alias);
  if (currentState?.status === 'working') {
    log(`skipped — already working (PID: ${currentState.pid})`);
    return {
      agentId: agent.person.alias,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: `Agent ${agent.person.alias} is already working (PID: ${currentState.pid})`,
    };
  }

  // Mark heartbeat
  stateStore.markHeartbeat(agent.person.alias);

  try {
    // Read inbox
    const unread = await ctx.getUnread(agent.person.alias);

    if (unread.length === 0) {
      return {
        agentId: agent.person.alias,
        inboxCount: 0,
        agentInvoked: false,
        recheckImmediately: false,
        durationMs: Date.now() - start,
      };
    }

    log(`inbox: ${unread.length} message(s)`);
    for (const m of unread) log(`  [${m.channel}] @${m.sender}: ${m.content.slice(0, 80)}`);

    // Score deterministically
    const scorerInputs = unread.map(toScorerInput);
    const ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

    // Triage via LLM
    log('triaging...');
    const triageResults = await triageMessages(ranked, {
      agentId: agent.person.alias,
      agentDir: agent.dir,
      priorities: agent.files.priorities,
      bureau: agent.files.bureau,
    });

    // Override: messages from super-user are ALWAYS ACT_NOW
    for (const result of triageResults) {
      const msg = ranked.find(m => m.messageId === result.messageId);
      if (msg && msg.sender === 'super-user' && result.classification !== 'ACT_NOW') {
        log(`override: ${result.classification} → ACT_NOW (super-user on #${msg.channel})`);
        result.classification = 'ACT_NOW';
        result.reasoning = `Direct message from super-user on #${msg.channel} — always ACT_NOW`;
      }
    }

    const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
    const notes = triageResults.filter(r => r.classification === 'NOTE');
    const ignore = triageResults.filter(r => r.classification === 'IGNORE');
    const queue = triageResults.filter(r => r.classification === 'QUEUE');

    log(`triage: ACT_NOW=${actNow.length} NOTE=${notes.length} QUEUE=${queue.length} IGNORE=${ignore.length}`);
    for (const r of triageResults) log(`  ${r.messageId.slice(0, 8)}: ${r.classification} — ${r.reasoning}`);

    // Process IGNORE — mark read
    if (ignore.length > 0) {
      await ctx.markRead(agent.person.alias, ignore.map(r => r.messageId));
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
      await ctx.markRead(agent.person.alias, noteAndQueue.map(r => r.messageId));
      // Re-index memory after writing new notes
      ctx.memoryReindex?.(agent.person.alias, agent.dir).catch(() => {});
    }

    // Process ACT_NOW — invoke main agent
    let agentInvoked = false;
    if (actNow.length > 0) {
      log(`invoking agent (${actNow.length} ACT_NOW messages)...`);
      stateStore.updateStatus(agent.person.alias, 'working', {
        pid: process.pid,
        currentTask: `Processing ${actNow.length} message(s)`,
      });

      try {
        const systemPrompt = assemblePrompt(agent);
        let workInput = buildWorkInput(ranked, triageResults);

        // Enrich with relevant memories via vector search
        if (ctx.memorySearch) {
          try {
            const actNowContent = ranked
              .filter(m => actNow.some(r => r.messageId === m.messageId))
              .map(m => m.content)
              .join(' ');
            const memories = await ctx.memorySearch(agent.person.alias, actNowContent, 5);
            if (memories.length > 0) {
              const memorySection = memories
                .map(m => `- (${path.basename(m.path)}) ${m.text.slice(0, 300)}`)
                .join('\n');
              workInput += `\n\n# Relevant Memories\n\n${memorySection}`;
            }
          } catch (err) {
            log(`memory search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const args = buildClaudeArgs({
          model: agent.identity.model,
          systemPrompt,
          outputFormat: 'json',
        });

        log(`spawning claude (model: ${agent.identity.model})...`);
        const workResult = await spawnClaude(args, {
          cwd: agent.dir,
          input: workInput,
          env: buildAgentGitEnv(agent.person.alias, agent.identity.name),
        });

        // Extract text from JSON output
        let responseText = workResult.stdout.trim();
        try {
          const parsed = JSON.parse(responseText);
          if (parsed.result) {
            responseText = parsed.result;
          }
        } catch {
          // Non-JSON fallback — use raw stdout
        }

        log(`claude exited ${workResult.exitCode} (${workResult.durationMs}ms, tokens: ${workResult.tokensIn ?? 0}in/${workResult.tokensOut ?? 0}out)`);
        if (workResult.stderr) log(`stderr: ${workResult.stderr.slice(0, 300)}`);

        // Extract ACTION: tag from response (option 2: agent self-reports)
        let actionSummary: string | undefined;
        const actionMatch = responseText.match(/^ACTION:\s*(.+)$/m);
        if (actionMatch) {
          actionSummary = actionMatch[1].trim();
          // Strip the ACTION: line from the response before posting to channels
          responseText = responseText.replace(/\n?^ACTION:\s*.+$/m, '').trim();
        }

        // Log invocation to audit store
        const actNowChannels = [...new Set(ranked.filter(m =>
          actNow.some(r => r.messageId === m.messageId)
        ).map(m => m.channel))];
        const invocationId = ctx.audit.logInvocation({
          agentId: agent.person.alias,
          invocationType: 'checkWork',
          model: agent.identity.model,
          tokensIn: workResult.tokensIn,
          tokensOut: workResult.tokensOut,
          cacheReadTokens: workResult.cacheReadTokens,
          cacheCreationTokens: workResult.cacheCreationTokens,
          durationMs: workResult.durationMs,
          inputSummary: `${actNow.length} ACT_NOW message(s) from ${actNowChannels.map(c => '#' + c).join(', ')}`,
          outputSummary: responseText.slice(0, 200),
          actionSummary,
          channel: actNowChannels[0],
        });

        // Fallback (option 4): if agent didn't include ACTION: tag, use haiku to summarize
        if (!actionSummary && responseText) {
          summarizeAction(responseText, invocationId, ctx.audit, log);
        }

        if (workResult.exitCode !== 0) {
          log(`WARNING: claude failed with exit code ${workResult.exitCode}`);
        } else if (!responseText) {
          log(`WARNING: claude returned empty output`);
        }

        agentInvoked = true;
      } catch (err) {
        log(`ERROR invoking agent: ${err instanceof Error ? err.message : String(err)}`);
        stateStore.updateStatus(agent.person.alias, 'idle');
        return {
          agentId: agent.person.alias,
          inboxCount: unread.length,
          agentInvoked: false,
          recheckImmediately: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await ctx.markRead(agent.person.alias, actNow.map(r => r.messageId));
    }

    // Return to idle
    stateStore.updateStatus(agent.person.alias, 'idle');
    log(`done (${Date.now() - start}ms, invoked=${agentInvoked})`);

    return {
      agentId: agent.person.alias,
      inboxCount: unread.length,
      agentInvoked,
      recheckImmediately: agentInvoked,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    stateStore.updateStatus(agent.person.alias, 'idle');
    return {
      agentId: agent.person.alias,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
