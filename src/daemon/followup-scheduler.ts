import { execFile } from 'child_process';
import { FollowUpStore, parseInterval, type FollowUp } from './followup-store.js';
import type { LaneManager } from './lane.js';
import type { AgentConfig } from '../types.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { AuditStore } from '../audit/store.js';
import { spawnClaude, buildClaudeArgs, buildAgentGitEnv } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';

const CHECK_TIMEOUT_MS = 15_000;

export interface FollowUpSchedulerConfig {
  store: FollowUpStore;
  lanes: LaneManager;
  stateStore: AgentStateStore;
  audit: AuditStore;
  getAgent: (agentId: string) => AgentConfig | undefined;
}

export class FollowUpScheduler {
  private config: FollowUpSchedulerConfig;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private running = false;

  constructor(config: FollowUpSchedulerConfig) {
    this.config = config;
  }

  /** Start the scheduler, restoring timers for all open follow-ups. */
  start(): void {
    this.running = true;
    const open = this.config.store.getAllOpen();
    for (const followup of open) {
      this.scheduleCheck(followup);
    }
    if (open.length > 0) {
      console.log(`[followup-scheduler] restored ${open.length} open follow-up(s)`);
    }
  }

  /** Schedule a single follow-up check. */
  scheduleCheck(followup: FollowUp): void {
    if (!this.running) return;

    // Clear any existing timer for this follow-up
    this.clearTimer(followup.id);

    const now = Date.now();
    const delayMs = Math.max(0, followup.nextCheckAt.getTime() - now);

    const timer = setTimeout(() => {
      this.timers.delete(followup.id);
      this.runCheck(followup.id);
    }, delayMs);

    this.timers.set(followup.id, timer);
  }

  /** Register a newly created follow-up and schedule its first check. */
  register(followup: FollowUp): void {
    this.scheduleCheck(followup);
    console.log(
      `[followup-scheduler] registered: "${followup.description}" for ${followup.agentId} ` +
      `(${followup.backoffSchedule.length} attempts, first check in ${followup.backoffSchedule[0]})`
    );
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private runCheck(followupId: number): void {
    if (!this.running) return;

    const followup = this.config.store.get(followupId);
    if (!followup || followup.status !== 'open') return;

    const agent = this.config.getAgent(followup.agentId);
    if (!agent) {
      console.log(`[followup-scheduler] agent ${followup.agentId} not found, cancelling followup ${followupId}`);
      this.config.store.close(followupId, 'cancelled');
      return;
    }

    const isFinal = followup.attempt >= followup.backoffSchedule.length - 1;
    const log = (msg: string) => console.log(`[followup:${followup.agentId}] ${msg}`);

    log(`checking: "${followup.description}" (attempt ${followup.attempt + 1} of ${followup.backoffSchedule.length}${isFinal ? ' — FINAL' : ''})`);

    if (followup.checkCommand) {
      this.executeCheckCommand(followup, agent, isFinal, log);
    } else {
      // No check command — always spawn agent
      this.spawnForFollowUp(followup, agent, isFinal, null, null, log);
    }
  }

  private executeCheckCommand(
    followup: FollowUp,
    agent: AgentConfig,
    isFinal: boolean,
    log: (msg: string) => void,
  ): void {
    execFile('sh', ['-c', followup.checkCommand!], { timeout: CHECK_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (!this.running) return;

      const exitCode = error ? (error as any).code ?? 127 : 0;
      const output = (stdout || stderr || '').trim().slice(0, 1000);

      this.config.store.recordCheckResult(followup.id, exitCode, output);
      log(`check exit ${exitCode}: ${output.slice(0, 100) || '(empty)'}`);

      switch (exitCode) {
        case 0:
          // Done — auto-close
          log(`done: "${followup.description}"`);
          this.config.store.close(followup.id, 'done');
          break;

        case 2:
          // Not done, skip this tick — advance to next interval
          if (isFinal) {
            this.spawnForFollowUp(followup, agent, true, exitCode, output, log);
          } else {
            this.advanceAndReschedule(followup, log);
          }
          break;

        case 1:
        default:
          // Not done (exit 1) or error — spawn agent
          this.spawnForFollowUp(followup, agent, isFinal, exitCode, output, log);
          break;
      }
    });
  }

  private advanceAndReschedule(followup: FollowUp, log: (msg: string) => void): void {
    const updated = this.config.store.advanceAttempt(followup.id);
    if (updated && updated.status === 'open') {
      log(`next check in ${updated.backoffSchedule[updated.attempt]}`);
      this.scheduleCheck(updated);
    }
  }

  private spawnForFollowUp(
    followup: FollowUp,
    agent: AgentConfig,
    isFinal: boolean,
    checkExitCode: number | null,
    checkOutput: string | null,
    log: (msg: string) => void,
  ): void {
    const lane = this.config.lanes.get(followup.agentId);
    lane.enqueue(async () => {
      // Guard: skip if agent is busy
      const state = this.config.stateStore.get(followup.agentId);
      if (state?.status === 'working') {
        log('agent busy, rescheduling followup');
        // Retry in 2 minutes
        const retryTimer = setTimeout(() => this.runCheck(followup.id), 2 * 60 * 1000);
        this.timers.set(followup.id, retryTimer);
        return;
      }

      this.config.stateStore.updateStatus(followup.agentId, 'working', {
        pid: process.pid,
        currentTask: `Follow-up: ${followup.description}`,
      });

      try {
        const input = buildFollowUpInput(followup, isFinal, checkExitCode, checkOutput);
        const systemPrompt = assemblePrompt(agent);
        const args = buildClaudeArgs({
          model: agent.identity.model,
          systemPrompt,
          outputFormat: 'json',
        });

        log(`spawning agent for follow-up (model: ${agent.identity.model})...`);
        const result = await spawnClaude(args, {
          cwd: agent.dir,
          input,
          env: buildAgentGitEnv(agent.person.alias, agent.identity.name),
        });

        let responseText = result.stdout.trim();
        try {
          const parsed = JSON.parse(responseText);
          if (parsed.result) responseText = parsed.result;
        } catch { /* use raw */ }

        log(`agent exited ${result.exitCode} (${result.durationMs}ms, tokens: ${result.tokensIn ?? 0}in/${result.tokensOut ?? 0}out)`);

        // Log to audit
        this.config.audit.logInvocation({
          agentId: followup.agentId,
          invocationType: 'followup',
          model: agent.identity.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          cacheReadTokens: result.cacheReadTokens,
          cacheCreationTokens: result.cacheCreationTokens,
          durationMs: result.durationMs,
          inputSummary: `Follow-up (${followup.attempt + 1}/${followup.backoffSchedule.length}): ${followup.description}`,
          outputSummary: responseText.slice(0, 200),
          actionSummary: isFinal ? `FINAL follow-up: ${followup.description}` : undefined,
          channel: undefined,
        });
      } catch (err) {
        log(`ERROR in follow-up spawn: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.config.stateStore.updateStatus(followup.agentId, 'idle');
      }

      // Advance attempt and reschedule (or expire)
      if (isFinal) {
        this.config.store.close(followup.id, 'expired');
        log(`expired: "${followup.description}" (all attempts exhausted)`);
      } else {
        this.advanceAndReschedule(followup, log);
      }
    }).catch(err => {
      console.error(`[followup:${followup.agentId}] lane error:`, err);
    });
  }
}

function buildFollowUpInput(
  followup: FollowUp,
  isFinal: boolean,
  checkExitCode: number | null,
  checkOutput: string | null,
): string {
  const attemptNum = followup.attempt + 1;
  const totalAttempts = followup.backoffSchedule.length;
  const remaining = followup.backoffSchedule.slice(attemptNum);

  const lines = [
    `# Follow-Up Check (attempt ${attemptNum} of ${totalAttempts}${isFinal ? ' — FINAL' : ''})`,
    '',
    `**Description:** ${followup.description}`,
    '',
  ];

  if (checkExitCode !== null) {
    const exitLabel = checkExitCode === 1 ? 'not done' : checkExitCode === 2 ? 'skip' : `error (${checkExitCode})`;
    lines.push(`**Check result** (exit ${checkExitCode} — ${exitLabel}): ${checkOutput || '(no output)'}`);
    lines.push('');
  }

  if (followup.lastCheckOutput && followup.attempt > 0) {
    lines.push(`**Previous check output:** ${followup.lastCheckOutput.slice(0, 300)}`);
    lines.push('');
  }

  if (remaining.length > 0) {
    lines.push(`**Backoff remaining:** ${remaining.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  if (isFinal) {
    lines.push('This is your **last scheduled check**. You must make a terminal decision:');
    lines.push('- Merge or close the PR');
    lines.push('- Escalate to your manager');
    lines.push('- Cancel the follow-up with a reason');
    lines.push('');
    lines.push('Do not leave this unresolved.');
  } else {
    lines.push('You are being invoked to drive this to completion. Take action to unblock progress.');
    lines.push('Use `hive chat send @alias "message"` for follow-ups.');
  }

  return lines.join('\n');
}
