/**
 * MemoryManager: manages per-agent MemoryStore instances.
 * Each agent gets its own SQLite DB at data/memory/{agentId}.sqlite.
 */
import path from 'path';
import fs from 'fs';
import { MemoryStore } from './store.js';
import { indexAgent } from './indexer.js';
import { searchMemory, type SearchResult } from './search.js';

export class MemoryManager {
  private stores = new Map<string, MemoryStore>();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = path.join(dataDir, 'memory');
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  /** Get or create the memory store for an agent. */
  getStore(agentId: string): MemoryStore {
    let store = this.stores.get(agentId);
    if (!store) {
      const dbPath = path.join(this.dataDir, `${agentId}.sqlite`);
      store = new MemoryStore(dbPath);
      this.stores.set(agentId, store);
    }
    return store;
  }

  /** Index all memory files for an agent (MEMORY.md + memory/*.md). Skips unchanged files. */
  async indexAgent(agentId: string, agentDir: string, log?: (msg: string) => void): Promise<{ indexed: number; skipped: number; chunks: number }> {
    const store = this.getStore(agentId);
    return indexAgent(store, agentDir, log);
  }

  /** Search an agent's memory. Returns ranked results. */
  async search(agentId: string, query: string, limit: number = 10): Promise<SearchResult[]> {
    const store = this.getStore(agentId);
    if (store.chunkCount() === 0) return [];
    return searchMemory(store, query, limit);
  }

  /** Index all agents in parallel. */
  async indexAll(agents: Map<string, { dir: string; person: { alias: string } }>, log?: (msg: string) => void): Promise<void> {
    const promises = Array.from(agents.values()).map(agent =>
      this.indexAgent(agent.person.alias, agent.dir, log).catch(err => {
        log?.(`[memory] Error indexing ${agent.person.alias}: ${err.message}`);
      })
    );
    await Promise.all(promises);
  }

  /** Close all stores. */
  close(): void {
    for (const store of this.stores.values()) {
      store.close();
    }
    this.stores.clear();
  }
}
