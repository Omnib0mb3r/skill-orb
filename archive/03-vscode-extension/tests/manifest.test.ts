import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>;

type ConfigProp = { type: string; default: unknown; minimum?: number; maximum?: number };
type Command = { command: string };

describe('package.json manifest', () => {
  it('contributes.commands includes devneural.openGraphView', () => {
    const commands = (pkg.contributes as { commands: Command[] }).commands;
    expect(commands.some(c => c.command === 'devneural.openGraphView')).toBe(true);
  });

  it('contributes.configuration includes devneural.apiServerHost with type string and default localhost', () => {
    const props = (pkg.contributes as { configuration: { properties: Record<string, ConfigProp> } }).configuration.properties;
    expect(props['devneural.apiServerHost'].type).toBe('string');
    expect(props['devneural.apiServerHost'].default).toBe('localhost');
  });

  it('contributes.configuration includes devneural.apiServerPort with type number, default 3747, min 1024, max 65535', () => {
    const props = (pkg.contributes as { configuration: { properties: Record<string, ConfigProp> } }).configuration.properties;
    expect(props['devneural.apiServerPort'].type).toBe('number');
    expect(props['devneural.apiServerPort'].default).toBe(3747);
    expect(props['devneural.apiServerPort'].minimum).toBe(1024);
    expect(props['devneural.apiServerPort'].maximum).toBe(65535);
  });

  it('contributes.configuration includes devneural.localReposRoot with type string and default empty string', () => {
    const props = (pkg.contributes as { configuration: { properties: Record<string, ConfigProp> } }).configuration.properties;
    expect(props['devneural.localReposRoot'].type).toBe('string');
    expect(props['devneural.localReposRoot'].default).toBe('');
  });

  it('contributes.configuration includes devneural.recencyFading with type boolean and default true', () => {
    const props = (pkg.contributes as { configuration: { properties: Record<string, ConfigProp> } }).configuration.properties;
    expect(props['devneural.recencyFading'].type).toBe('boolean');
    expect(props['devneural.recencyFading'].default).toBe(true);
  });

  it('activationEvents includes onCommand:devneural.openGraphView', () => {
    expect(pkg.activationEvents as string[]).toContain('onCommand:devneural.openGraphView');
  });

  it('activationEvents includes onWebviewPanel:devneuralGraph', () => {
    expect(pkg.activationEvents as string[]).toContain('onWebviewPanel:devneuralGraph');
  });
});
