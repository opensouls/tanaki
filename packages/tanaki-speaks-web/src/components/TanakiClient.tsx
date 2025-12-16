import { SoulEngineProvider } from "@opensouls/react";
import { useProgress } from "@react-three/drei";
import { Box, Flex, Text, VisuallyHidden } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { FloatingBubbles } from "@/components/FloatingBubbles";
import { TanakiAudio, type TanakiAudioHandle } from "@/components/TanakiAudio";
import { GLBModel, Scene } from "@/components/3d";
import { useTanakiSoul } from "@/hooks/useTanakiSoul";
import { base64ToUint8 } from "@/utils/base64";

function readBoolEnv(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export default function TanakiClient() {
  const organization = "local";
  const local = readBoolEnv(import.meta.env.VITE_SOUL_ENGINE_LOCAL, false);

  // Always connect via same-origin WS proxy: /ws/soul/:org/:channel
  // - Works on Fly (soul-engine is internal-only)
  // - Works locally (single mode to debug)
  const getWebSocketUrl =
    typeof window === "undefined"
      ? undefined
      : (org: string, _local: boolean, debug: boolean) => {
          const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          const channel = debug ? "debug-chat" : "experience";
          return `${wsProtocol}//${window.location.host}/ws/soul/${encodeURIComponent(org)}/${channel}`;
        };

  return (
    <SoulEngineProvider
      organization={organization}
      local={local}
      getWebSocketUrl={getWebSocketUrl}
    >
      <TanakiExperience />
    </SoulEngineProvider>
  );
}

const hideNodes = [
  "BezierCirclenewBod",
  "mouth_1",
  "armR002",
  "armL002",
  "browR_1",
  "browL_1",
  "browM",
] as const;

const materialOverride = [
  {
    matcher: ["BezierCirclenewBod003"],
    options: {
      axis: "y",
      colors: ["#FF005C", "#FF005C", "#FFEB00"],
      stops: [0.2, 0.612, 0.874],
      roughness: 0.6,
      metalness: 0.0,
      emissiveIntensity: 1,
    },
  },
  {
    matcher: ["mouthrig"],
    options: {
      axis: "y",
      colors: ["#FF005C", "#FF005C", "#FF005C"],
      stops: [0.2, 0.612, 0.874],
      roughness: 0.6,
      metalness: 0.0,
      emissiveIntensity: 1,
    },
  },
  {
    matcher: ["handR_1", "handL_1"],
    options: {
      axis: "-y",
      colors: ["#F3F3F3", "#F9DA5F", "#F9DA5F", "#F3AC76", "#EC6388"],
      stops: [0.009, 0.0304, 0.514, 0.692, 0.807],
      roughness: 0.6,
      metalness: 0.0,
    },
  },
  {
    matcher: ["armRHigherPoly"],
    options: {
      axis: "x",
      colors: ["#BFBFBF", "#BFBFBF"],
      stops: [0.6, 0.0],
      opacities: [0.0, 1.0],
      roughness: 0.6,
      metalness: 0.0,
    },
  },
  {
    matcher: ["armLHigherPoly"],
    options: {
      axis: "x",
      colors: ["#BFBFBF", "#BFBFBF"],
      stops: [0.4, 1.0],
      opacities: [0.0, 1.0],
      roughness: 0.6,
      metalness: 0.0,
    },
  },
] as const;

function TanakiExperience() {
  const { connected, messages, send, connectedUsers, soul } = useTanakiSoul();
  const audioRef = useRef<TanakiAudioHandle | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const activeTtsStreamIdRef = useRef<string | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [blend, setBlend] = useState(0);
  const unlockedOnceRef = useRef(false);
  const [overlayHeight, setOverlayHeight] = useState(240);
  const [liveText, setLiveText] = useState("");

  const enableAnimationDebug = useMemo(() => {
    if (import.meta.env.DEV) return true;
    if (typeof window === "undefined") return false;
    const qs = new URLSearchParams(window.location.search);
    return qs.has("debugAnimations");
  }, []);

  const unlockOnce = useCallback(() => {
    if (unlockedOnceRef.current) return;
    unlockedOnceRef.current = true;
    // Don't await: on iOS, `resume()` must be called in the same gesture stack.
    void audioRef.current?.unlock();
  }, []);

  const statusIndicator = useMemo(() => {
    return connected ? "🟢" : "🔴";
  }, [connected]);

  // When Tanaki says something new, update aria-live text.
  useEffect(() => {
    const latest = [...messages].reverse().find((m) => m.role === "tanaki");
    if (!latest) return;
    if (lastSpokenIdRef.current === latest.id) return;
    lastSpokenIdRef.current = latest.id;
    setLiveText(latest.content);
  }, [messages]);

  // Listen for Soul Engine ephemeral audio events (useTTS).
  useEffect(() => {
    const onChunk = (evt: any) => {
      console.log("TTS chunk:", evt);
      const data = evt?.data as any;
      if (!data || typeof data !== "object") return;

      const streamId = typeof data.streamId === "string" ? data.streamId : null;
      const chunkBase64 = typeof data.chunkBase64 === "string" ? data.chunkBase64 : null;
      if (!streamId || !chunkBase64) return;

      // If a new stream starts, interrupt queued audio so it feels responsive.
      if (activeTtsStreamIdRef.current !== streamId) {
        activeTtsStreamIdRef.current = streamId;
        audioRef.current?.interrupt();
      }

      try {
        const bytes = base64ToUint8(chunkBase64);
        audioRef.current?.enqueuePcm16(bytes);
      } catch (err) {
        console.error("Failed to decode/enqueue TTS chunk:", err);
      }
    };

    const onComplete = (evt: any) => {
      const data = evt?.data as any;
      const streamId = typeof data?.streamId === "string" ? data.streamId : null;
      if (!streamId) return;
      if (activeTtsStreamIdRef.current === streamId) {
        activeTtsStreamIdRef.current = null;
      }
    };

    const onError = (evt: any) => {
      const data = evt?.data as any;
      const message = typeof data?.message === "string" ? data.message : "unknown error";
      console.error("TTS error event:", message, evt);
    };

    soul.on("ephemeral:audio-chunk", onChunk);
    soul.on("ephemeral:audio-complete", onComplete);
    soul.on("ephemeral:audio-error", onError);
    return () => {
      soul.off("ephemeral:audio-chunk", onChunk);
      soul.off("ephemeral:audio-complete", onComplete);
      soul.off("ephemeral:audio-error", onError);
    };
  }, [soul]);

  // Measure the bottom overlay so bubbles can avoid it (mobile-friendly).
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setOverlayHeight(Math.max(180, Math.round(rect.height + 24)));
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      style={{ height: "100dvh", width: "100%", position: "relative" }}
      onPointerDownCapture={() => {
        unlockOnce();
      }}
      onTouchStartCapture={() => {
        // iOS Safari sometimes prefers a touch event specifically.
        unlockOnce();
      }}
    >
      <ModelLoadingOverlay />
      <Scene
        showControls={false}
        camera={{
          position: [0, 1.2, 5.2],
          fov: 35,
        }}
        lookAt={[0, 1.0, 0]}
      >
        <GLBModel
          url="/tanaki-animation.glb"
          position={[0, 0, 0]}
          animationName="Tanaki_Floating_idle_117"
          logAnimations={enableAnimationDebug}
          exposeAnimationsToWindow={enableAnimationDebug ? "__tanakiAnimations" : false}
          poseBlend={{
            clipName: "Tanaki_Phonemes",
            fromIndex: 1,
            toIndex: 3,
            blend,
          }}
          hideNodes={[...hideNodes]}
          // @ts-expect-error materialOverride is not typed
          materialOverride={[...materialOverride]}
        />
      </Scene>

      <TanakiAudio
        ref={audioRef}
        enabled={true}
        onVolumeChange={(volume) => {
          setBlend((prev) => prev * 0.5 + volume * 0.5);
        }}
      />

      <FloatingBubbles messages={messages} avoidBottomPx={overlayHeight} />

      <Box
        ref={overlayRef}
        className="absolute left-4 right-4 bottom-4 max-w-2xl mx-auto"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(10px)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Flex justify="between" align="center" className="mb-2" gap="3">
          <Flex align="center" gap="2">
            <Text size="2">
              {statusIndicator}
            </Text>
            {connectedUsers > 0 && (
              <Text size="1" color="gray" style={{ opacity: 0.7 }}>
                {connectedUsers} {connectedUsers === 1 ? "person" : "people"} here
              </Text>
            )}
          </Flex>
          <Text size="2" color="gray">
            tanaki
          </Text>
        </Flex>

        <VisuallyHidden>
          <div aria-live="polite" aria-atomic="true">
            {liveText}
          </div>
        </VisuallyHidden>

        <Box className="mt-3">
          <ChatInput
            disabled={false}
            onUserGesture={unlockOnce}
            onSend={async (text) => {
              unlockOnce();
              await send(text);
            }}
          />
        </Box>
      </Box>
    </div>
  );
}

function ModelLoadingOverlay() {
  const { active, progress, item, loaded, total } = useProgress();
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When Content-Length header is missing (common with compression), total=0 and
  // progress stays at 0. In that case, simulate progress to give visual feedback.
  const hasRealProgress = total > 0;

  useEffect(() => {
    if (!active) {
      setSimulatedProgress(0);
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      return;
    }

    // Only simulate when we don't have real progress
    if (hasRealProgress) {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      return;
    }

    // Simulate progress with diminishing returns (never quite reaches 100)
    simulationRef.current = setInterval(() => {
      setSimulatedProgress((prev) => {
        // Logarithmic approach: fast at start, slows as it nears ~90%
        const remaining = 90 - prev;
        if (remaining <= 0) return prev;
        return prev + remaining * 0.08;
      });
    }, 100);

    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
    };
  }, [active, hasRealProgress]);

  // Show while any three loader is active, but especially helpful for the big GLB.
  if (!active || progress >= 100) return null;

  const pct = hasRealProgress
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : Math.max(0, Math.min(100, Math.round(simulatedProgress)));

  const label =
    typeof item === "string" && item.length > 0
      ? `Loading ${item.split("/").slice(-1)[0]}…`
      : "Loading 3D model…";

  return (
    <div
      aria-live="polite"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Box
        style={{
          width: "min(520px, 92vw)",
          background: "rgba(0,0,0,0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 16,
          backdropFilter: "blur(10px)",
        }}
      >
        <Flex justify="between" align="center" gap="3">
          <Text size="2" color="gray">
            {label}
          </Text>
          <Text size="2" color="gray">
            {pct}%
          </Text>
        </Flex>

        <div
          style={{
            height: 10,
            borderRadius: 999,
            marginTop: 10,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "rgba(34,197,94,0.9)",
              transition: "width 120ms linear",
            }}
          />
        </div>
      </Box>
    </div>
  );
}


