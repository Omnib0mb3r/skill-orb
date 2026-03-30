import { resolveProjectIdentity } from './identity/index';
import { parseIntent } from './intent/parser';
import { executeIntentRequest } from './routing/intent-map';
import { buildApiConfig } from './routing/api-client';
import { formatResponse } from './formatter/response';
import { sendOrbEvents } from './formatter/orb-events';

const CLARIFICATION_MSG =
  "I'm not sure what you mean — try asking about connections, skills, or your current project.\n";

async function main(): Promise<void> {
  const query = (process.argv[2] ?? '').trim();

  if (!query) {
    process.stdout.write(CLARIFICATION_MSG);
    return;
  }

  const identity = await resolveProjectIdentity(process.cwd());
  const projectId = identity?.id ?? '';
  const parsed = await parseIntent(query);

  if (parsed.clarification) {
    process.stdout.write(CLARIFICATION_MSG);
    return;
  }

  const config = buildApiConfig();
  const apiResult = await executeIntentRequest(parsed, projectId, config);
  const text = formatResponse(parsed, apiResult?.data ?? null, parsed.hedging);

  let output = text;
  // Only prefix with Haiku-unavailable message when API result is available —
  // if apiResult is null the formatter already provides the "isn't running" message.
  if (parsed.unreachable && apiResult !== null) {
    output = `I couldn't reach the AI assistant, but here's what I could parse locally: ${text}`;
  }

  sendOrbEvents(parsed, apiResult?.data ?? null).catch(() => { /* best-effort */ });
  process.stdout.write(output + '\n');
}

main().catch(() => {
  process.stdout.write('An unexpected error occurred.\n');
});
