import * as natural from 'natural';
import { IntentName, IntentResult } from './types';

// ---------------------------------------------------------------------------
// Keyword phrase table
// A query matches a phrase group when ALL phrases in the group appear in the
// lowercased query. Each intent can have multiple groups (OR logic between groups).
// ---------------------------------------------------------------------------
const KEYWORD_TABLE: Record<IntentName, string[][]> = {
  get_top_skills: [
    ['skills', 'most'],
    ['top', 'skills'],
    ['skills', 'use'],
    ['skills', 'used'],
    ['most', 'used', 'skills'],
    ['frequently', 'skills'],
  ],
  get_context: [
    ['current context'],
    ['working on'],
    ['current project'],
    ['my context'],
    ['what am i doing'],
  ],
  get_stages: [
    ['alpha'],
    ['beta'],
    ['deployed'],
    ['archived'],
    ['stage'],
    ['stages'],
  ],
  get_connections: [
    ['connected to'],
    ['connections for'],
    ['connects to'],
    ['what connects'],
    ['linked to'],
    ['dependencies of'],
  ],
  get_node: [
    ['tell me about'],
    ['what is'],
    ['describe'],
    ['info on'],
    ['information about'],
  ],
  unknown: [],
};

// Fixed fast-path confidence values per intent
const FAST_PATH_CONFIDENCE: Partial<Record<IntentName, number>> = {
  get_top_skills: 0.95,
  get_context: 0.95,
  get_stages: 0.95,
  get_connections: 0.90,
  get_node: 0.90,
};

// ---------------------------------------------------------------------------
// Training examples for BayesClassifier (~20 per intent)
// ---------------------------------------------------------------------------
interface TrainingExample {
  text: string;
  intent: IntentName;
}

const TRAINING_EXAMPLES: TrainingExample[] = [
  // get_context
  { text: 'what am I currently working on', intent: 'get_context' },
  { text: 'show my current context', intent: 'get_context' },
  { text: 'what project am I on', intent: 'get_context' },
  { text: 'give me my context', intent: 'get_context' },
  { text: 'what session context do I have', intent: 'get_context' },
  { text: 'summarize what I am doing', intent: 'get_context' },
  { text: 'current work summary', intent: 'get_context' },
  { text: 'what have I been working on', intent: 'get_context' },
  { text: 'my active project', intent: 'get_context' },
  { text: 'what is my focus', intent: 'get_context' },
  { text: 'recent activity context', intent: 'get_context' },
  { text: 'show context', intent: 'get_context' },
  { text: 'current focus area', intent: 'get_context' },
  { text: 'what files am I editing', intent: 'get_context' },
  { text: 'session summary', intent: 'get_context' },
  { text: 'tell me what I am doing', intent: 'get_context' },
  { text: 'project status', intent: 'get_context' },
  { text: 'what task am I on', intent: 'get_context' },
  { text: 'overview of my work', intent: 'get_context' },
  { text: 'active task summary', intent: 'get_context' },

  // get_top_skills
  { text: 'list top skills', intent: 'get_top_skills' },
  { text: 'show my most used skills', intent: 'get_top_skills' },
  { text: 'what skills do I use most', intent: 'get_top_skills' },
  { text: 'top skills ranking', intent: 'get_top_skills' },
  { text: 'which skills am I best at', intent: 'get_top_skills' },
  { text: 'most frequently used skills', intent: 'get_top_skills' },
  { text: 'skill usage statistics', intent: 'get_top_skills' },
  { text: 'what are my strongest skills', intent: 'get_top_skills' },
  { text: 'show skill breakdown', intent: 'get_top_skills' },
  { text: 'skill leaderboard', intent: 'get_top_skills' },
  { text: 'which technologies do I use most', intent: 'get_top_skills' },
  { text: 'my primary skills', intent: 'get_top_skills' },
  { text: 'top five skills', intent: 'get_top_skills' },
  { text: 'best skills summary', intent: 'get_top_skills' },
  { text: 'skill frequency report', intent: 'get_top_skills' },
  { text: 'what languages do I code in most', intent: 'get_top_skills' },
  { text: 'top used technologies', intent: 'get_top_skills' },
  { text: 'main competencies', intent: 'get_top_skills' },
  { text: 'skills I have most experience with', intent: 'get_top_skills' },
  { text: 'skill proficiency summary', intent: 'get_top_skills' },

  // get_connections
  { text: 'what is connected to DevNeural', intent: 'get_connections' },
  { text: 'show connections for this project', intent: 'get_connections' },
  { text: 'what connects to voice interface', intent: 'get_connections' },
  { text: 'list dependencies of api server', intent: 'get_connections' },
  { text: 'what links to my project', intent: 'get_connections' },
  { text: 'find all connections', intent: 'get_connections' },
  { text: 'related nodes for DevNeural', intent: 'get_connections' },
  { text: 'what projects use this skill', intent: 'get_connections' },
  { text: 'dependency graph for', intent: 'get_connections' },
  { text: 'show graph connections', intent: 'get_connections' },
  { text: 'what is this linked to', intent: 'get_connections' },
  { text: 'outgoing edges from', intent: 'get_connections' },
  { text: 'incoming connections to', intent: 'get_connections' },
  { text: 'network of this project', intent: 'get_connections' },
  { text: 'what depends on typescript', intent: 'get_connections' },
  { text: 'show neighbors of react', intent: 'get_connections' },
  { text: 'connected projects', intent: 'get_connections' },
  { text: 'what uses this library', intent: 'get_connections' },
  { text: 'project interconnections', intent: 'get_connections' },
  { text: 'adjacent nodes', intent: 'get_connections' },

  // get_node
  { text: 'tell me about DevNeural', intent: 'get_node' },
  { text: 'what is voice interface', intent: 'get_node' },
  { text: 'describe the api server', intent: 'get_node' },
  { text: 'give me info on typescript', intent: 'get_node' },
  { text: 'information about react', intent: 'get_node' },
  { text: 'details for session intelligence', intent: 'get_node' },
  { text: 'what does DevNeural do', intent: 'get_node' },
  { text: 'explain the web app', intent: 'get_node' },
  { text: 'lookup node devneural', intent: 'get_node' },
  { text: 'show me the node details', intent: 'get_node' },
  { text: 'project description', intent: 'get_node' },
  { text: 'what is this project about', intent: 'get_node' },
  { text: 'node info for api', intent: 'get_node' },
  { text: 'get details of skill', intent: 'get_node' },
  { text: 'show node profile', intent: 'get_node' },
  { text: 'full info on project x', intent: 'get_node' },
  { text: 'describe skill typescript', intent: 'get_node' },
  { text: 'what kind of node is this', intent: 'get_node' },
  { text: 'profile of session intelligence', intent: 'get_node' },
  { text: 'node summary for devneural', intent: 'get_node' },

  // get_stages
  { text: 'show alpha projects', intent: 'get_stages' },
  { text: 'list projects in beta', intent: 'get_stages' },
  { text: 'what is deployed', intent: 'get_stages' },
  { text: 'show archived projects', intent: 'get_stages' },
  { text: 'projects by stage', intent: 'get_stages' },
  { text: 'filter by alpha stage', intent: 'get_stages' },
  { text: 'what projects are live', intent: 'get_stages' },
  { text: 'in development projects', intent: 'get_stages' },
  { text: 'show me beta items', intent: 'get_stages' },
  { text: 'which projects are deployed', intent: 'get_stages' },
  { text: 'all alpha work', intent: 'get_stages' },
  { text: 'projects currently archived', intent: 'get_stages' },
  { text: 'list by lifecycle stage', intent: 'get_stages' },
  { text: 'show production projects', intent: 'get_stages' },
  { text: 'what is in beta testing', intent: 'get_stages' },
  { text: 'inactive projects', intent: 'get_stages' },
  { text: 'everything in alpha', intent: 'get_stages' },
  { text: 'deployed services', intent: 'get_stages' },
  { text: 'stage filter deployed', intent: 'get_stages' },
  { text: 'completed and archived work', intent: 'get_stages' },
];

// ---------------------------------------------------------------------------
// Build and train classifier at module load time
// ---------------------------------------------------------------------------
const classifier = new natural.BayesClassifier();
for (const example of TRAINING_EXAMPLES) {
  classifier.addDocument(example.text, example.intent);
}
classifier.train();

// ---------------------------------------------------------------------------
// normalizeConfidence
// Normalizes real-probability outputs from BayesClassifier.getClassifications()
// using a proportional ratio over the top-2 class probabilities.
// Note: apparatus BayesClassifier returns real positive probabilities (not
// log-probabilities). Returns value in [0, 1].
// Exported for unit testing.
// ---------------------------------------------------------------------------
export function normalizeConfidence(
  probs: Array<{ label: string; value: number }>
): number {
  if (probs.length === 0) return 0;

  // Sort descending by probability
  const sorted = [...probs].sort((a, b) => b.value - a.value);
  const top1 = sorted[0].value;
  // If only one class, treat second as negligible probability
  const top2 = sorted[1]?.value ?? (top1 * 0.0001);

  const denominator = top1 + top2;
  if (denominator <= 0) return 0;

  const confidence = top1 / denominator;

  // Clamp to [0, 1]
  return Math.min(1, Math.max(0, confidence));
}

// ---------------------------------------------------------------------------
// parseLocalIntent
// Returns null when confidence is below 0.75 (defer to Haiku).
// ---------------------------------------------------------------------------
export function parseLocalIntent(query: string): IntentResult | null {
  const normalized = query.toLowerCase().trim();

  // --- Keyword fast-path ---
  const matchedIntents = new Set<IntentName>();

  for (const [intentName, phraseGroups] of Object.entries(KEYWORD_TABLE) as [
    IntentName,
    string[][]
  ][]) {
    if (intentName === 'unknown') continue;
    for (const group of phraseGroups) {
      if (group.every((phrase) => normalized.includes(phrase))) {
        matchedIntents.add(intentName);
        break; // one matching group is enough for this intent
      }
    }
  }

  if (matchedIntents.size === 1) {
    const intent = [...matchedIntents][0];
    const confidence = FAST_PATH_CONFIDENCE[intent] ?? 0.90;
    return {
      intent,
      confidence,
      entities: {},
      source: 'local',
    };
  }

  // If 0 or 2+ intents matched, fall through to classifier

  // --- BayesClassifier fallback ---
  const classifications = classifier.getClassifications(
    normalized
  ) as Array<{ label: string; value: number }>;

  if (!classifications || classifications.length === 0) return null;

  // apparatus returns results sorted descending; no re-sort needed
  const confidence = normalizeConfidence(classifications);
  // Returns null as the deferral signal (null = defer to Haiku).
  // 'unknown' cannot be emitted here — null serves that role per the pipeline contract.
  if (confidence < 0.75) return null;

  const topLabel = classifications[0].label as IntentName;

  return {
    intent: topLabel,
    confidence,
    entities: {},
    source: 'local',
  };
}
