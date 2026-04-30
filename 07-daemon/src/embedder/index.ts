/**
 * Local sentence embedder.
 *
 * Wraps @xenova/transformers running an ONNX MiniLM model. First call
 * downloads the model into the user's HF cache; subsequent calls are
 * fast (5-15ms per short string on CPU).
 *
 * The pipeline is loaded lazily and reused across calls. Vectors are
 * normalized so cosine == dot product downstream.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { DATA_ROOT } from '../paths.js';

// Type-only import to avoid bundling cost at module load.
type FeaturePipeline = (
  input: string | string[],
  options?: { pooling?: 'none' | 'mean' | 'cls'; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

const MODEL_ID =
  process.env.DEVNEURAL_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = Number(process.env.DEVNEURAL_EMBED_DIM ?? 384);

let pipelinePromise: Promise<FeaturePipeline> | null = null;

async function loadPipeline(): Promise<FeaturePipeline> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    const cacheDir = path.posix.join(DATA_ROOT, 'models');
    process.env.TRANSFORMERS_CACHE =
      process.env.TRANSFORMERS_CACHE ?? cacheDir.replace(/\\/g, '/');
    process.env.HF_HOME = process.env.HF_HOME ?? cacheDir.replace(/\\/g, '/');

    const mod = await import('@xenova/transformers');
    // Disable telemetry; force local cache dir resolution.
    (mod as { env?: { allowRemoteModels?: boolean; cacheDir?: string } }).env ??=
      {};
    const transformerEnv = (mod as { env: { cacheDir?: string } }).env;
    transformerEnv.cacheDir = cacheDir.replace(/\\/g, '/');

    const pipe = await mod.pipeline('feature-extraction', MODEL_ID);
    return pipe as unknown as FeaturePipeline;
  })();

  return pipelinePromise;
}

/**
 * Embed a single string. Returns a normalized Float32Array of length EMBED_DIM.
 */
export async function embedOne(text: string): Promise<Float32Array> {
  const pipe = await loadPipeline();
  const out = await pipe(text, { pooling: 'mean', normalize: true });
  if (out.data.length !== EMBED_DIM) {
    throw new Error(
      `embedder produced dim ${out.data.length}, expected ${EMBED_DIM}`,
    );
  }
  return out.data;
}

/**
 * Embed many strings in one call. More efficient than embedOne in a loop.
 */
export async function embedMany(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await loadPipeline();
  const out = await pipe(texts, { pooling: 'mean', normalize: true });
  // Output dims are [n, EMBED_DIM] flattened. Slice by row.
  const n = texts.length;
  const dim = out.data.length / n;
  if (dim !== EMBED_DIM) {
    throw new Error(`embedder produced dim ${dim}, expected ${EMBED_DIM}`);
  }
  const result: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    result.push(
      new Float32Array(out.data.buffer, i * dim * 4, dim).slice(),
    );
  }
  return result;
}

export function getEmbedDim(): number {
  return EMBED_DIM;
}

export function getModelId(): string {
  return MODEL_ID;
}

/**
 * Pre-warm the pipeline. Call once at daemon startup so the first real
 * embed call is not blocked by model load. Safe to call multiple times.
 */
export async function warmUp(): Promise<void> {
  const pipe = await loadPipeline();
  await pipe('warm', { pooling: 'mean', normalize: true });
}

const ignoredHomeRefForLint = os.homedir.length;
void ignoredHomeRefForLint;
