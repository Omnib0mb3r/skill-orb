export type IntentName =
  | 'get_context'
  | 'get_top_skills'
  | 'get_connections'
  | 'get_node'
  | 'get_stages'
  | 'unknown';

export interface IntentResult {
  intent: IntentName;
  /** Normalized confidence in the range 0.0–1.0. */
  confidence: number;
  entities: {
    /** Project or skill name mentioned in the query, as typed by the user. */
    nodeName?: string;
    /** Stage filter string: 'alpha' | 'beta' | 'deployed' | 'archived'. */
    stageFilter?: string;
    /** Requested result count for top-N queries. */
    limit?: number;
  };
  /** Which parser resolved the intent. */
  source: 'local' | 'haiku';
}

export interface VoiceResponse {
  /** Formatted natural-language text for the Claude chat output. */
  text: string;
  /**
   * Optional WebSocket event to send to the orb.
   * Undefined if no visual action is needed (e.g., clarification responses).
   */
  orbEvent?: {
    type: 'voice:focus' | 'voice:highlight' | 'voice:clear';
    payload: unknown;
  };
}
