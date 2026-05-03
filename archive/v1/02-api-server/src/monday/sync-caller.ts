// src/monday/sync-caller.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function callMondaySync(): Promise<{
  created: string[];
  moved: string[];
  errors: { project: string; error: string }[];
}> {
  const mondayScript = process.env.MONDAY_SYNC_SCRIPT ?? 'c:/dev/Projects/devneural-projects/scripts/sync.mjs';
  try {
    const { stdout } = await execFileAsync('node', [mondayScript], {
      timeout: 30_000,
      env: process.env,
    });
    return JSON.parse(stdout) as { created: string[]; moved: string[]; errors: { project: string; error: string }[] };
  } catch (err) {
    throw new Error(`Monday sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
