# Audio and video processing setup

Phase 3.5 of the DevNeural daemon adds local transcription for audio
and video uploads to the reference corpus. The implementation is in
the daemon (`07-daemon/src/reference/audio.ts` and `video.ts`); this
doc covers the two external binaries the daemon shells out to and how
to install them on Windows.

If neither binary is installed, audio and video uploads still land on
disk. They are recorded with status `queued` and a warning notification
fires on the dashboard. Once the binaries are installed and env vars
set, the same files can be re-processed.

## Why these tools

- **whisper.cpp**, not `whisper-node` or the OpenAI Whisper API.
  - No Python or Torch dependency. One C++ binary plus a model file.
  - Runs offline, on CPU, on the same machine as the daemon. No data
    leaves `OTLCDEV`.
  - Fast on modern CPUs with the `base.en` model. Larger models
    available if accuracy matters more than speed.
- **ffmpeg**, not a JS demuxer.
  - The reference implementation. Handles every container format we
    care about (mp4, mov, mkv, webm, avi, wmv).
  - One install via winget. Already on most dev machines.

No cloud APIs. No per-file cost. This is a one-time setup.

## 1. Install ffmpeg

```powershell
winget install Gyan.FFmpeg
```

After install, open a fresh PowerShell window and confirm:

```powershell
ffmpeg -version
```

If `ffmpeg` is not on PATH, set the env var so the daemon can find it:

```powershell
[Environment]::SetEnvironmentVariable('DEVNEURAL_FFMPEG_BIN', 'C:\path\to\ffmpeg.exe', 'User')
```

## 2. Build whisper.cpp

```powershell
cd C:\dev
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```

The build produces `build\bin\Release\whisper-cli.exe` (newer CMake
builds) or `main.exe` (older builds). The daemon probes both.

## 3. Download a model

`base.en` is the recommended default. It is fast, English-only,
roughly 140MB, and accurate enough for technical content.

```powershell
cd C:\dev\whisper.cpp\models
curl -L -o ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Larger options if you need more accuracy: `small.en` (470MB),
`medium.en` (1.5GB). The trade-off is transcription speed.

## 4. Tell the daemon where to look

The daemon will probe a list of fallback paths under `C:/dev/whisper.cpp/`.
If you installed elsewhere, set these in your shell profile or via a
`.env` file the daemon reads:

| Variable | Default | Purpose |
|---|---|---|
| `DEVNEURAL_WHISPER_BIN` | probes `C:/dev/whisper.cpp/...` then PATH | Full path to `whisper-cli.exe` or `main.exe` |
| `DEVNEURAL_WHISPER_MODEL` | `base.en` | Model name (without the `ggml-` prefix and `.bin` extension) |
| `DEVNEURAL_WHISPER_MODEL_PATH` | derived from model name | Full path to a `.bin` model file (overrides `DEVNEURAL_WHISPER_MODEL`) |
| `DEVNEURAL_FFMPEG_BIN` | `ffmpeg` (PATH) | Full path to `ffmpeg.exe` |

Example PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('DEVNEURAL_WHISPER_BIN', 'C:\dev\whisper.cpp\build\bin\Release\whisper-cli.exe', 'User')
[Environment]::SetEnvironmentVariable('DEVNEURAL_WHISPER_MODEL', 'base.en', 'User')
```

## 5. Verify

Restart the daemon so it picks up the new env vars. Upload a small
mp3 to the dashboard:

```powershell
curl.exe -X POST -F "file=@C:\path\to\sample.mp3" http://localhost:7474/upload
```

Watch the daemon log for a line like:

```
[reference] sample.mp3: 4 chunks embedded, 1842 chars
```

For video, drop a short mp4 onto the dashboard upload zone. The daemon
demuxes the audio track via ffmpeg, transcribes it via whisper, and
chunks the result the same way as a PDF.

## Troubleshooting

- **"whisper.cpp binary not found"**: env var unset and the daemon's
  fallback paths were not present. Either install whisper.cpp at
  `C:/dev/whisper.cpp/` or set `DEVNEURAL_WHISPER_BIN`.
- **"whisper model file not found"**: the binary was found but no
  `ggml-<model>.bin` lives in `C:/dev/whisper.cpp/models/`. Download
  the model (see step 3) or set `DEVNEURAL_WHISPER_MODEL_PATH` to a
  full path.
- **"ffmpeg binary not on PATH"**: you installed via winget but the
  PATH update only applies to new shells. Restart the daemon from a
  fresh PowerShell window.
- **Whisper exits non-zero with no transcript**: check the daemon log
  for the last 500 chars of stderr. Common cause: the audio file is
  zero bytes or in an unsupported format. The daemon hands ffmpeg's
  16kHz mono WAV to whisper, so format issues usually mean ffmpeg
  itself failed. Check the upload's status in the dashboard.
- **Slow transcription**: switch to a smaller model (`tiny.en`) or
  build whisper.cpp with GPU support. CUDA on NVIDIA: rebuild with
  `cmake -B build -DGGML_CUDA=1`. The daemon does not care which
  build it calls; the binary handles GPU dispatch internally.
- **Re-process a queued upload**: any audio or video upload that hit
  the daemon before the binaries were installed has status `queued`.
  Re-uploading the same file works; a re-process endpoint is on the
  Phase 3.6 list.
