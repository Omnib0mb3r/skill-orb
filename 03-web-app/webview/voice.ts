export type VoiceStatus = 'unavailable' | 'idle' | 'listening' | 'error';

export interface VoiceController {
  readonly status: VoiceStatus;
  startListening(): void;
  stopListening(): void;
}

export interface VoiceCallbacks {
  onTranscript(text: string): void;
  onStatusChange(status: VoiceStatus): void;
}

export function initVoice(callbacks: VoiceCallbacks): VoiceController | null {
  const SpeechRecognitionCtor =
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) return null;

  const recognition = new SpeechRecognitionCtor() as SpeechRecognition;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let currentStatus: VoiceStatus = 'idle';
  let errorResetTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(s: VoiceStatus): void {
    currentStatus = s;
    callbacks.onStatusChange(s);
  }

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const transcript = event.results[event.resultIndex][0].transcript;
    callbacks.onTranscript(transcript);
    setStatus('idle');
  };

  recognition.onerror = (_event: SpeechRecognitionErrorEvent) => {
    setStatus('error');
    errorResetTimer = setTimeout(() => {
      errorResetTimer = null;
      setStatus('idle');
    }, 2000);
  };

  recognition.onend = () => {
    if (currentStatus === 'listening') {
      setStatus('idle');
    }
  };

  return {
    get status() { return currentStatus; },
    startListening() {
      if (currentStatus !== 'idle') return;
      if (errorResetTimer !== null) {
        clearTimeout(errorResetTimer);
        errorResetTimer = null;
      }
      setStatus('listening');
      recognition.start();
    },
    stopListening() {
      recognition.stop();
      setStatus('idle');
    },
  };
}
