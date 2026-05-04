/**
 * Video transcription pipeline.
 *
 * Strategy: ffmpeg demuxes the audio track to a 16kHz mono WAV in the
 * OS temp dir, then we hand that WAV to extractAudioTranscript. 16kHz
 * mono is what whisper.cpp wants natively; doing the conversion here
 * avoids a second pass inside whisper.
 *
 * Optional frame sampling lets us OCR slides / diagrams in technical
 * videos (manuals, recorded lectures). It's off by default because
 * tesseract on every Nth frame can balloon ingest time on long videos.
 *
 * Both binaries are external. Missing binaries are soft failures so
 * the upload still lands on disk and the daemon stays alive.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { extractAudioTranscript } from './audio.js';
import { extractImage } from './image.js';

export type VideoExtractResult =
  | { ok: true; text: string; frames?: string[] }
  | { ok: false; reason: 'no_ffmpeg' | 'no_whisper' | 'failed'; detail?: string };

export interface VideoExtractOpts {
  sampleFramesEvery?: number;
}

function resolveFfmpeg(): string {
  return process.env.DEVNEURAL_FFMPEG_BIN ?? 'ffmpeg';
}

function tempPath(suffix: string): string {
  const base = os.tmpdir().replace(/\\/g, '/');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.posix.join(base, `devneural-${stamp}${suffix}`);
}

async function runFfmpeg(args: string[]): Promise<{ ok: true } | { ok: false; reason: 'no_ffmpeg' | 'failed'; detail: string }> {
  const bin = resolveFfmpeg();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      resolve({
        ok: false,
        reason: 'no_ffmpeg',
        detail: `failed to spawn ffmpeg at ${bin}: ${(err as Error).message}`,
      });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          ok: false,
          reason: 'no_ffmpeg',
          detail: `ffmpeg binary not on PATH (looked for "${bin}"). Install via "winget install Gyan.FFmpeg" or set DEVNEURAL_FFMPEG_BIN.`,
        });
      } else {
        resolve({
          ok: false,
          reason: 'failed',
          detail: `ffmpeg spawn error: ${err.message}`,
        });
      }
    });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          reason: 'failed',
          detail: `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });
      }
    });
  });
}

export async function extractVideoTranscript(
  filePath: string,
  opts: VideoExtractOpts = {},
): Promise<VideoExtractResult> {
  const wavPath = tempPath('.wav');
  const audioRes = await runFfmpeg([
    '-y',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
    wavPath,
  ]);
  if (!audioRes.ok) {
    return audioRes;
  }

  let transcriptText = '';
  try {
    const transcript = await extractAudioTranscript(wavPath);
    if (!transcript.ok) {
      return transcript;
    }
    transcriptText = transcript.text;
  } finally {
    fs.unlink(wavPath, () => undefined);
  }

  const sampleEvery = opts.sampleFramesEvery;
  if (sampleEvery && sampleEvery > 0) {
    const framesDir = tempPath('-frames');
    fs.mkdirSync(framesDir, { recursive: true });
    const pattern = path.posix.join(framesDir, 'frame-%04d.png');
    const frameRes = await runFfmpeg([
      '-y',
      '-i',
      filePath,
      '-vf',
      `fps=1/${sampleEvery}`,
      pattern,
    ]);
    if (frameRes.ok) {
      try {
        const files = fs
          .readdirSync(framesDir)
          .filter((f) => f.endsWith('.png'))
          .sort();
        const ocrChunks: string[] = [];
        for (const f of files) {
          const full = path.posix.join(framesDir, f);
          try {
            const r = await extractImage(full);
            if (r.text.trim().length > 10) {
              ocrChunks.push(`[frame ${f}]\n${r.text.trim()}`);
            }
          } catch {
            // single bad frame should not fail the whole job
          }
          fs.unlink(full, () => undefined);
        }
        if (ocrChunks.length > 0) {
          transcriptText = `${transcriptText}\n\n---\n\nFrame OCR:\n\n${ocrChunks.join('\n\n')}`;
        }
        return {
          ok: true,
          text: transcriptText,
          frames: files,
        };
      } finally {
        fs.rm(framesDir, { recursive: true, force: true }, () => undefined);
      }
    }
    fs.rm(framesDir, { recursive: true, force: true }, () => undefined);
  }

  return { ok: true, text: transcriptText };
}
