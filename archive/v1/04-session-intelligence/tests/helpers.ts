import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export function startMockApiServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Async alternative to spawnSync for running the binary.
 * spawnSync blocks the Node.js event loop, which prevents mock HTTP servers
 * (running in the same process) from handling requests.
 */
export function runBinary(
  args: string[],
  opts: {
    cwd: string;
    input: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, status: code ?? 1 }));
    proc.on('error', reject);

    proc.stdin.write(opts.input, () => proc.stdin.end());

    if (opts.timeoutMs) {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Process timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
      proc.on('close', () => clearTimeout(timer));
    }
  });
}

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'devneural-test-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
