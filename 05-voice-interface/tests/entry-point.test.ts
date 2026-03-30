import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

const ENTRY = path.resolve(__dirname, '../dist/index.js');
const NO_MARKDOWN = /[*#`•\[\]_>|]/;

function run(args: string[], env?: Record<string, string>) {
  return spawnSync('node', [ENTRY, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...env },
  });
}

describe('entry-point subprocess', () => {
  it('exits 0 on a skills query', () => {
    const result = run(['what skills am I using most?']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBeTruthy();
  });

  it('stdout contains no markdown characters', () => {
    const result = run(['what skills am I using most?']);
    expect(result.stdout).not.toMatch(NO_MARKDOWN);
  });

  it('exits 0 with clarification message for empty string argument', () => {
    const result = run(['']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not sure what you mean/i);
  });

  it('exits 0 with clarification message when no argument given', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not sure what you mean/i);
  });

  it("exits 0 and includes \"isn't running\" when API is unavailable", () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("isn't running");
  });

  it('output does not stack "AI assistant" and "isn\'t running" messages when API is down with local parse', () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    // Should not contain the unreachable prefix when API is down — formatResponse handles it
    expect(result.stdout).not.toContain("I couldn't reach the AI assistant");
  });

  it('server path in unavailable message ends with 02-api-server/dist/server.js', () => {
    const result = run(['what skills am I using most?'], {
      DEVNEURAL_API_URL: 'http://localhost:19998',
    });
    expect(result.stdout).toMatch(/02-api-server[\\/]dist[\\/]server\.js/);
  });
});
