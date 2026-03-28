import type { ScoredMessage, TriageResult, TriageBatchOutput } from './types.js';
import { parseTriageOutput } from './types.js';
import { spawnClaude, buildTriageArgs } from '../agents/spawner.js';

export interface TriageOutput {
  results: TriageResult[];
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  model?: string;
}

export interface TriageOptions {
  agentId: string;
  agentDir: string;
  priorities: string;
  bureau: string;
  timeoutMs?: number;
}

/**
 * Build the system prompt for the triage LLM call.
 * Includes classification instructions, agent context, and expected output format.
 */
export function buildTriagePrompt(priorities: string, bureau: string): string {
  return `You are a message triage assistant. Your job is to classify incoming messages for an agent.

## Agent Context

### Priorities
${priorities}

### Bureau (Organizational Position)
${bureau}

## Classification Rules

Classify each message into exactly one category:

- **ACT_NOW** — Requires immediate attention. The agent should stop current work and address this. Examples: direct requests from manager, urgent incidents, blocking issues, direct @mentions with questions.
- **QUEUE** — Important but not urgent. Add to the agent's backlog for the next work cycle. Examples: new task assignments, non-urgent requests, FYI that needs follow-up.
- **NOTE** — Contains useful information but requires no action. Extract key info for memory. Examples: announcements, status updates from peers, context that may be useful later.
- **IGNORE** — Not relevant to this agent. Mark as read and drop. Examples: messages for other teams, social chatter, duplicate information.

## Output Format

Respond with ONLY a JSON object in this exact format (no markdown, no code fences):

{
  "results": [
    {
      "messageId": "<id of the message>",
      "classification": "ACT_NOW" | "QUEUE" | "NOTE" | "IGNORE",
      "reasoning": "<brief 1-sentence explanation>"
    }
  ]
}

Classify ALL messages in the batch. One entry per message. Use the messageId from each message.`;
}

/**
 * Format scored messages as input for the triage LLM.
 */
function formatMessagesForTriage(messages: ScoredMessage[]): string {
  return JSON.stringify(
    messages.map((m) => ({
      messageId: m.messageId,
      conversation: m.conversation,
      sender: m.sender,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      score: m.score,
      mentions: m.mentions ?? [],
      thread: m.thread,
    })),
    null,
    2,
  );
}

/**
 * Create fallback triage results when Claude CLI fails.
 * Defaults all messages to QUEUE so nothing is lost.
 */
function createFallbackResults(messages: ScoredMessage[], reason: string): TriageResult[] {
  return messages.map((m) => ({
    messageId: m.messageId,
    classification: 'QUEUE' as const,
    reasoning: `Triage fallback — ${reason}`,
    score: m.score,
  }));
}

/**
 * Run Stage 2 triage: invoke Claude CLI haiku to classify scored messages.
 *
 * If the message batch is empty, returns immediately.
 * If Claude CLI fails or returns invalid JSON, falls back to QUEUE for all messages.
 */
export async function triageMessages(
  messages: ScoredMessage[],
  opts: TriageOptions,
): Promise<TriageOutput> {
  if (messages.length === 0) return { results: [] };

  const systemPrompt = buildTriagePrompt(opts.priorities, opts.bureau);
  const input = formatMessagesForTriage(messages);
  const args = buildTriageArgs(systemPrompt);

  let result;
  try {
    result = await spawnClaude(args, {
      cwd: opts.agentDir,
      input,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'spawn failed';
    return { results: createFallbackResults(messages, reason) };
  }

  if (result.exitCode !== 0) {
    return {
      results: createFallbackResults(messages, `claude exited with code ${result.exitCode}`),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs: result.durationMs,
      model: 'haiku',
    };
  }

  // Claude CLI with --output-format json wraps the response in an envelope:
  // { "result": "<actual LLM text>", "usage": { ... } }
  // We need to unwrap it before parsing the triage JSON.
  let triageJson = result.stdout;
  try {
    const envelope = JSON.parse(triageJson);
    if (envelope.result && typeof envelope.result === 'string') {
      triageJson = envelope.result;
    }
  } catch {
    // Not a JSON envelope — use raw stdout
  }

  // Strip markdown code fences that LLMs sometimes wrap around JSON
  triageJson = triageJson.trim();
  if (triageJson.startsWith('```')) {
    triageJson = triageJson.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: TriageBatchOutput;
  try {
    parsed = parseTriageOutput(triageJson);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'parse failed';
    return {
      results: createFallbackResults(messages, reason),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs: result.durationMs,
      model: 'haiku',
    };
  }

  // Merge: preserve Stage 1 scores, match by messageId
  const scoreMap = new Map(messages.map((m) => [m.messageId, m.score]));
  return {
    results: parsed.results.map((r) => ({
      ...r,
      score: scoreMap.get(r.messageId) ?? r.score,
    })),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    durationMs: result.durationMs,
    model: 'haiku',
  };
}
