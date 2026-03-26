import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the orchestrator module
vi.mock('../../src/orchestrator/orchestrator.js', () => {
  const mockStart = vi.fn(async () => {});
  const mockStop = vi.fn(async () => {});
  const mockIsRunning = vi.fn(() => false);

  return {
    Orchestrator: vi.fn().mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      isRunning: mockIsRunning,
      getStateStore: vi.fn(() => ({
        listAll: vi.fn(() => []),
        close: vi.fn(),
      })),
    })),
    __mockStart: mockStart,
    __mockStop: mockStop,
    __mockIsRunning: mockIsRunning,
  };
});

// Mock the org parser
vi.mock('../../src/org/parser.js', () => ({
  parseOrgFlat: vi.fn(async () => ({
    agents: new Map([['ceo', {
      person: { id: 1, alias: 'ceo', name: 'CEO', status: 'active' },
      dir: '/tmp/org/1-ceo',
      reportsTo: null,
      directReports: [],
      files: { identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', protocols: '', skills: '' },
      identity: { name: 'CEO', role: 'CEO', model: 'sonnet' },
    }]]),
    people: [{ id: 1, alias: 'ceo', name: 'CEO', status: 'active' }],
  })),
}));

// Mock the PidFile
vi.mock('../../src/orchestrator/pid-file.js', () => ({
  PidFile: vi.fn().mockImplementation(() => ({
    isRunning: vi.fn(() => false),
    read: vi.fn(() => null),
    write: vi.fn(),
    remove: vi.fn(),
  })),
}));

import {
  buildStartConfig,
  parseAgentScheduleType,
} from '../../src/orchestrator/cli-helpers.js';

describe('CLI Helpers', () => {
  describe('parseAgentScheduleType', () => {
    it('classifies CEO (no reportsTo) as persistent', () => {
      expect(parseAgentScheduleType({
        person: { id: 1, alias: 'ceo', name: 'CEO', status: 'active' as const },
        reportsTo: null,
        directReports: [],
        files: { identity: '', soul: '', bureau: '', priorities: '', routine: '## Heartbeat (every 10min)\nCheck #board', memory: '', protocols: '', skills: '' },
        identity: { name: 'CEO', role: 'CEO', model: 'sonnet' },
        dir: '/tmp/org/1-ceo',
      } as any)).toBe('persistent');
    });

    it('classifies agents with no reportsTo as persistent by default', () => {
      expect(parseAgentScheduleType({
        person: { id: 1, alias: 'ceo', name: 'CEO', status: 'active' as const },
        reportsTo: null,
        directReports: [],
        files: { identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', protocols: '', skills: '' },
        identity: { name: 'CEO', role: 'CEO', model: 'sonnet' },
        dir: '/tmp/org/1-ceo',
      } as any)).toBe('persistent');
    });

    it('classifies agents with reportsTo as on-demand by default', () => {
      const manager = { id: 1, alias: 'ceo', name: 'CEO', status: 'active' as const };
      expect(parseAgentScheduleType({
        person: { id: 3, alias: 'eng-1', name: 'Engineer 1', status: 'active' as const, reportsTo: 1 },
        reportsTo: manager,
        directReports: [],
        files: { identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', protocols: '', skills: '' },
        identity: { name: 'Engineer 1', role: 'Backend Software Engineer', model: 'sonnet' },
        dir: '/tmp/org/3-eng-1',
      } as any)).toBe('on-demand');
    });

    it('classifies agents with explicit on-demand routine as on-demand', () => {
      expect(parseAgentScheduleType({
        person: { id: 2, alias: 'ar', name: 'AR', status: 'active' as const, reportsTo: 1 },
        reportsTo: null,
        directReports: [],
        files: { identity: '', soul: '', bureau: '', priorities: '', routine: '## Schedule\nType: on-demand', memory: '', protocols: '', skills: '' },
        identity: { name: 'AR', role: 'Agent Resources Manager', model: 'sonnet' },
        dir: '/tmp/org/2-ar',
      } as any)).toBe('on-demand');
    });
  });
});
