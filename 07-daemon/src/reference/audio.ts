/**
 * Audio transcription via whisper.cpp (local, offline).
 *
 * We shell out to a prebuilt whisper.cpp binary rather than embedding
 * a Node wrapper. Reasons:
 *   - whisper.cpp is the canonical CPU-friendly Whisper implementation;
 *     no python or torch required.
 *   - The newer build emits `whisper-cli` (cmake target). Older builds
 *     still produce `main`. We probe both.
 *   - A missing binary should be a soft failure: the daemon must keep
 *     running and the upload pipeline must record `processing_pending`
 *     so the doc can be re-processed once the user installs the binary.
 *
 * Model files (.bin) live next to the binary or under a `models/` dir
 * inside the whisper.cpp checkout. Default model is `base.en` (fast,
 * English-only, ~140MB). Override via DEVNEURAL_WHISPER_MODEL.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export type AudioExtractResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'no_whisper' | 'failed'; detail?: string };

export interface AudioExtractOpts {
  model?: string;
  language?: string;
}

const FALLBACK_BINS = [
  'C:/dev/whisper.cpp/build/bin/Release/whisper-cli.exe',
  'C:/dev/whisper.cpp/build/bin/whisper-cli.exe',
  'C:/dev/whisper.cpp/build/bin/Release/main.exe',
  'C:/dev/whisper.cpp/build/bin/main.exe',
  'C:/dev/whisper.cpp/main.exe',
  'C:/dev/whisper.cpp/whisper-cli.exe',
];

function resolveBinary(): string | null {
  const fromEnv = process.env.DEVNEURAL_WHISPER_BIN;
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv.replace(/\\/g, '/');
    // env var was set but path is broken; treat as missing
    return null;
  }
  for (const candidate of FALLBACK_BINS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // PATH-resolved 'whisper' is checked at spawn time; we return a
  // sentinel that lets the caller try and rely on ENOENT detection.
  return 'whisper';
}

function resolveModel(modelOverride?: string): string | null {
  const modelName =
    modelOverride ?? process.env.DEVNEURAL_WHISPER_MODEL ?? 'base.en';
  const explicitPath = process.env.DEVNEURAL_WHISPER_MODEL_PATH;
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath.replace(/\\/g, '/');
  }
  const candidates = [
    `C:/dev/whisper.cpp/models/ggml-${modelName}.bin`,
    `C:/dev/whisper.cpp/ggml-${modelName}.bin`,
    path.posix.join(process.cwd(), `ggml-${modelName}.bin`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function extractAudioTranscript(
  filePath: string,
  opts: AudioExtractOpts = {},
): Promise<AudioExtractResult> {
  const bin = resolveBinary();
  if (!bin) {
    return {
      ok: false,
      reason: 'no_whisper',
      detail:
        'whisper.cpp binary not found. Install it (see docs/install/AUDIO-VIDEO.md) or set DEVNEURAL_WHISPER_BIN to the full path of whisper-cli.exe.',
    };
  }
  const model = resolveModel(opts.model);
  if (!model) {
    return {
      ok: false,
      reason: 'no_whisper',
      detail:
        'whisper model file (ggml-base.en.bin) not found. Download a model into C:/dev/whisper.cpp/models/ or set DEVNEURAL_WHISPER_MODEL_PATH.',
    };
  }

  const outBase = path.posix.join(
    os.tmpdir().replace(/\\/g, '/'),
    `devneural-whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const args = [
    '-m',
    model,
    '-f',
    filePath,
    '-otxt',
    '-of',
    outBase,
    '-l',
    opts.language ?? 'en',
    '-nt',
  ];

  return new Promise<AudioExtractResult>((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      resolve({
        ok: false,
        reason: 'no_whisper',
        detail: `failed to spawn whisper binary at ${bin}: ${(err as Error).message}`,
      });
      return;
    }

    let stderr = '';
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          ok: false,
          reason: 'no_whisper',
          detail: `whisper binary not on PATH (looked for "${bin}"). Set DEVNEURAL_WHISPER_BIN to the full path.`,
        });
      } else {
        resolve({
          ok: false,
          reason: 'failed',
          detail: `whisper spawn error: ${err.message}`,
        });
      }
    });

    child.on('close', (code: number | null) => {
      const txtPath = `${outBase}.txt`;
      if (code === 0 && fs.existsSync(txtPath)) {
        try {
          const text = fs.readFileSync(txtPath, 'utf-8').trim();
          fs.unlink(txtPath, () => undefined);
          resolve({ ok: true, text });
          return;
        } catch (err) {
          resolve({
            ok: false,
            reason: 'failed',
            detail: `failed reading transcript: ${(err as Error).message}`,
          });
          return;
        }
      }
      resolve({
        ok: false,
        reason: 'failed',
        detail: `whisper exited with code ${code}: ${stderr.slice(-500)}`,
      });
    });
  });
}
