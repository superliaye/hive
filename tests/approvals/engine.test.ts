import { describe, it, expect } from 'vitest';
import { parseApprovalItem, parseApprovalDecision } from '../../src/approvals/engine.js';

describe('approvals engine', () => {
  describe('parseApprovalItem', () => {
    it('parses a well-formed approval request', () => {
      const content = `**Approval Request: hire-frontend-eng**

Type: AR_CHANGE
Description: Create a frontend engineer role under engineering
Justification: Current team lacks frontend expertise
Requested by: @ceo`;

      const item = parseApprovalItem(content);
      expect(item).not.toBeNull();
      expect(item!.id).toBe('hire-frontend-eng');
      expect(item!.type).toBe('AR_CHANGE');
      expect(item!.description).toBe('Create a frontend engineer role under engineering');
      expect(item!.justification).toBe('Current team lacks frontend expertise');
      expect(item!.requestedBy).toBe('@ceo');
    });

    it('returns null for non-approval messages', () => {
      expect(parseApprovalItem('just a regular message')).toBeNull();
    });

    it('defaults to OTHER for unknown type', () => {
      const content = `**Approval Request: some-item**

Type: UNKNOWN_TYPE
Description: Something`;

      const item = parseApprovalItem(content);
      expect(item!.type).toBe('OTHER');
    });
  });

  describe('parseApprovalDecision', () => {
    it('parses approved decision', () => {
      const decision = parseApprovalDecision('approved: hire-frontend-eng');
      expect(decision).toEqual({ itemId: 'hire-frontend-eng', decision: 'approved' });
    });

    it('parses rejected decision with reason', () => {
      const decision = parseApprovalDecision('rejected: hire-frontend-eng — not needed right now');
      expect(decision).toEqual({ itemId: 'hire-frontend-eng', decision: 'rejected', reason: 'not needed right now' });
    });

    it('returns null for non-decision messages', () => {
      expect(parseApprovalDecision('hello')).toBeNull();
    });

    it('is case-insensitive', () => {
      const decision = parseApprovalDecision('Approved: some-item');
      expect(decision).toEqual({ itemId: 'some-item', decision: 'approved' });
    });
  });
});
