import { describe, it, expect, vi } from 'vitest';
import { Lane, LaneManager } from '../../src/daemon/lane.js';

describe('Lane', () => {
  it('executes tasks in FIFO order', async () => {
    const lane = new Lane('test', 1);
    const order: number[] = [];

    await Promise.all([
      lane.enqueue(async () => { order.push(1); }),
      lane.enqueue(async () => { order.push(2); }),
      lane.enqueue(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('respects concurrency=1 — tasks do not overlap', async () => {
    const lane = new Lane('test', 1);
    let running = 0;
    let maxRunning = 0;

    const task = () => lane.enqueue(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
    });

    await Promise.all([task(), task(), task()]);
    expect(maxRunning).toBe(1);
  });

  it('reports queue size accurately', async () => {
    const lane = new Lane('test', 1);
    let resolve1!: () => void;
    const blocker = new Promise<void>(r => { resolve1 = r; });

    const p1 = lane.enqueue(() => blocker);
    const p2 = lane.enqueue(async () => {});
    const p3 = lane.enqueue(async () => {});

    expect(lane.pending).toBe(2);
    expect(lane.active).toBe(1);

    resolve1();
    await Promise.all([p1, p2, p3]);
    // Allow finally() microtask to settle
    await new Promise(r => setTimeout(r, 0));

    expect(lane.pending).toBe(0);
    expect(lane.active).toBe(0);
  });

  it('propagates task errors without blocking the lane', async () => {
    const lane = new Lane('test', 1);

    const p1 = lane.enqueue(async () => { throw new Error('boom'); });
    const p2 = lane.enqueue(async () => 'ok');

    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe('ok');
  });

  it('drain() resolves when all tasks complete', async () => {
    const lane = new Lane('test', 1);
    const results: number[] = [];

    lane.enqueue(async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push(1);
    });
    lane.enqueue(async () => { results.push(2); });

    await lane.drain();
    expect(results).toEqual([1, 2]);
  });
});

describe('LaneManager', () => {
  it('creates lanes lazily and retrieves by id', () => {
    const mgr = new LaneManager();
    const lane = mgr.get('agent-1');
    expect(lane).toBeInstanceOf(Lane);
    expect(mgr.get('agent-1')).toBe(lane);
  });

  it('drainAll waits for all lanes', async () => {
    const mgr = new LaneManager();
    const results: string[] = [];

    mgr.get('a').enqueue(async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push('a');
    });
    mgr.get('b').enqueue(async () => { results.push('b'); });

    await mgr.drainAll();
    expect(results).toContain('a');
    expect(results).toContain('b');
  });
});
