"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

function resampleLinear(
  input: Float32Array,
  srcRate: number,
  dstRate: number
): Float32Array {
  if (srcRate === dstRate) return input;
  if (input.length === 0) return input;

  const ratio = dstRate / srcRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const t = i / ratio; // position in input sample space
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = t - i0;
    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }

  return output;
}

export type TanakiAudioHandle = {
  /**
   * Feed little-endian PCM16 mono bytes (ideally 24kHz) into the player.
   * Chunks may be arbitrarily sized; we'll handle partial samples.
   */
  enqueuePcm16: (chunk: Uint8Array) => void;
  /** Stop queued playback immediately. */
  interrupt: () => void;
  /** Attempt to resume/unlock audio on user gesture. */
  unlock: () => Promise<void>;
};

export type TanakiAudioProps = {
  enabled: boolean;
  onVolumeChange?: (volume: number) => void;
};

export const TanakiAudio = forwardRef<TanakiAudioHandle, TanakiAudioProps>(
  function TanakiAudio(
    { enabled, onVolumeChange }: TanakiAudioProps,
    ref
  ) {
    // A small lead-time buffer helps avoid first-buffer glitches where the first
    // chunk is scheduled "too close to now" (especially right after resume()).
    const initialStartBufferSecRef = useRef(0.18);
    const startSafetyLeadSecRef = useRef(0.02);
    const fadeInSecRef = useRef(0.01);

    // Server currently streams PCM16 mono at 24kHz.
    const inputSampleRateRef = useRef(24000);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const nextPlayTimeRef = useRef(0);
    const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
    const remainderRef = useRef<Uint8Array | null>(null);
    const onVolumeChangeRef = useRef(onVolumeChange);
    const pendingChunksRef = useRef<Uint8Array[]>([]);
    const needsInitialBufferRef = useRef(true);

    useEffect(() => {
      onVolumeChangeRef.current = onVolumeChange;
    }, [onVolumeChange]);

    const setupAudio = useCallback(() => {
      if (audioContextRef.current) return;

      try {
        // Avoid passing `sampleRate` on some mobile Safari versions; it can
        // throw even within a user gesture. We'll accept the device rate and
        // schedule accordingly.
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        nextPlayTimeRef.current = 0;
        needsInitialBufferRef.current = true;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.connect(audioContext.destination);
        analyserRef.current = analyser;

        if (onVolumeChangeRef.current) {
          const dataArray = new Float32Array(analyser.fftSize);
          const tick = () => {
            analyser.getFloatTimeDomainData(dataArray);
            let sumSquares = 0.0;
            for (const sample of dataArray) sumSquares += sample * sample;
            const rms = Math.sqrt(sumSquares / dataArray.length);
            const volume = Math.min(1.0, rms * 5);
            onVolumeChangeRef.current?.(volume);
            animationFrameIdRef.current = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch {
        // Some browsers (notably iOS Safari) may require a user gesture before
        // AudioContext construction is allowed. We'll retry on unlock().
      }
    }, []);

    const primeAndSyncTimeline = useCallback(() => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // If the context was suspended, currentTime may not have advanced yet.
      // Align scheduling to the resumed clock to avoid "starting in the past".
      nextPlayTimeRef.current = ctx.currentTime;
      needsInitialBufferRef.current = true;

      // iOS Safari sometimes needs an actual start() to fully unlock output.
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start();
        // No need to keep this in audioSourcesRef; it's a one-sample prime.
      } catch {
        // ignore
      }
    }, []);

    const teardownAudio = useCallback(() => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }

      try {
        audioSourcesRef.current.forEach((s) => s.stop());
      } catch {}
      audioSourcesRef.current = [];
      nextPlayTimeRef.current = 0;
      remainderRef.current = null;
      pendingChunksRef.current = [];
      needsInitialBufferRef.current = true;

      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {}
        analyserRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }
    }, []);

    useEffect(() => {
      if (enabled) {
        setupAudio();
        return;
      }
      teardownAudio();
    }, [enabled, setupAudio, teardownAudio]);

    const drainPending = useCallback(() => {
      const ctx = audioContextRef.current;
      const analyser = analyserRef.current;
      if (!ctx || !analyser) return;
      if (ctx.state !== "running") return;
      if (pendingChunksRef.current.length === 0) return;

      const chunks = pendingChunksRef.current;
      pendingChunksRef.current = [];
      for (const chunk of chunks) {
        enqueuePcm16Internal(chunk);
      }
    }, []);

    const unlock = useCallback(() => {
      if (!enabled) return Promise.resolve();

      // Must be synchronous up to `resume()` to satisfy iOS user-gesture policy.
      setupAudio();
      const ctx = audioContextRef.current;
      if (!ctx) return Promise.resolve();

      if (ctx.state === "running") {
        primeAndSyncTimeline();
        drainPending();
        return Promise.resolve();
      }

      const p = ctx.resume().catch(() => {});
      // Finish the rest after resume resolves.
      void p.then(() => {
        if (ctx.state !== "running") return;
        primeAndSyncTimeline();
        drainPending();
      });
      return p;
    }, [drainPending, enabled, primeAndSyncTimeline, setupAudio]);

    const interrupt = useCallback(() => {
      const ctx = audioContextRef.current;
      if (ctx) {
        nextPlayTimeRef.current = ctx.currentTime;
        try {
          audioSourcesRef.current.forEach((s) => s.stop());
        } catch {}
        audioSourcesRef.current = [];
      }
      remainderRef.current = null;
      needsInitialBufferRef.current = true;
    }, []);

    const enqueuePcm16Internal = useCallback(
      (chunk: Uint8Array) => {
        const ctx = audioContextRef.current;
        const analyser = analyserRef.current;
        if (!ctx || !analyser) return;
        if (ctx.state !== "running") return;

        let data = chunk;
        if (remainderRef.current && remainderRef.current.length > 0) {
          const merged = new Uint8Array(remainderRef.current.length + chunk.length);
          merged.set(remainderRef.current, 0);
          merged.set(chunk, remainderRef.current.length);
          data = merged;
          remainderRef.current = null;
        }

        // Ensure even number of bytes for Int16 view.
        if (data.byteLength % 2 === 1) {
          remainderRef.current = data.subarray(data.byteLength - 1);
          data = data.subarray(0, data.byteLength - 1);
        }

        if (data.byteLength < 2) return;

        const pcm16 = new Int16Array(
          data.buffer,
          data.byteOffset,
          data.byteLength / 2
        );
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768.0;
        }

        // Resample 24kHz input into the device AudioContext sample rate to avoid
        // "fast-forward" playback on phones (typically 44.1k/48k).
        const srcRate = inputSampleRateRef.current;
        const dstRate = ctx.sampleRate;
        const resampled =
          srcRate === dstRate ? float32 : resampleLinear(float32, srcRate, dstRate);

        const audioBuffer = ctx.createBuffer(1, resampled.length, dstRate);
        audioBuffer.getChannelData(0).set(resampled);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        const now = ctx.currentTime;
        // Never schedule "in the past", and add a small lead time so the browser
        // has time to actually start the first buffer cleanly.
        const safetyLead = startSafetyLeadSecRef.current;
        const initialBuffer = initialStartBufferSecRef.current;
        const targetNow = now + safetyLead;
        if (nextPlayTimeRef.current < targetNow) nextPlayTimeRef.current = targetNow;

        const isFirstAfterReset = needsInitialBufferRef.current;
        if (isFirstAfterReset) {
          const initialTarget = now + initialBuffer;
          if (nextPlayTimeRef.current < initialTarget) nextPlayTimeRef.current = initialTarget;
          needsInitialBufferRef.current = false;
        }

        const startTime = nextPlayTimeRef.current;

        // Short fade-in on the first buffer avoids a click/pop if the PCM starts
        // away from zero crossing.
        if (isFirstAfterReset) {
          const g = ctx.createGain();
          const fade = fadeInSecRef.current;
          g.gain.setValueAtTime(0, startTime);
          g.gain.linearRampToValueAtTime(1, startTime + fade);
          source.connect(g);
          g.connect(analyser);
        } else {
          source.connect(analyser);
        }

        source.start(startTime);
        nextPlayTimeRef.current += audioBuffer.duration;

        audioSourcesRef.current.push(source);
        source.onended = () => {
          audioSourcesRef.current = audioSourcesRef.current.filter((s) => s !== source);
        };
      },
      []
    );

    const enqueuePcm16 = useCallback(
      (chunk: Uint8Array) => {
        if (!enabled) return;
        const ctx = audioContextRef.current;
        const analyser = analyserRef.current;
        if (!ctx || !analyser) {
          // If AudioContext couldn't be created yet (e.g., iOS needs gesture),
          // keep buffering and let unlock() construct + drain.
          pendingChunksRef.current.push(chunk);
          return;
        }

        if (ctx.state !== "running") {
          // Mobile browsers may drop scheduled buffers while suspended, so buffer
          // until we've been unlocked via user gesture.
          pendingChunksRef.current.push(chunk);
          void ctx.resume().catch(() => {});
          return;
        }

        enqueuePcm16Internal(chunk);
      },
      [enabled, enqueuePcm16Internal]
    );

    useImperativeHandle(
      ref,
      () => ({
        enqueuePcm16,
        interrupt,
        unlock,
      }),
      [enqueuePcm16, interrupt, unlock]
    );

    // This component is purely side-effects.
    return null;
  }
);


