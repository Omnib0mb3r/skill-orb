import Anthropic from '@anthropic-ai/sdk';
import type { SessionData, GraphInsight, SessionSummary, ObsidianSyncConfig } from '../types.js';

const PLACEHOLDER = '[Summary generation failed — check ANTHROPIC_API_KEY and model config]';

function extractToolNames(sessionData: SessionData): string[] {
  const names = new Set<string>();
  for (const entry of sessionData.entries) {
    if (entry.tool_name) names.add(entry.tool_name);
  }
  return [...names].sort();
}

function extractFilePaths(sessionData: SessionData): string[] {
  const basenames = new Set<string>();
  for (const entry of sessionData.entries) {
    if (entry.tool_input !== null && typeof entry.tool_input === 'object') {
      const fp = entry.tool_input['file_path'];
      const p = entry.tool_input['path'];
      for (const val of [fp, p]) {
        if (typeof val === 'string' && val.length > 0) {
          // Split on both / and \ to handle Windows and Unix paths
          const parts = val.split(/[/\\]/);
          const base = parts[parts.length - 1];
          if (base.length > 0) basenames.add(base);
        }
      }
    }
  }
  return [...basenames].sort();
}

function extractSkillNodes(sessionData: SessionData): string[] {
  const skills = new Set<string>();
  for (const event of sessionData.connection_events) {
    if (event.target_node.startsWith('skill:')) {
      const name = event.target_node.slice('skill:'.length);
      if (name.length > 0) skills.add(name);
    }
  }
  return [...skills].sort();
}

function buildPrompt(
  sessionData: SessionData,
  insights: GraphInsight[],
): { system: string; user: string } {
  const tools = extractToolNames(sessionData);
  const files = extractFilePaths(sessionData);
  const skills = extractSkillNodes(sessionData);

  const system = [
    'You are a developer reflection assistant for DevNeural, a tool-use tracking system for Claude Code sessions.',
    'The user is a software developer keeping a personal Obsidian second-brain for reflection and knowledge management.',
    'Your job is to synthesize structured session data into a first-person, reflective narrative.',
    'Always respond with a JSON object containing exactly two string fields: "what_i_worked_on" and "lessons_learned".',
    'Each field should be 2-4 sentences in first person past tense.',
    'Do not include any markdown code fences in your response.',
  ].join('\n');

  const insightLines = insights.map(i => `  - ${i.description}`).join('\n');

  const user = [
    `Project: ${sessionData.primary_project}`,
    `Date: ${sessionData.date}`,
    `Session window: ${sessionData.session_start} → ${sessionData.session_end}`,
    `Log entries: ${sessionData.entries.length}`,
    `Connection events: ${sessionData.connection_events.length}`,
    '',
    `Tools used: ${tools.join(', ') || 'none'}`,
    `Files touched: ${files.join(', ') || 'none'}`,
    `Skills activated: ${skills.join(', ') || 'none'}`,
    '',
    'Graph insights from today:',
    insightLines || '  (none)',
    '',
    'Please write a first-person reflection summarizing what was accomplished and what was learned.',
    'Respond with JSON: {"what_i_worked_on": "...", "lessons_learned": "..."}',
  ].join('\n');

  return { system, user };
}

function parseResponse(text: string): { what_i_worked_on: string; lessons_learned: string } {
  // Strip optional markdown code fences (with or without json language tag)
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  const wit = typeof parsed['what_i_worked_on'] === 'string' ? parsed['what_i_worked_on'] : '';
  const ll = typeof parsed['lessons_learned'] === 'string' ? parsed['lessons_learned'] : '';
  if (!wit || !ll) throw new Error('Missing required fields in response');
  return { what_i_worked_on: wit, lessons_learned: ll };
}

export async function generateSummary(
  sessionData: SessionData,
  insights: GraphInsight[],
  config: ObsidianSyncConfig,
): Promise<SessionSummary> {
  const graphInsights = insights.map(i => i.description);

  try {
    const client = new Anthropic();
    const { system, user } = buildPrompt(sessionData, insights);

    const response = await client.messages.create({
      model: config.claude_model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response content type');
    const text = block.text;
    const { what_i_worked_on, lessons_learned } = parseResponse(text);

    return {
      date: sessionData.date,
      project: sessionData.primary_project,
      what_i_worked_on,
      graph_insights: graphInsights,
      lessons_learned,
    };
  } catch (err) {
    console.warn(`[generator] Claude API call failed: ${(err as Error).message}`);
    return {
      date: sessionData.date,
      project: sessionData.primary_project,
      what_i_worked_on: PLACEHOLDER,
      graph_insights: graphInsights,
      lessons_learned: PLACEHOLDER,
    };
  }
}
