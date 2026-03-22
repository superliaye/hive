export type TriageClassification = 'ACT_NOW' | 'QUEUE' | 'NOTE' | 'IGNORE';

export interface ScoredMessage {
  messageId: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: Date;
  score: number;               // 0-10, computed by Stage 1
  mentions?: string[];
  metadata?: Record<string, unknown>;
  thread?: string;
}

export interface TriageResult {
  messageId: string;
  classification: TriageClassification;
  reasoning: string;            // LLM's explanation
  score: number;                // Stage 1 score (preserved for audit)
}

export interface ScoringWeights {
  authority: number;   // Default 0.25 — sender hierarchy weight
  urgency: number;     // Default 0.25 — urgent flag weight
  channel: number;     // Default 0.20 — channel priority weight
  recency: number;     // Default 0.15 — message freshness weight
  mention: number;     // Default 0.15 — direct @mention weight
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  authority: 0.25,
  urgency: 0.25,
  channel: 0.20,
  recency: 0.15,
  mention: 0.15,
};

export interface TriageBatchInput {
  messages: ScoredMessage[];
  agentId: string;
  priorities: string;          // Content of PRIORITIES.md
  bureau: string;              // Content of BUREAU.md
}

export interface TriageBatchOutput {
  results: TriageResult[];
}

/**
 * Validate that a string is a valid TriageClassification.
 */
export function isTriageClassification(value: string): value is TriageClassification {
  return ['ACT_NOW', 'QUEUE', 'NOTE', 'IGNORE'].includes(value);
}

/**
 * Parse a triage response from Claude CLI JSON output.
 * Expected format:
 * {
 *   "results": [
 *     { "messageId": "...", "classification": "ACT_NOW", "reasoning": "..." },
 *     ...
 *   ]
 * }
 */
export function parseTriageOutput(json: string): TriageBatchOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse triage output as JSON: ${json.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !('results' in parsed)) {
    throw new Error('Triage output missing "results" array');
  }

  const obj = parsed as { results: unknown[] };
  if (!Array.isArray(obj.results)) {
    throw new Error('Triage output "results" is not an array');
  }

  const results: TriageResult[] = obj.results.map((item: any, i: number) => {
    if (!item.messageId || typeof item.messageId !== 'string') {
      throw new Error(`Triage result[${i}] missing messageId`);
    }
    if (!item.classification || !isTriageClassification(item.classification)) {
      throw new Error(`Triage result[${i}] has invalid classification: ${item.classification}`);
    }
    return {
      messageId: item.messageId,
      classification: item.classification,
      reasoning: item.reasoning ?? '',
      score: item.score ?? 0,
    };
  });

  return { results };
}
