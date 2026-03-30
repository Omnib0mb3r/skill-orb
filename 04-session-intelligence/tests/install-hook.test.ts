import { describe, it, expect } from 'vitest';
import { mergeHooks, buildHookEntry } from '../src/install-hook';

const FAKE_COMMAND = 'node "/some/test/path/session-start.js"';

describe('mergeHooks', () => {
  it('installs 4 entries when SessionStart is empty', () => {
    const result = mergeHooks({}, FAKE_COMMAND);
    const sessionStart = (result.hooks as Record<string, unknown[]>).SessionStart;
    expect(sessionStart).toHaveLength(4);
    const matchers = sessionStart.map((e: any) => e.matcher);
    expect(matchers).toContain('startup');
    expect(matchers).toContain('resume');
    expect(matchers).toContain('clear');
    expect(matchers).toContain('compact');
  });

  it('is idempotent: running twice produces no duplicates', () => {
    const result1 = mergeHooks({}, FAKE_COMMAND);
    const result2 = mergeHooks(result1, FAKE_COMMAND);
    // Same reference returned (early-exit identity contract)
    expect(result2).toBe(result1);
    const sessionStart = (result2.hooks as Record<string, unknown[]>).SessionStart;
    expect(sessionStart).toHaveLength(4);
  });

  it('deduplicates when an existing entry has no matcher field', () => {
    const settingsWithMatcherlessEntry = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node "/old/install/path/session-start.js"',
              },
            ],
          },
        ],
      },
    };
    const result = mergeHooks(settingsWithMatcherlessEntry, FAKE_COMMAND);
    const sessionStart = (result.hooks as Record<string, unknown[]>).SessionStart;
    // Already present by command-string scan — no new entries added
    expect(sessionStart).toHaveLength(1);
  });

  it('preserves all other settings fields', () => {
    const settings = {
      env: { FOO: 'bar' },
      permissions: { allow: ['Bash'] },
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: 'echo test' }] }],
      },
    };
    const result = mergeHooks(settings, FAKE_COMMAND);
    expect((result as any).env).toEqual({ FOO: 'bar' });
    expect((result as any).permissions).toEqual({ allow: ['Bash'] });
    expect((result.hooks as any).PostToolUse).toHaveLength(1);
  });

  it('produces valid output: all 4 entries have type "command" and command containing session-start.js', () => {
    const result = mergeHooks({}, FAKE_COMMAND);
    const sessionStart = (result.hooks as Record<string, any[]>).SessionStart;
    for (const entry of sessionStart) {
      expect(Array.isArray(entry.hooks)).toBe(true);
      expect(entry.hooks[0].type).toBe('command');
      expect(entry.hooks[0].command).toContain('session-start.js');
    }
  });

  it('only the startup entry has a statusMessage', () => {
    const result = mergeHooks({}, FAKE_COMMAND);
    const sessionStart = (result.hooks as Record<string, any[]>).SessionStart;

    const startupEntry = sessionStart.find((e: any) => e.matcher === 'startup');
    expect(startupEntry).toBeDefined();
    expect(startupEntry.hooks[0].statusMessage).toBe('Loading DevNeural context...');

    const nonStartupEntries = sessionStart.filter((e: any) => e.matcher !== 'startup');
    for (const entry of nonStartupEntries) {
      expect(entry.hooks[0].statusMessage).toBeUndefined();
    }
  });
});

describe('buildHookEntry', () => {
  it('returns correct structure for startup (with statusMessage)', () => {
    const entry = buildHookEntry(FAKE_COMMAND, 'startup', true) as any;
    expect(entry.matcher).toBe('startup');
    expect(entry.hooks[0].type).toBe('command');
    expect(entry.hooks[0].command).toBe(FAKE_COMMAND);
    expect(entry.hooks[0].timeout).toBe(10);
    expect(entry.hooks[0].statusMessage).toBeDefined();
  });

  it('returns correct structure for non-startup (no statusMessage)', () => {
    const entry = buildHookEntry(FAKE_COMMAND, 'resume', false) as any;
    expect(entry.matcher).toBe('resume');
    expect(entry.hooks[0].statusMessage).toBeUndefined();
    expect(entry.hooks[0].timeout).toBe(10);
  });
});
