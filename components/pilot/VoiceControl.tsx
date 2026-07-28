'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Check, HelpCircle } from 'lucide-react';
import { parseVoiceCommand, describeCommand, type VoiceCommand } from '@/lib/vision/voice-commands';

/**
 * Hands-free correction via the browser's speech recognition.
 *
 * Runs entirely on-device (Safari/Chrome), so there's no per-use cost and no
 * audio leaves the phone. Speech recognition on iOS stops itself after each
 * utterance, so we restart it while listening is on — that's what makes it
 * feel continuous rather than tap-per-phrase.
 */

// The API is prefixed on Safari and absent in some browsers.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const EXAMPLES = [
  { say: '“grasa ochenta”', does: 'sets grease to 80' },
  { say: '“cocina moho 30”', does: 'sets mold on the kitchen' },
  { say: '“todo limpio”', does: 'zeroes the whole room' },
  { say: '“siguiente”', does: 'next room' },
  { say: '“borrar”', does: 'removes the room' },
  { say: '“listo”', does: 'finish correcting' },
];

export function VoiceControl({
  onCommand,
  currentRoomLabel,
}: {
  onCommand: (command: VoiceCommand) => void;
  currentRoomLabel?: string;
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Read inside callbacks that outlive a render, so restart logic sees the
  // current intent rather than a stale closure.
  const listeningRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  useEffect(() => {
    setSupported(getRecognition() !== null);
  }, []);

  const handleTranscript = useCallback((transcript: string) => {
    setHeard(transcript);
    const command = parseVoiceCommand(transcript);
    if (command.kind === 'unknown') {
      setLastAction('');
      return;
    }
    onCommandRef.current(command);
    setLastAction(describeCommand(command));
    // Haptic confirmation so it's usable without looking at the screen.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(40);
  }, []);

  const start = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) {
      setSupported(false);
      return;
    }

    // Spanish first — it's the working language for most cleaners in these
    // markets, and the parser accepts English words either way.
    recognition.lang = 'es-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const results = Array.from(event.results as ArrayLike<ArrayLike<{ transcript: string }>>);
      const last = results[results.length - 1];
      const transcript = last?.[0]?.transcript ?? '';
      if (transcript) handleTranscript(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission was denied. Enable it in Safari settings.');
        listeningRef.current = false;
        setListening(false);
      }
      // 'no-speech' and 'aborted' are normal during a long job — onend restarts.
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        try {
          recognition.start();
        } catch {
          // Already starting; the next onend will retry.
        }
      }
    };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    setListening(true);
    setError('');
    try {
      recognition.start();
    } catch {
      setError('Could not start the microphone. Try again.');
      listeningRef.current = false;
      setListening(false);
    }
  }, [handleTranscript]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  // Never leave the mic running after the step unmounts.
  useEffect(() => () => {
    listeningRef.current = false;
    recognitionRef.current?.abort();
  }, []);

  if (!supported) {
    return (
      <div className="rounded-2xl border border-dashed p-4 text-sm text-slate-500 dark:text-slate-400">
        Voice control isn’t available in this browser. Use Safari on iPhone or Chrome on Android — the sliders below
        work either way.
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${listening ? 'border-brand-400 bg-brand-50/40 dark:bg-brand-950/20' : ''}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={listening ? stop : start}
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-full transition-all ${
            listening
              ? 'animate-pulse bg-brand-600 text-white'
              : 'border-2 border-brand-600 text-brand-600'
          }`}
          aria-pressed={listening}
          aria-label={listening ? 'Stop voice control' : 'Start voice control'}
        >
          {listening ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {listening ? 'Listening — just talk' : 'Hands full? Use your voice'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {listening
              ? heard || `Say “grasa ochenta”${currentRoomLabel ? ` · ${currentRoomLabel}` : ''}`
              : 'Tap the mic and say the level out loud'}
          </p>
        </div>

        <button
          onClick={() => setShowHelp((v) => !v)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border text-slate-400"
          aria-label="Voice command help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>

      {lastAction && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" /> {lastAction}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {error}
        </p>
      )}

      {showHelp && (
        <div className="mt-4 space-y-1.5 border-t pt-3">
          {EXAMPLES.map((e) => (
            <div key={e.say} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium">{e.say}</span>
              <span className="text-slate-500 dark:text-slate-400">{e.does}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-slate-400">
            Works in Spanish or English. Numbers as words or digits.
          </p>
        </div>
      )}
    </div>
  );
}
