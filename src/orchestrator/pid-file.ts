import fs from 'fs';
import path from 'path';

/**
 * Manages a PID file for the orchestrator process.
 * Used by `hive start` / `hive stop` to detect if an orchestrator is already running.
 */
export class PidFile {
  constructor(private filePath: string) {}

  /**
   * Write the current process PID to the file.
   */
  write(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, `${process.pid}\n`);
  }

  /**
   * Read the PID from the file. Returns null if file doesn't exist.
   */
  read(): number | null {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Remove the PID file.
   */
  remove(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // File may not exist — that's fine
    }
  }

  /**
   * Check if the process referenced by the PID file is still running.
   */
  isRunning(): boolean {
    const pid = this.read();
    if (pid === null) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
