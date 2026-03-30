import { describe, it, expect, vi, afterEach } from 'vitest';
import { initVoice } from '../voice';
import { detectVoiceIntent } from '../search';

class MockSpeechRecognition {
  lang = '';
  interimResults = true;
  maxAlternatives = 1;
  continuous = true;

  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
}

function installMock(): MockSpeechRecognition {
  const instance = new MockSpeechRecognition();
  (window as any).SpeechRecognition = vi.fn(() => instance);
  return instance;
}

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
});

describe('initVoice', () => {
  it('returns null when SpeechRecognition is unavailable — hides mic button', () => {
    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
    expect(controller).toBeNull();
  });

  it('configures recognition with continuous=false and interimResults=false', () => {
    const mock = installMock();
    initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
    expect(mock.continuous).toBe(false);
    expect(mock.interimResults).toBe(false);
  });

  it('startListening calls recognition.start()', () => {
    const mock = installMock();
    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
    controller!.startListening();
    expect(mock.start).toHaveBeenCalled();
  });

  it('stopListening calls recognition.stop()', () => {
    const mock = installMock();
    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
    controller!.startListening();
    controller!.stopListening();
    expect(mock.stop).toHaveBeenCalled();
  });

  it('startListening is a no-op if already listening', () => {
    const mock = installMock();
    const controller = initVoice({ onTranscript: vi.fn(), onStatusChange: vi.fn() });
    controller!.startListening();
    controller!.startListening();
    expect(mock.start).toHaveBeenCalledTimes(1);
  });

  it('onresult event fires onTranscript callback with transcript string', () => {
    const mock = installMock();
    const onTranscript = vi.fn();
    const controller = initVoice({ onTranscript, onStatusChange: vi.fn() });
    controller!.startListening();

    mock.onresult!({
      results: [[{ transcript: 'hello world' }]],
      resultIndex: 0,
    });

    expect(onTranscript).toHaveBeenCalledWith('hello world');
  });

  it('onerror event fires onStatusChange with "error"', () => {
    const mock = installMock();
    const onStatusChange = vi.fn();
    initVoice({ onTranscript: vi.fn(), onStatusChange });

    mock.onerror!({ error: 'no-speech' });

    expect(onStatusChange).toHaveBeenCalledWith('error');
  });
});

describe('detectVoiceIntent', () => {
  it('"show me all projects" → { action: "search", query: "all projects" }', () => {
    const result = detectVoiceIntent('show me all projects');
    expect(result.action).toBe('search');
    expect(result.query).toBe('all projects');
  });

  it('"focus on DevNeural" → { action: "focus", target: "DevNeural" }', () => {
    const result = detectVoiceIntent('focus on DevNeural');
    expect(result.action).toBe('focus');
    expect(result.target).toBe('DevNeural');
  });

  it('"zoom out" → { action: "returnToAuto" }', () => {
    const result = detectVoiceIntent('zoom out');
    expect(result.action).toBe('returnToAuto');
  });

  it('"zoom out please" → { action: "returnToAuto" } (loose anchor)', () => {
    const result = detectVoiceIntent('zoom out please');
    expect(result.action).toBe('returnToAuto');
  });

  it('"search for playwright" → { action: "search", query: "playwright" }', () => {
    const result = detectVoiceIntent('search for playwright');
    expect(result.action).toBe('search');
    expect(result.query).toBe('playwright');
  });

  it('"unknown gibberish xyz" falls back to search with trimmed transcript', () => {
    const result = detectVoiceIntent('unknown gibberish xyz');
    expect(result.action).toBe('search');
    expect(result.query).toBe('unknown gibberish xyz');
  });
});
