import { spawn as nodeSpawn } from 'child_process';
import type { SpawnResult } from '../types.js';

export interface ClaudeArgs {
  model: string;
  systemPrompt: string;
  tools: string[];
  outputFormat?: 'json' | 'text';
}

export function buildClaudeArgs(opts: ClaudeArgs): string[] {
  const args: string[] = ['-p', '--model', opts.model, '--system-prompt', opts.systemPrompt];

  if (opts.tools.length > 0) {
    args.push('--allowedTools', opts.tools.join(','));
  }

  if (opts.outputFormat) {
    args.push('--output-format', opts.outputFormat);
  }

  return args;
}

export function buildTriageArgs(triagePrompt: string): string[] {
  return buildClaudeArgs({
    model: 'haiku',
    systemPrompt: triagePrompt,
    tools: [],
    outputFormat: 'json',
  });
}

export async function spawnClaude(
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs?: number },
): Promise<SpawnResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: opts.timeoutMs ?? 300_000, // 5 min default
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
      let tokensIn: number | undefined;
      let tokensOut: number | undefined;
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.usage) {
          tokensIn = parsed.usage.input_tokens;
          tokensOut = parsed.usage.output_tokens;
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
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
