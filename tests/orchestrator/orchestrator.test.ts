import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart } from '../../src/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';

// Mock heartbeat — we test the orchestrator's scheduling, not heartbeat internals
vi.mock('../../src/orchestrator/heartbeat.js', () => ({
  runHeartbeat: vi.fn(async () => ({
    agentId: 'mock',
    messagesProcessed: 0,
    actNowCount: 0,
    queueCount: 0,
    noteCount: 0,
    ignoreCount: 0,
    workPerformed: false,
    durationMs: 10,
  })),
}));

// Mock crash recovery
vi.mock('../../src/orchestrator/crash-recovery.js', () => ({
  recoverStaleAgents: vi.fn(() => ({ recoveredAgents: [], timestamp: new Date() })),
  formatRecoveryAlert: vi.fn(() => ''),
}));

import { Orchestrator, type OrchestratorConfig } from '../../src/orchestrator/orchestrator.js';
import { runHeartbeat } from '../../src/orchestrator/heartbeat.js';
import { recoverStaleAgents } from '../../src/orchestrator/crash-recovery.js';

const mockRunHeartbeat = vi.mocked(runHeartbeat);
const mockRecoverStale = vi.mocked(recoverStaleAgents);

function makePerson(alias: string, overrides: Partial<import('../../src/types.js').Person> = {}): import('../../src/types.js').Person {
  return {
    id: 1,
    alias,
    name: alias.toUpperCase(),
    status: 'active' as const,
    ...overrides,
  };
}

function makeAgent(alias: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  const person = overrides.person ?? makePerson(alias);
  return {
    person,
    identity: { name: alias, role: 'Engineer', model: 'sonnet' },
    dir: `/tmp/org/${person.id}-${alias}`,
    reportsTo: makePerson('ceo', { id: 99 }),
    directReports: [],
    files: {
      identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', protocols: '', skills: '',
    },
    ...overrides,
  };
}

function makeOrgChart(agents: AgentConfig[]): OrgChart {
  const agentMap = new Map(agents.map(a => [a.person.alias, a]));
  return {
    agents: agentMap,
    people: agents.map(a => a.person),
  };
}

describe('Orchestrator', () => {
  let tmpDir: string;
  let stateDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-orch-'));
    stateDbPath = path.join(tmpDir, 'orchestrator.db');
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
    const ceoPerson = makePerson('ceo', { id: 1 });
    const eng1Person = makePerson('eng-1', { id: 2 });
    const ceo = makeAgent('ceo', { person: ceoPerson, reportsTo: null, directReports: [eng1Person] });
    const eng1 = makeAgent('eng-1', { person: eng1Person, reportsTo: ceoPerson });
    return {
      orgChart: makeOrgChart([ceo, eng1]),
      stateDbPath,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      persistentAgentIds: ['ceo'],
      persistentIntervalMs: 600_000,    // 10 min
      onDemandIntervalMs: 7_200_000,    // 2 hours
      getUnread: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      postMessage: vi.fn(async () => {}),
      appendToMemory: vi.fn(async () => {}),
      appendToPriorities: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('registers all agents in state store on start', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    const stateStore = orch.getStateStore();
    expect(stateStore.get('ceo')).toBeDefined();
    expect(stateStore.get('eng-1')).toBeDefined();

    await orch.stop();
  });

  it('runs crash recovery on start', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    expect(mockRecoverStale).toHaveBeenCalledOnce();

    await orch.stop();
  });

  it('schedules persistent agents at the configured interval', async () => {
    const config = makeConfig({ persistentIntervalMs: 1000 });
    const orch = new Orchestrator(config);
    await orch.start();

    // Advance time to trigger heartbeat
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockRunHeartbeat).toHaveBeenCalled();
    const calls = mockRunHeartbeat.mock.calls;
    const ceoCall = calls.find(c => c[0].agent.person.alias === 'ceo');
    expect(ceoCall).toBeDefined();

    await orch.stop();
  });

  it('schedules on-demand agents at a longer interval', async () => {
    const config = makeConfig({
      persistentIntervalMs: 1000,
      onDemandIntervalMs: 5000,
    });
    const orch = new Orchestrator(config);
    await orch.start();

    // At 1s, only persistent agents should fire
    await vi.advanceTimersByTimeAsync(1000);
    const callsAt1s = mockRunHeartbeat.mock.calls.length;

    // At 5s, on-demand agents should also fire
    await vi.advanceTimersByTimeAsync(4000);
    const callsAt5s = mockRunHeartbeat.mock.calls.length;

    expect(callsAt5s).toBeGreaterThan(callsAt1s);

    await orch.stop();
  });

  it('stops gracefully — clears all intervals', async () => {
    const orch = new Orchestrator(makeConfig({ persistentIntervalMs: 1000 }));
    await orch.start();
    expect(orch.isRunning()).toBe(true);

    await orch.stop();
    expect(orch.isRunning()).toBe(false);

    // Advance time — no more heartbeats should fire
    const callsBefore = mockRunHeartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockRunHeartbeat.mock.calls.length).toBe(callsBefore);
  });

  it('writes PID file on start and removes on stop', async () => {
    const pidPath = path.join(tmpDir, 'hive.pid');
    const orch = new Orchestrator(makeConfig({ pidFilePath: pidPath }));

    await orch.start();
    expect(fs.existsSync(pidPath)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    expect(pid).toBe(process.pid);

    await orch.stop();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('rejects start if already running', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    await expect(orch.start()).rejects.toThrow(/already running/i);

    await orch.stop();
  });

  it('triggerAgent runs an immediate heartbeat for on-demand agents', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    await orch.triggerAgent('eng-1');

    const calls = mockRunHeartbeat.mock.calls;
    const eng1Call = calls.find(c => c[0].agent.person.alias === 'eng-1');
    expect(eng1Call).toBeDefined();

    await orch.stop();
  });

  it('waits for in-flight heartbeats on stop', async () => {
    let resolveHeartbeat: () => void;
    const heartbeatPromise = new Promise<void>((resolve) => { resolveHeartbeat = resolve; });

    mockRunHeartbeat.mockImplementationOnce(async (ctx) => {
      await heartbeatPromise;
      return {
        agentId: ctx.agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 100,
      };
    });

    const config = makeConfig({ persistentIntervalMs: 100 });
    const orch = new Orchestrator(config);
    await orch.start();

    // Trigger a heartbeat
    await vi.advanceTimersByTimeAsync(100);

    // Start stop — should wait for in-flight
    const stopPromise = orch.stop();
    let stopped = false;
    stopPromise.then(() => { stopped = true; });

    // Not yet stopped — heartbeat still running
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    // Resolve the heartbeat
    resolveHeartbeat!();
    await stopPromise;

    expect(stopped).toBe(true);
  });
});
