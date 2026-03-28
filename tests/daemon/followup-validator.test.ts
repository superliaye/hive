import { describe, it, expect } from 'vitest';
import { validateFollowUp } from '../../src/daemon/followup-validator.js';

describe('validateFollowUp', () => {
  it('passes valid input unchanged', () => {
    const result = validateFollowUp({
      description: 'PR #46 merge',
      checkCommand: 'gh pr view 46 --json state',
      backoff: ['10m', '30m', '1h'],
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.followup.backoff).toEqual(['10m', '30m', '1h']);
  });

  it('clamps intervals below minimum to 5m', () => {
    const result = validateFollowUp({
      description: 'test',
      backoff: ['1m', '30m'],
    });

    expect(result.valid).toBe(false);
    expect(result.followup.backoff[0]).toBe('5m');
    expect(result.warnings.some(w => w.includes('below minimum'))).toBe(true);
  });

  it('clamps intervals above maximum to 7d', () => {
    const result = validateFollowUp({
      description: 'test',
      backoff: ['10d'],
    });

    expect(result.valid).toBe(false);
    expect(result.followup.backoff[0]).toBe('7d');
  });

  it('truncates backoff to max 5 attempts', () => {
    const result = validateFollowUp({
      description: 'test',
      backoff: ['10m', '20m', '30m', '1h', '2h', '4h', '8h'],
    });

    expect(result.followup.backoff).toHaveLength(5);
    expect(result.warnings.some(w => w.includes('clamped to 5'))).toBe(true);
  });

  it('rejects dangerous check commands', () => {
    const result = validateFollowUp({
      description: 'test',
      checkCommand: 'rm -rf /',
      backoff: ['10m'],
    });

    expect(result.followup.checkCommand).toBeUndefined();
    expect(result.warnings.some(w => w.includes('dangerous'))).toBe(true);
  });

  it('allows safe check commands', () => {
    const result = validateFollowUp({
      description: 'test',
      checkCommand: 'gh pr view 46 --json state',
      backoff: ['10m'],
    });

    expect(result.followup.checkCommand).toBe('gh pr view 46 --json state');
  });

  it('defaults invalid interval format to 10m', () => {
    const result = validateFollowUp({
      description: 'test',
      backoff: ['banana'],
    });

    expect(result.followup.backoff[0]).toBe('10m');
    expect(result.warnings.some(w => w.includes('invalid'))).toBe(true);
  });
});
