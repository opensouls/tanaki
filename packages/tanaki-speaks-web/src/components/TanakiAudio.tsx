"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

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
  /** Default is 24000 to match OpenAI PCM output. */
  sampleRate?: number;
};

export const TanakiAudio = forwardRef<TanakiAudioHandle, TanakiAudioProps>(
  function TanakiAudio(
    { enabled, onVolumeChange, sampleRate = 24000 }: TanakiAudioProps,
    ref
  ) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const nextPlayTimeRef = useRef(0);
    const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
    const remainderRef = useRef<Uint8Array | null>(null);
    const onVolumeChangeRef = useRef(onVolumeChange);
    const pendingChunksRef = useRef<Uint8Array[]>([]);

    useEffect(() => {
      onVolumeChangeRef.current = onVolumeChange;
    }, [onVolumeChange]);

    const setupAudio = useCallback(async () => {
      if (audioContextRef.current) return;

      try {
        const audioContext = new AudioContext({ sampleRate });
        audioContextRef.current = audioContext;
        nextPlayTimeRef.current = 0;

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
    }, [sampleRate]);

    const primeAndSyncTimeline = useCallback(async () => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // If the context was suspended, currentTime may not have advanced yet.
      // Align scheduling to the resumed clock to avoid "starting in the past".
      nextPlayTimeRef.current = ctx.currentTime;

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

    const drainPending = useCallback(() => {
      const ctx = audioContextRef.current;
      const analyser = analyserRef.current;
      if (!ctx || !analyser) return;
      if (ctx.state !== "running") return;
      if (pendingChunksRef.current.length === 0) return;

      const chunks = pendingChunksRef.current;
      pendingChunksRef.current = [];
      for (const chunk of chunks) {
        // Replay as-if newly received now that audio is running.
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        enqueuePcm16Internal(chunk);
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
        void setupAudio();
        return;
      }
      teardownAudio();
    }, [enabled, setupAudio, teardownAudio]);

    const unlock = useCallback(async () => {
      if (!enabled) return;
      await setupAudio();
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          // ignored; some browsers require a user gesture
        }
      }
      if (ctx.state === "running") {
        await primeAndSyncTimeline();
        drainPending();
      }
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

        const audioBuffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
        audioBuffer.getChannelData(0).set(float32);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);

        const now = ctx.currentTime;
        if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
        source.start(nextPlayTimeRef.current);
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


