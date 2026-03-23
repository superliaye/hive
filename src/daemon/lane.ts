/**
 * A FIFO async queue with configurable concurrency.
 * Each agent gets one lane with concurrency=1, ensuring
 * no overlapping invocations per agent while allowing
 * cross-agent parallelism.
 */
export class Lane {
  readonly id: string;
  private readonly maxConcurrent: number;
  private _active = 0;
  private queue: Array<{ task: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  constructor(id: string, maxConcurrent = 1) {
    this.id = id;
    this.maxConcurrent = maxConcurrent;
  }

  get active(): number { return this._active; }
  get pending(): number { return this.queue.length; }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.flush();
    });
  }

  async drain(): Promise<void> {
    while (this._active > 0 || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 5));
    }
  }

  private flush(): void {
    while (this._active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this._active++;
      item.task()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this._active--;
          this.flush();
        });
    }
  }
}

/**
 * Manages a set of named lanes.
 * Lazily creates lanes on first access.
 */
export class LaneManager {
  private lanes = new Map<string, Lane>();

  get(id: string, maxConcurrent = 1): Lane {
    let lane = this.lanes.get(id);
    if (!lane) {
      lane = new Lane(id, maxConcurrent);
      this.lanes.set(id, lane);
    }
    return lane;
  }

  async drainAll(): Promise<void> {
    await Promise.all([...this.lanes.values()].map(l => l.drain()));
  }

  allLanes(): Lane[] {
    return [...this.lanes.values()];
  }
}
