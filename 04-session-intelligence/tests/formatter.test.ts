import { describe, it, expect } from 'vitest';
import { formatSubgraph } from '../src/formatter';
import type { FormatterConfig } from '../src/formatter';

const PROJECT_ID = 'github.com/test/repo';
const SOURCE = `project:${PROJECT_ID}`;
const DEFAULT_CONFIG: FormatterConfig = { maxResultsPerType: 10, minWeight: 1.0 };

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeSkillEdge(overrides: Partial<{
  id: string; target: string; weight: number; raw_count: number; last_seen: string;
}> = {}) {
  return {
    id: overrides.id ?? 'e1',
    source: SOURCE,
    target: overrides.target ?? 'skill:my-skill',
    connection_type: 'project->skill',
    raw_count: overrides.raw_count ?? 5,
    weight: overrides.weight ?? 3.0,
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: overrides.last_seen ?? daysAgoISO(0),
  };
}

function makeProjectEdge(overrides: Partial<{
  id: string; target: string; weight: number; raw_count: number; last_seen: string;
}> = {}) {
  return {
    id: overrides.id ?? 'e2',
    source: SOURCE,
    target: overrides.target ?? 'project:other-project',
    connection_type: 'project->project',
    raw_count: overrides.raw_count ?? 3,
    weight: overrides.weight ?? 2.0,
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: overrides.last_seen ?? daysAgoISO(0),
  };
}

describe('formatSubgraph', () => {
  it('contains both section headers when both edge types are present', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge(), makeProjectEdge()],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('Skills (top connections):');
    expect(output).toContain('Related Projects:');
  });

  it('contains only Skills header when only skill edges present', () => {
    const response = { nodes: [], edges: [makeSkillEdge()], updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('Skills (top connections):');
    expect(output).not.toContain('Related Projects:');
  });

  it('contains only Related Projects header when only project edges present', () => {
    const response = { nodes: [], edges: [makeProjectEdge()], updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('Related Projects:');
    expect(output).not.toContain('Skills (top connections):');
  });

  it('returns no-connections message when all edges are below minWeight', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge({ weight: 0.5 }), makeProjectEdge({ weight: 0.3 })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('No significant connections found');
  });

  it('returns no-connections message when edges array is empty', () => {
    const response = { nodes: [], edges: [], updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('No significant connections found');
  });

  it('includes raw_count as "(N uses)" in the output', () => {
    const response = {
      nodes: [{ id: 'skill:my-skill', type: 'skill' as const, label: 'My Skill' }],
      edges: [makeSkillEdge({ raw_count: 42 })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('42 uses');
  });

  it('formats last_seen as "today" when edge was seen today', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge({ last_seen: daysAgoISO(0) })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('today');
  });

  it('formats last_seen as "2 days ago" when edge was seen 2 days ago', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge({ last_seen: daysAgoISO(2) })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('2 days ago');
  });

  it('formats last_seen as "1 week ago" when edge was seen 8 days ago', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge({ last_seen: daysAgoISO(8) })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('1 week ago');
  });

  it('strips type prefix as label fallback when node not found', () => {
    const response = {
      nodes: [], // no matching node
      edges: [makeSkillEdge({ target: 'skill:my-skill' })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('my-skill');
    expect(output).not.toContain('skill:my-skill');
  });

  it('limits output to top 10 skill entries when 15 edges provided', () => {
    const edges = Array.from({ length: 15 }, (_, i) =>
      makeSkillEdge({ id: `e${i}`, target: `skill:skill-${i}`, weight: 10 - i * 0.1 }),
    );
    const response = { nodes: [], edges, updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    const bulletCount = (output.match(/•/g) ?? []).length;
    expect(bulletCount).toBe(10);
  });

  it('excludes skill edges below minWeight', () => {
    const edges = [
      makeSkillEdge({ id: 'e-low', target: 'skill:low-weight', weight: 0.5 }),
      makeSkillEdge({ id: 'e-high', target: 'skill:high-weight', weight: 2.0 }),
    ];
    const response = { nodes: [], edges, updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).not.toContain('low-weight');
    expect(output).toContain('high-weight');
  });

  it('excludes edges where the project is the target (incoming edges)', () => {
    const incomingEdge = {
      id: 'e-incoming',
      source: 'project:other-project',
      target: SOURCE, // project is target, not source
      connection_type: 'project->project',
      raw_count: 10,
      weight: 5.0,
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: daysAgoISO(0),
    };
    const response = { nodes: [], edges: [incomingEdge], updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('No significant connections found');
  });

  it('includes skill edges at exactly minWeight boundary (weight === 1.0)', () => {
    const response = {
      nodes: [],
      edges: [makeSkillEdge({ target: 'skill:boundary-skill', weight: 1.0 })],
      updated_at: '',
    };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('boundary-skill');
  });

  it('excludes project->tool edges even at high weight', () => {
    const toolEdge = {
      id: 'e-tool',
      source: SOURCE,
      target: 'tool:some-tool',
      connection_type: 'project->tool',
      raw_count: 100,
      weight: 9.9,
      first_seen: '2024-01-01T00:00:00Z',
      last_seen: daysAgoISO(0),
    };
    const response = { nodes: [], edges: [toolEdge], updated_at: '' };
    const output = formatSubgraph(PROJECT_ID, response, DEFAULT_CONFIG);
    expect(output).toContain('No significant connections found');
  });
});
