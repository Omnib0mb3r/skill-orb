import type { SessionSummary } from '../types.js';

/** Renders a SessionSummary as an Obsidian-ready markdown block. */
export function renderSummary(summary: SessionSummary): string {
  const parts: string[] = [];

  parts.push(`## Session: ${summary.date}`);
  parts.push('');
  parts.push('### What I worked on');
  parts.push(summary.what_i_worked_on);

  if (summary.graph_insights.length > 0) {
    parts.push('');
    parts.push('### Graph insights');
    for (const insight of summary.graph_insights) {
      parts.push(`- ${insight}`);
    }
  }

  parts.push('');
  parts.push('### Lessons learned');
  parts.push(summary.lessons_learned);
  parts.push('');
  parts.push('<!-- USER NOTES: Add your own reflections here -->');
  parts.push('');
  parts.push('---');
  parts.push(''); // final newline after ---

  return parts.join('\n');
}
