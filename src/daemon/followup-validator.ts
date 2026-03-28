import { parseInterval } from './followup-store.js';
import type { ParsedFollowUp } from './followup-parser.js';

const MIN_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ATTEMPTS = 5;

/** Patterns that are not allowed in check commands. */
const DANGEROUS_PATTERNS = [
  /\brm\s+-/,
  /\brm\s+\//,
  /\bkill\b/,
  /\bsudo\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\//,
];

export interface ValidationResult {
  valid: boolean;
  followup: ParsedFollowUp;
  warnings: string[];
}

/**
 * Validate and clamp a parsed follow-up to safe boundaries.
 * Returns a validated copy (never mutates input).
 */
export function validateFollowUp(input: ParsedFollowUp): ValidationResult {
  const warnings: string[] = [];
  let backoff = [...input.backoff];

  // Clamp backoff length
  if (backoff.length > MAX_ATTEMPTS) {
    warnings.push(`Backoff has ${backoff.length} intervals, clamped to ${MAX_ATTEMPTS}`);
    backoff = backoff.slice(0, MAX_ATTEMPTS);
  }

  // Validate and clamp each interval
  backoff = backoff.map((interval, i) => {
    try {
      const ms = parseInterval(interval);
      if (ms < MIN_INTERVAL_MS) {
        warnings.push(`Interval ${i}: "${interval}" below minimum (5m), clamped`);
        return '5m';
      }
      if (ms > MAX_INTERVAL_MS) {
        warnings.push(`Interval ${i}: "${interval}" above maximum (7d), clamped`);
        return '7d';
      }
      return interval;
    } catch {
      warnings.push(`Interval ${i}: "${interval}" is invalid, defaulted to 10m`);
      return '10m';
    }
  });

  // Validate check command
  let checkCommand = input.checkCommand;
  if (checkCommand) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(checkCommand)) {
        warnings.push(`Check command contains dangerous pattern (${pattern}), removed`);
        checkCommand = undefined;
        break;
      }
    }
  }

  return {
    valid: warnings.length === 0,
    followup: {
      description: input.description,
      checkCommand,
      backoff,
    },
    warnings,
  };
}
