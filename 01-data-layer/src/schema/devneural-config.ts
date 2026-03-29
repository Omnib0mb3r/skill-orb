export type StageValue = 'alpha' | 'beta' | 'deployed' | 'archived';
export type TagValue = 'revision-needed' | 'sandbox';

export interface DevNeuralConfig {
  name: string;
  localPath: string;
  githubUrl: string;
  stage: StageValue;
  tags: TagValue[];
  description: string;
}

const VALID_STAGES: ReadonlySet<string> = new Set(['alpha', 'beta', 'deployed', 'archived']);
const VALID_TAGS: ReadonlySet<string> = new Set(['revision-needed', 'sandbox']);

/**
 * Validates and returns a typed DevNeuralConfig from an unknown parsed JSON value.
 * Throws a descriptive Error on any missing or invalid field.
 * Tolerates unknown extra fields.
 */
export function validateDevNeuralConfig(raw: unknown): DevNeuralConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('devneural.json must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['name'] !== 'string' || obj['name'].trim().length === 0) {
    throw new Error('devneural.json: "name" is required and must be a non-empty string');
  }

  if (typeof obj['localPath'] !== 'string' || obj['localPath'].length === 0) {
    throw new Error('devneural.json: "localPath" is required and must be a non-empty string');
  }
  // Must be absolute: starts with / (Unix) or a drive letter X:/ or X:\ (Windows)
  const isAbsolute =
    obj['localPath'].startsWith('/') || /^[a-zA-Z]:[/\\]/.test(obj['localPath']);
  if (!isAbsolute) {
    throw new Error(
      `devneural.json: "localPath" must be an absolute path (got "${obj['localPath']}")`,
    );
  }

  if (typeof obj['githubUrl'] !== 'string' || !obj['githubUrl'].startsWith('https://github.com/')) {
    throw new Error(
      `devneural.json: "githubUrl" must start with "https://github.com/" (got "${obj['githubUrl']}")`,
    );
  }

  if (typeof obj['stage'] !== 'string') {
    throw new Error(
      `devneural.json: "stage" is required and must be one of: ${[...VALID_STAGES].join(', ')}`,
    );
  }
  if (!VALID_STAGES.has(obj['stage'])) {
    throw new Error(
      `devneural.json: "stage" must be one of: ${[...VALID_STAGES].join(', ')} (got "${obj['stage']}")`,
    );
  }

  if (!Array.isArray(obj['tags'])) {
    throw new Error('devneural.json: "tags" is required and must be an array');
  }
  for (const tag of obj['tags']) {
    if (typeof tag !== 'string' || !VALID_TAGS.has(tag)) {
      throw new Error(
        `devneural.json: invalid tag "${tag}". Valid tags: ${[...VALID_TAGS].join(', ')}`,
      );
    }
  }

  if (typeof obj['description'] !== 'string' || obj['description'].trim().length === 0) {
    throw new Error('devneural.json: "description" is required and must be a non-empty string');
  }

  // Deduplicate tags (they are semantically a set)
  const uniqueTags = [...new Set(obj['tags'] as TagValue[])];

  return {
    name: obj['name'] as string,
    localPath: obj['localPath'] as string,
    githubUrl: obj['githubUrl'] as string,
    stage: obj['stage'] as StageValue,
    tags: uniqueTags,
    description: obj['description'] as string,
  };
}
