import { spawn as nodeSpawn } from 'child_process';
import type { SpawnResult } from '../types.js';

export interface ClaudeArgs {
  model: string;
  systemPrompt: string;
  outputFormat?: 'json' | 'text';
}

export function buildClaudeArgs(opts: ClaudeArgs): string[] {
  const args: string[] = ['-p', '--model', opts.model, '--system-prompt', opts.systemPrompt];

  if (opts.outputFormat) {
    args.push('--output-format', opts.outputFormat);
  }

  return args;
}

/**
 * Build git environment variables for an agent.
 * Sets author AND committer so all git operations (commit, rebase, cherry-pick)
 * are attributed to the agent. Push still uses the shared GitHub credentials.
 */
export function buildAgentGitEnv(alias: string, name: string): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: `${name} (hive/${alias})`,
    GIT_AUTHOR_EMAIL: `${alias}@hive.local`,
    GIT_COMMITTER_NAME: `${name} (hive/${alias})`,
    GIT_COMMITTER_EMAIL: `${alias}@hive.local`,
  };
}

export function buildTriageArgs(triagePrompt: string): string[] {
  return buildClaudeArgs({
    model: 'haiku',
    systemPrompt: triagePrompt,
    outputFormat: 'json',
  });
}

export async function spawnClaude(
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs?: number; env?: Record<string, string> },
): Promise<SpawnResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    // Unset CLAUDECODE to allow spawning Claude CLI from within a Claude Code session
    const env = { ...process.env, ...opts.env };
    delete env.CLAUDECODE;

    const proc = nodeSpawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: opts.timeoutMs, // No default timeout — let agents work until done
      env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    if (opts.input) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      // Try to extract token usage from JSON output (claude --output-format json)
      // Claude CLI reports: input_tokens (user msg only), cache_creation_input_tokens,
      // cache_read_input_tokens. Sum all for true input cost.
      let tokensIn: number | undefined;
      let tokensOut: number | undefined;
      let cacheReadTokens: number | undefined;
      let cacheCreationTokens: number | undefined;
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.usage) {
          const u = parsed.usage;
          cacheReadTokens = u.cache_read_input_tokens ?? 0;
          cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
          tokensIn = (u.input_tokens ?? 0)
            + cacheCreationTokens
            + cacheReadTokens;
          tokensOut = u.output_tokens;
        }
      } catch {
        // Non-JSON output — no token info available
      }

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
        tokensIn,
        tokensOut,
        cacheReadTokens,
        cacheCreationTokens,
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
