// ── Connection types ──────────────────────────────────────────────────────────

/**
 * How a project identifier was derived from the working directory.
 * 'git-remote' is the most canonical; 'cwd' is the fallback.
 */
export type ProjectSource = 'git-remote' | 'git-root' | 'cwd';

/**
 * The type of directed edge in the connection graph.
 * NOTE: ASCII arrows (`->`) are used intentionally instead of Unicode U+2192 (`→`).
 * Unicode arrows cause encoding corruption in weights.json on Windows cp1252 terminals
 * and silent key-lookup failures when connection keys span encoding boundaries.
 * NOTE: 'skill->tool' is deliberately absent — it requires a SubagentStop hook
 * and is deferred beyond this implementation.
 */
export type ConnectionType = 'project->tool' | 'project->skill' | 'project->project';

// ── Hook payload ──────────────────────────────────────────────────────────────

/**
 * The JSON payload Claude Code sends on stdin for every PostToolUse event.
 */
export interface HookPayload {
  hook_event_name: 'PostToolUse';
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
  transcript_path: string;
  permission_mode: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Runtime configuration. Loaded from <dataRoot>/config.json and merged with defaults.
 */
export interface Config {
  /** Tool names that trigger logging. Default: ["Bash", "Write", "Edit", "Agent"] */
  allowlist: string[];
  /** Absolute path to the shared data directory. Default: "C:/dev/data/skill-connections" */
  data_root: string;
}

// ── Project identity ──────────────────────────────────────────────────────────

/**
 * Resolved canonical identifier for a project and how it was derived.
 */
export interface ProjectIdentity {
  id: string;
  source: ProjectSource;
}

// ── Log entry ─────────────────────────────────────────────────────────────────

/**
 * One line written to the daily JSONL log file per qualifying hook event.
 */
export interface LogEntry {
  schema_version: 1;
  timestamp: string;                      // ISO 8601 UTC
  session_id: string;                     // from HookPayload
  tool_use_id: string;                    // unique per tool invocation
  project: string;                        // canonical project id
  project_source: ProjectSource;          // how project was resolved
  tool_name: string;                      // from HookPayload
  tool_input: Record<string, unknown>;    // from HookPayload (full, untruncated)
  connection_type: ConnectionType;
  source_node: string;                    // prefixed: "project:<id>"
  target_node: string;                    // prefixed: "tool:<name>", "skill:<name>", "project:<id>"
  stage?: string;                         // from devneural.json — log enrichment only
  tags?: string[];                        // from devneural.json — log enrichment only
}

// ── Weight graph ──────────────────────────────────────────────────────────────

/**
 * A single directed weighted edge in the connection graph.
 * Key in WeightsFile.connections: "<source_node>||<target_node>"
 */
export interface ConnectionRecord {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;    // unbounded total observations
  weight: number;       // min(raw_count, 100) / 100 * 10 — range [0.0, 10.0]
  first_seen: string;   // ISO 8601 UTC
  last_seen: string;    // ISO 8601 UTC
}

/**
 * The full JSON document stored in weights.json.
 */
export interface WeightsFile {
  schema_version: 1;
  updated_at: string;                              // ISO 8601 UTC, updated on every save
  connections: Record<string, ConnectionRecord>;   // keyed by connection key
}

// ── Hook runner internals ─────────────────────────────────────────────────────

/**
 * A single derived graph edge produced from one tool invocation.
 * One invocation may produce multiple DerivedConnections (e.g., project->tool + project->project).
 */
export interface DerivedConnection {
  connectionType: ConnectionType;
  sourceNode: string;
  targetNode: string;
}
