import { FollowUpStore, type FollowUp } from './followup-store.js';

export interface FollowUpSchedulerConfig {
  store: FollowUpStore;
  onFollowUpDue: (agentId: string, followupId: number) => void;
  log?: (...args: unknown[]) => void;
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
    if (!followup || followup.status !== 'open') {
      this.clearTimer(followupId);
      return;
    }
    this.clearTimer(followupId);
    this.config.onFollowUpDue(followup.agentId, followup.id);
  }
}
