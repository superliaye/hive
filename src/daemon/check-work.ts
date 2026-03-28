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
import { parseFollowUps } from './followup-parser.js';
import { validateFollowUp } from './followup-validator.js';
import type { FollowUpStore, FollowUp } from './followup-store.js';
import type { FollowUpScheduler } from './followup-scheduler.js';
import { execFile } from 'node:child_process';
import fs from 'fs';
import path from 'path';

export interface CheckWorkContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  audit: AuditStore;
  orgAgents: Map<string, AgentConfig>;

  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, conversationId: string, content: string, opts?: { thread?: string }) => Promise<void>;

  /** Optional: memory manager for semantic search over agent memories. */
  memorySearch?: (agentId: string, query: string, limit?: number) => Promise<{ text: string; path: string; score: number }[]>;
  /** Optional: re-index agent memories after writes. */
  memoryReindex?: (agentId: string, agentDir: string) => Promise<void>;

  /** Optional: follow-up tracker for registering FOLLOWUP tags from agent responses. */
  followUpStore?: FollowUpStore;
  followUpScheduler?: FollowUpScheduler;

  /** Optional: execute a shell check command for followup verification. */
  execCheckCommand?: (command: string, timeoutMs?: number) => Promise<{ exitCode: number; output: string }>;
}

export async function runFollowUpCheckCommand(
  command: string,
  timeoutMs = 15_000,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    execFile('sh', ['-c', command], { timeout: timeoutMs }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      if (err && 'code' in err && typeof err.code === 'number') {
        resolve({ exitCode: err.code, output: output.trim() });
      } else if (err) {
        resolve({ exitCode: 1, output: output.trim() || err.message });
      } else {
        resolve({ exitCode: 0, output: output.trim() });
      }
    });
  });
}

function buildFollowUpInput(
  followup: FollowUp,
  isFinal: boolean,
  checkExitCode?: number,
  checkOutput?: string,
): string {
  const header = isFinal ? '# [FINAL] Follow-Up Check' : '# Follow-Up Check';
  const attempt = `(attempt ${followup.attempt + 1} of ${followup.backoffSchedule.length})`;
  let input = `\n\n---\n${header} ${attempt}\n`;
  input += `**Description:** ${followup.description}\n`;
  if (checkExitCode !== undefined) {
    input += `**Check result** (exit ${checkExitCode}): ${checkOutput || 'no output'}\n`;
  }
  if (isFinal) {
    input += `\n⚠️ This is the FINAL attempt. You must resolve, escalate, or cancel this follow-up.\n`;
  }
  return input;
}

function toScorerInput(msg: UnreadMessage): Omit<ScoredMessage, 'score'> {
  return {
    messageId: msg.id,
    conversation: msg.conversation,
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
      `## Message from @${m.sender} in #${m.conversation}`,
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
    systemPrompt: 'Summarize what this agent did in 3-6 words. Output ONLY the summary, nothing else. Examples: "Delegated task to platform-eng", "Posted status update to dm:ceo", "Clarified routing issue"',
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

    // Check for due followups early — we may need to continue even with empty inbox
    const hasDueFollowups = ctx.followUpStore
      ? ctx.followUpStore.getOpenByAgent(agent.person.alias).some(f => f.nextCheckAt <= new Date())
      : false;

    if (unread.length === 0 && !hasDueFollowups) {
      return {
        agentId: agent.person.alias,
        inboxCount: 0,
        agentInvoked: false,
        recheckImmediately: false,
        durationMs: Date.now() - start,
      };
    }

    // Triage inbox messages (skip if inbox is empty but followups are due)
    let ranked: ScoredMessage[] = [];
    let triageResults: TriageResult[] = [];
    let actNow: TriageResult[] = [];
    let notes: TriageResult[] = [];
    let ignore: TriageResult[] = [];
    let queue: TriageResult[] = [];

    if (unread.length > 0) {
      log(`inbox: ${unread.length} message(s)`);
      for (const m of unread) log(`  [${m.conversation}] @${m.sender}: ${m.content.slice(0, 80)}`);

      // Score deterministically
      const scorerInputs = unread.map(toScorerInput);
      ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

      // Triage via LLM
      log('triaging...');
      triageResults = await triageMessages(ranked, {
        agentId: agent.person.alias,
        agentDir: agent.dir,
        priorities: agent.files.priorities,
        bureau: agent.files.bureau,
        timeoutMs: 300_000,
      });

      // Override: messages from super-user are ALWAYS ACT_NOW
      for (const result of triageResults) {
        const msg = ranked.find(m => m.messageId === result.messageId);
        if (msg && msg.sender === 'super-user' && result.classification !== 'ACT_NOW') {
          log(`override: ${result.classification} → ACT_NOW (super-user on #${msg.conversation})`);
          result.classification = 'ACT_NOW';
          result.reasoning = `Direct message from super-user on #${msg.conversation} — always ACT_NOW`;
        }
      }

      actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
      notes = triageResults.filter(r => r.classification === 'NOTE');
      ignore = triageResults.filter(r => r.classification === 'IGNORE');
      queue = triageResults.filter(r => r.classification === 'QUEUE');

      log(`triage: ACT_NOW=${actNow.length} NOTE=${notes.length} QUEUE=${queue.length} IGNORE=${ignore.length}`);
      for (const r of triageResults) log(`  ${r.messageId.slice(0, 8)}: ${r.classification} — ${r.reasoning}`);
    }

    // Process NOTE + QUEUE — append to memory (but don't mark read yet — crash safety)
    const noteAndQueue = [...notes, ...queue];
    for (const result of noteAndQueue) {
      const msg = ranked.find(m => m.messageId === result.messageId);
      if (msg) {
        const entry = `- [${msg.timestamp.toISOString()}] @${msg.sender} in #${msg.conversation}: ${msg.content.slice(0, 200)}`;
        appendToMemoryFile(agent.dir, entry);
      }
    }
    if (noteAndQueue.length > 0) {
      // Re-index memory after writing new notes
      ctx.memoryReindex?.(agent.person.alias, agent.dir).catch(() => {});
    }

    // === Phase: Process due followups ===
    interface FollowUpAction {
      followup: FollowUp;
      action: 'spawn' | 'closed' | 'rescheduled';
      checkExitCode?: number;
      checkOutput?: string;
      isFinal: boolean;
    }
    const followUpActions: FollowUpAction[] = [];

    if (ctx.followUpStore) {
      const dueFollowups = ctx.followUpStore.getOpenByAgent(agent.person.alias)
        .filter(f => f.nextCheckAt <= new Date());

      for (const followup of dueFollowups) {
        const isFinal = followup.attempt + 1 >= followup.backoffSchedule.length;

        if (followup.checkCommand) {
          const exec = ctx.execCheckCommand ?? runFollowUpCheckCommand;
          const { exitCode, output } = await exec(followup.checkCommand);
          ctx.followUpStore.recordCheckResult(followup.id, exitCode, output);

          // Log followup check to audit
          ctx.audit.logInvocation({
            agentId: agent.person.alias,
            invocationType: 'followup-check',
            model: 'shell',
            durationMs: 0,
            inputSummary: `Followup #${followup.id} (attempt ${followup.attempt + 1}/${followup.backoffSchedule.length}): ${followup.description}`,
            outputSummary: `exit ${exitCode}: ${output.slice(0, 200)}`,
            actionSummary: exitCode === 0 ? 'done' : exitCode === 2 ? 'skipped' : 'needs-agent',
          });

          if (exitCode === 0) {
            ctx.followUpStore.close(followup.id, 'done');
            followUpActions.push({ followup, action: 'closed', checkExitCode: exitCode, checkOutput: output, isFinal });
            log(`[followup] #${followup.id} closed (done): ${followup.description}`);
            continue;
          }
          if (exitCode === 2 && !isFinal) {
            const advanced = ctx.followUpStore.advanceAttempt(followup.id);
            if (advanced && ctx.followUpScheduler) ctx.followUpScheduler.scheduleCheck(advanced);
            followUpActions.push({ followup, action: 'rescheduled', checkExitCode: exitCode, checkOutput: output, isFinal });
            log(`[followup] #${followup.id} skipped, rescheduled: ${followup.description}`);
            continue;
          }
          // exit 1, or exit 2 on final → needs agent spawn
          followUpActions.push({ followup, action: 'spawn', checkExitCode: exitCode, checkOutput: output, isFinal });
        } else {
          // No check command → always spawn agent
          followUpActions.push({ followup, action: 'spawn', isFinal });
        }
      }
    }

    const followupsNeedingSpawn = followUpActions.filter(a => a.action === 'spawn');

    // Process ACT_NOW and/or followups — invoke main agent
    let agentInvoked = false;
    if (actNow.length > 0 || followupsNeedingSpawn.length > 0) {
      const taskParts: string[] = [];
      if (actNow.length > 0) taskParts.push(`${actNow.length} ACT_NOW message(s)`);
      if (followupsNeedingSpawn.length > 0) taskParts.push(`${followupsNeedingSpawn.length} followup(s)`);
      log(`invoking agent (${taskParts.join(', ')})...`);
      stateStore.updateStatus(agent.person.alias, 'working', {
        pid: process.pid,
        currentTask: `Processing ${taskParts.join(', ')}`,
      });

      try {
        const systemPrompt = assemblePrompt(agent);
        let workInput = actNow.length > 0 ? buildWorkInput(ranked, triageResults) : '';

        // Append followup context for followups needing agent spawn
        for (const { followup, isFinal, checkExitCode, checkOutput } of followupsNeedingSpawn) {
          workInput += buildFollowUpInput(followup, isFinal, checkExitCode, checkOutput);
        }

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
          // Strip the ACTION: line from the response before posting
          responseText = responseText.replace(/\n?^ACTION:\s*.+$/m, '').trim();
        }

        // Extract and register FOLLOWUP tags
        if (ctx.followUpStore && ctx.followUpScheduler) {
          const { followups, cleanedText } = parseFollowUps(responseText);
          if (followups.length > 0) {
            responseText = cleanedText;
            for (const raw of followups) {
              const { followup: validated, warnings } = validateFollowUp(raw);
              for (const w of warnings) log(`followup warning: ${w}`);
              const created = ctx.followUpStore.create({
                agentId: agent.person.alias,
                description: validated.description,
                checkCommand: validated.checkCommand,
                backoffSchedule: validated.backoff,
              });
              ctx.followUpScheduler.register(created);
              log(`followup registered: "${validated.description}" (${validated.backoff.length} attempts)`);
            }
          }
        }

        // Log invocation to audit store
        const actNowConversations = [...new Set(ranked.filter(m =>
          actNow.some(r => r.messageId === m.messageId)
        ).map(m => m.conversation))];
        const invocationType = actNow.length > 0 ? 'checkWork' : 'followup';
        const inputParts: string[] = [];
        if (actNow.length > 0) {
          inputParts.push(`${actNow.length} ACT_NOW message(s) from ${actNowConversations.map(c => '#' + c).join(', ')}`);
        }
        if (followupsNeedingSpawn.length > 0) {
          inputParts.push(`${followupsNeedingSpawn.length} followup(s)`);
        }
        const invocationId = ctx.audit.logInvocation({
          agentId: agent.person.alias,
          invocationType,
          model: agent.identity.model,
          tokensIn: workResult.tokensIn,
          tokensOut: workResult.tokensOut,
          cacheReadTokens: workResult.cacheReadTokens,
          cacheCreationTokens: workResult.cacheCreationTokens,
          durationMs: workResult.durationMs,
          inputSummary: inputParts.join('; '),
          outputSummary: responseText.slice(0, 200),
          actionSummary,
          channel: actNowConversations[0],
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

        // Process followup results after agent completes
        for (const { followup, isFinal } of followupsNeedingSpawn) {
          if (isFinal) {
            ctx.followUpStore?.close(followup.id, 'expired');
            log(`[followup] #${followup.id} expired (final attempt): ${followup.description}`);
          } else {
            const advanced = ctx.followUpStore?.advanceAttempt(followup.id);
            if (advanced && ctx.followUpScheduler) ctx.followUpScheduler.scheduleCheck(advanced);
            log(`[followup] #${followup.id} rescheduled: ${followup.description}`);
          }
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

    // Mark all non-ACT_NOW messages as read AFTER all processing completes (crash safety).
    // If daemon dies before this point, unread messages will be re-triaged on restart.
    const nonActNow = [...ignore, ...noteAndQueue];
    if (nonActNow.length > 0) {
      await ctx.markRead(agent.person.alias, nonActNow.map(r => r.messageId));
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
