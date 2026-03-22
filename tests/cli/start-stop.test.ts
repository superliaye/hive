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
  parseOrgTree: vi.fn(async () => ({
    root: { id: 'ceo', identity: { name: 'CEO' }, childIds: [] },
    agents: new Map([['ceo', { id: 'ceo', identity: { name: 'CEO' }, childIds: [], files: { routine: '' } }]]),
    channels: [],
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
    it('classifies CEO as persistent', () => {
      expect(parseAgentScheduleType({
        id: 'ceo',
        depth: 0,
        files: { routine: '## Heartbeat (every 10min)\nCheck #board' },
      } as any)).toBe('persistent');
    });

    it('classifies depth-0 agents as persistent by default', () => {
      expect(parseAgentScheduleType({
        id: 'ceo',
        depth: 0,
        files: { routine: '' },
      } as any)).toBe('persistent');
    });

    it('classifies depth-1 agents as persistent (VPs)', () => {
      expect(parseAgentScheduleType({
        id: 'vp-eng',
        depth: 1,
        files: { routine: '' },
      } as any)).toBe('persistent');
    });

    it('classifies deep agents as on-demand', () => {
      expect(parseAgentScheduleType({
        id: 'eng-1',
        depth: 2,
        files: { routine: '' },
      } as any)).toBe('on-demand');
    });

    it('classifies agents with explicit on-demand routine as on-demand', () => {
      expect(parseAgentScheduleType({
        id: 'eng-1',
        depth: 1,
        files: { routine: '## Schedule\nType: on-demand' },
      } as any)).toBe('on-demand');
    });
  });
});
