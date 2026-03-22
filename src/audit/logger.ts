import { AuditStore, type LogInvocationOpts } from './store.js';
import type { SpawnResult } from '../types.js';

export class AuditLogger {
  constructor(private store: AuditStore) {}

  logAgentInvocation(
    agentId: string,
    invocationType: LogInvocationOpts['invocationType'],
    model: string,
    result: SpawnResult,
    opts?: { inputSummary?: string; channel?: string },
  ): string {
    return this.store.logInvocation({
      agentId,
      invocationType,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs: result.durationMs,
      inputSummary: opts?.inputSummary,
      outputSummary: result.stdout.slice(0, 200), // First 200 chars as summary
      channel: opts?.channel,
    });
  }
}
