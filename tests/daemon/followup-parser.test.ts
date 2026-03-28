import { describe, it, expect } from 'vitest';
import { parseFollowUps, stripFollowUps } from '../../src/daemon/followup-parser.js';

describe('parseFollowUps', () => {
  it('parses a full FOLLOWUP block with check and backoff', () => {
    const text = `Some response text.

FOLLOWUP: PR #46 — drive to merge
| check: gh pr view 46 --json state -q '.state == "MERGED"'
| backoff: 10m, 30m, 1h, 4h

More text after.`;

    const { followups, cleanedText } = parseFollowUps(text);

    expect(followups).toHaveLength(1);
    expect(followups[0].description).toBe('PR #46 — drive to merge');
    expect(followups[0].checkCommand).toBe("gh pr view 46 --json state -q '.state == \"MERGED\"'");
    expect(followups[0].backoff).toEqual(['10m', '30m', '1h', '4h']);
    expect(cleanedText).not.toContain('FOLLOWUP:');
    expect(cleanedText).toContain('Some response text.');
    expect(cleanedText).toContain('More text after.');
  });

  it('parses FOLLOWUP without check command', () => {
    const text = `FOLLOWUP: QA verification from @tess
| backoff: 1h, 4h, 1d`;

    const { followups } = parseFollowUps(text);

    expect(followups).toHaveLength(1);
    expect(followups[0].description).toBe('QA verification from @tess');
    expect(followups[0].checkCommand).toBeUndefined();
    expect(followups[0].backoff).toEqual(['1h', '4h', '1d']);
  });

  it('parses multiple FOLLOWUP blocks', () => {
    const text = `FOLLOWUP: PR #46 merge
| check: gh pr view 46 --json state
| backoff: 10m, 30m

FOLLOWUP: Notify QA
| backoff: 1h, 4h`;

    const { followups } = parseFollowUps(text);
    expect(followups).toHaveLength(2);
    expect(followups[0].description).toBe('PR #46 merge');
    expect(followups[1].description).toBe('Notify QA');
  });

  it('rejects FOLLOWUP without backoff', () => {
    const text = `FOLLOWUP: Missing backoff
| check: echo ok`;

    const { followups } = parseFollowUps(text);
    expect(followups).toHaveLength(0);
  });

  it('returns empty for text without FOLLOWUP tags', () => {
    const { followups, cleanedText } = parseFollowUps('Just a normal response.');
    expect(followups).toHaveLength(0);
    expect(cleanedText).toBe('Just a normal response.');
  });
});

describe('stripFollowUps', () => {
  it('strips FOLLOWUP blocks from text', () => {
    const text = `Did the work.

FOLLOWUP: PR merge
| backoff: 10m, 30m

ACTION: Created PR`;

    const stripped = stripFollowUps(text);
    expect(stripped).not.toContain('FOLLOWUP:');
    expect(stripped).toContain('Did the work.');
    expect(stripped).toContain('ACTION: Created PR');
  });
});
