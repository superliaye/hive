import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectChannelRegistry, parseBureauDirectChannels } from '../../src/daemon/direct-channel.js';

describe('parseBureauDirectChannels', () => {
  it('parses direct channels from BUREAU.md content', () => {
    const bureau = `# Bureau
## Position
Reports to: Super User

## Direct Channels
- #board — immediate (from super-user)
- #leadership — immediate (from reports)
`;
    const channels = parseBureauDirectChannels(bureau);
    expect(channels).toEqual([
      { channel: 'board', label: 'immediate (from super-user)' },
      { channel: 'leadership', label: 'immediate (from reports)' },
    ]);
  });

  it('returns empty array when no Direct Channels section', () => {
    const bureau = `# Bureau\n## Position\nReports to: Nobody`;
    expect(parseBureauDirectChannels(bureau)).toEqual([]);
  });
});

describe('DirectChannelRegistry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('triggers callback for agent when message arrives on direct channel', () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board', 'leadership']);

    registry.signal('board');
    expect(onTrigger).not.toHaveBeenCalled();

    vi.advanceTimersByTime(101);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith('ceo');
  });

  it('coalesces multiple signals within the window', () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board']);

    registry.signal('board');
    registry.signal('board');
    registry.signal('board');

    vi.advanceTimersByTime(101);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('triggers multiple agents if they share a channel', () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['leadership']);
    registry.register('platform-eng', ['leadership']);

    registry.signal('leadership');
    vi.advanceTimersByTime(101);

    expect(onTrigger).toHaveBeenCalledTimes(2);
    const agentIds = onTrigger.mock.calls.map((c: unknown[]) => c[0]);
    expect(agentIds).toContain('ceo');
    expect(agentIds).toContain('platform-eng');
  });

  it('ignores signals for non-direct channels', () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board']);

    registry.signal('all-hands');
    vi.advanceTimersByTime(200);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
