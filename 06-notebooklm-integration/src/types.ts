export interface ObsidianSyncConfig {
  vault_path: string;
  notes_subfolder: string;
  data_root: string;
  api_base_url: string;
  prepend_sessions: boolean;
  claude_model: string;
}

export interface LogEntry {
  timestamp: string;
  project: string;
  source_node: string;
  target_node: string;
  connection_type: string;
  stage?: string;
  tags?: string[];
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface ConnectionEvent {
  source_node: string;
  target_node: string;
  connection_type: 'project->tool' | 'project->skill' | 'project->project' | 'tool->skill' | string;
  timestamp: string;
}

export interface SessionData {
  date: string;
  primary_project: string;
  all_projects: string[];
  entries: LogEntry[];
  session_start: string;
  session_end: string;
  connection_events: ConnectionEvent[];
}

export interface GraphInsight {
  type: 'new_connection' | 'high_weight' | 'weight_milestone';
  source_node: string;
  target_node: string;
  weight: number;
  raw_count: number;
  description: string;
}

export interface SessionSummary {
  date: string;
  project: string;
  what_i_worked_on: string;
  graph_insights: string[];
  lessons_learned: string;
}
