export interface ServerConfig {
  port: number;
  dataRoot: string;
}

export function loadConfig(): ServerConfig {
  const portRaw = process.env.PORT ?? '3747';
  const dataRoot = process.env.DEVNEURAL_DATA_ROOT ?? 'C:/dev/data/skill-connections';

  if (dataRoot.trim() === '') {
    process.stderr.write('Invalid DEVNEURAL_DATA_ROOT: must be a non-empty string.\n');
    process.exit(1);
  }

  const trimmed = portRaw.trim();
  if (!/^\d+$/.test(trimmed)) {
    process.stderr.write(
      `Invalid PORT: '${portRaw}' is not a valid integer. Expected 1-65535.\n`
    );
    process.exit(1);
  }

  const portNum = parseInt(trimmed, 10);
  if (portNum < 1 || portNum > 65535) {
    process.stderr.write(
      `Invalid PORT: ${portNum} is out of range. Expected 1-65535.\n`
    );
    process.exit(1);
  }

  return { port: portNum, dataRoot };
}
