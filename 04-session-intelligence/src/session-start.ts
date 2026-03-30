import { resolveProjectIdentity } from './identity';
import { fetchSubgraph, buildApiConfig } from './api-client';
import { formatSubgraph } from './formatter';
import type { FormatterConfig } from './formatter';
import * as path from 'node:path';

interface HookPayload {
  session_id?: string;
  cwd: string;
  hook_event_name: string;
  source?: string;
  transcript_path?: string;
  model?: string;
}

async function main(): Promise<void> {
  // 1. Read stdin
  process.stdin.setEncoding('utf8');
  let rawStdin = '';
  for await (const chunk of process.stdin) {
    rawStdin += chunk;
  }

  // 2. Parse payload — silent exit on bad input
  let payload: HookPayload;
  try {
    payload = JSON.parse(rawStdin) as HookPayload;
  } catch {
    process.exit(0);
  }
  if (!payload.cwd) {
    process.exit(0);
  }

  // 3. Resolve project identity (never throws; falls back to dirname/basename)
  const identity = await resolveProjectIdentity(payload.cwd);

  // 4. Build API config and fetch subgraph
  const apiConfig = buildApiConfig();
  const response = await fetchSubgraph(identity.id, apiConfig);

  // 5. Handle offline API
  if (response === null) {
    const serverPath = path
      .resolve(__dirname, '../../02-api-server/dist/server.js')
      .replace(/\\/g, '/');
    process.stdout.write(`DevNeural: API offline. Start the server with:\n  node ${serverPath}\n`);
    process.exit(0);
  }

  // 6. Format and write output
  const formatterConfig: FormatterConfig = {
    maxResultsPerType: 10,
    minWeight: 1.0,
  };
  const output = formatSubgraph(identity.id, response, formatterConfig);
  process.stdout.write(output + '\n');

  // 7. Explicit exit prevents hanging async handles
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(0);
});
