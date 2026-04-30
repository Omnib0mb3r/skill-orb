export interface Observation {
  timestamp: string;
  event:
    | 'tool_start'
    | 'tool_complete'
    | 'user_prompt'
    | 'session_stop'
    | 'parse_error';
  session: string;
  project_id: string;
  project_name: string;
  tool?: string;
  input?: string;
  output?: string;
  prompt?: string;
  cwd?: string;
  raw?: string;
}

export interface ProjectIdentity {
  id: string;
  name: string;
  root: string;
  remote: string | null;
  scope: 'remote' | 'path' | 'global';
}

export interface ProjectRegistryEntry {
  id: string;
  name: string;
  root: string;
  remote: string | null;
  first_seen: string;
  last_seen: string;
}

export interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool?: string;
  tool_input?: unknown;
  input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
  output?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  prompt?: string;
  user_prompt?: string;
}

export type HookPhase =
  | 'pre_tool'
  | 'post_tool'
  | 'user_prompt'
  | 'session_stop';
