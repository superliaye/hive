import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FollowUpStore, parseInterval } from '../../src/daemon/followup-store.js';

describe('FollowUpStore', () => {
  let db: Database.Database;
  let store: FollowUpStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new FollowUpStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and retrieves a follow-up', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'PR #46 merge',
      checkCommand: 'gh pr view 46 --json state',
      backoffSchedule: ['10m', '30m', '1h'],
    });

    expect(followup.id).toBeGreaterThan(0);
    expect(followup.agentId).toBe('rio');
    expect(followup.description).toBe('PR #46 merge');
    expect(followup.checkCommand).toBe('gh pr view 46 --json state');
    expect(followup.backoffSchedule).toEqual(['10m', '30m', '1h']);
    expect(followup.attempt).toBe(0);
    expect(followup.status).toBe('open');

    const retrieved = store.get(followup.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.description).toBe('PR #46 merge');
  });

  it('creates follow-up without check command', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'QA verification',
      backoffSchedule: ['1h', '4h'],
    });

    expect(followup.checkCommand).toBeNull();
  });

  it('lists open follow-ups by agent', () => {
    store.create({ agentId: 'rio', description: 'PR #46', backoffSchedule: ['10m'] });
    store.create({ agentId: 'rio', description: 'PR #47', backoffSchedule: ['10m'] });
    store.create({ agentId: 'noor', description: 'PR #48', backoffSchedule: ['10m'] });

    const rioFollowups = store.getOpenByAgent('rio');
    expect(rioFollowups).toHaveLength(2);

    const noorFollowups = store.getOpenByAgent('noor');
    expect(noorFollowups).toHaveLength(1);
  });

  it('advances attempt and updates next_check_at', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'PR #46',
      backoffSchedule: ['10m', '30m', '1h'],
    });

    const updated = store.advanceAttempt(followup.id);
    expect(updated!.attempt).toBe(1);
    expect(updated!.status).toBe('open');
    expect(updated!.nextCheckAt.getTime()).toBeGreaterThan(followup.nextCheckAt.getTime());
  });

  it('expires follow-up when all attempts exhausted', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'PR #46',
      backoffSchedule: ['10m'],
    });

    // Only one attempt — advancing should expire it
    const updated = store.advanceAttempt(followup.id);
    expect(updated!.status).toBe('expired');
    expect(updated!.closedAt).not.toBeNull();
  });

  it('closes a follow-up as done', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'PR #46',
      backoffSchedule: ['10m'],
    });

    store.close(followup.id, 'done');
    const closed = store.get(followup.id);
    expect(closed!.status).toBe('done');
    expect(closed!.closedAt).not.toBeNull();
  });

  it('records check results', () => {
    const followup = store.create({
      agentId: 'rio',
      description: 'PR #46',
      backoffSchedule: ['10m'],
    });

    store.recordCheckResult(followup.id, 1, 'state: OPEN');
    const updated = store.get(followup.id);
    expect(updated!.lastCheckExit).toBe(1);
    expect(updated!.lastCheckOutput).toBe('state: OPEN');
  });

  it('getAllOpen returns only open follow-ups', () => {
    const f1 = store.create({ agentId: 'rio', description: 'open one', backoffSchedule: ['10m'] });
    store.create({ agentId: 'rio', description: 'open two', backoffSchedule: ['10m'] });
    store.close(f1.id, 'done');

    const open = store.getAllOpen();
    expect(open).toHaveLength(1);
    expect(open[0].description).toBe('open two');
  });
});

describe('parseInterval', () => {
  it('parses minutes', () => {
    expect(parseInterval('10m')).toBe(600_000);
    expect(parseInterval('5min')).toBe(300_000);
  });

  it('parses hours', () => {
    expect(parseInterval('1h')).toBe(3_600_000);
    expect(parseInterval('2hr')).toBe(7_200_000);
  });

  it('parses days', () => {
    expect(parseInterval('1d')).toBe(86_400_000);
    expect(parseInterval('7day')).toBe(604_800_000);
  });

  it('throws on invalid format', () => {
    expect(() => parseInterval('banana')).toThrow('Invalid interval');
    expect(() => parseInterval('')).toThrow('Invalid interval');
  });
});
