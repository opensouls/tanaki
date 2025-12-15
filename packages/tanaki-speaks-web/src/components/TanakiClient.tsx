import { SoulEngineProvider } from "@opensouls/react";
import { OrbitControls } from "@react-three/drei";
import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { TanakiAudio, type TanakiAudioHandle } from "@/components/TanakiAudio";
import { GLBModel, Scene } from "@/components/3d";
import { useTanakiSoul } from "@/hooks/useTanakiSoul";
import { useTTS } from "@/hooks/useTTS";

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

function TanakiExperience() {
  const { connected, messages, send } = useTanakiSoul();
  const { speak } = useTTS();
  const audioRef = useRef<TanakiAudioHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const [blend, setBlend] = useState(0);
  const unlockedOnceRef = useRef(false);

  const statusText = useMemo(() => {
    return connected ? "connected" : "connecting…";
  }, [connected]);

  // Ported from `reference-only/page.tsx`: these props are what actually apply
  // the procedural materials + hide helper nodes in the Tanaki GLB.
  const hideNodes = useMemo(() => {
    return [
      "BezierCirclenewBod",
      "mouth_1",
      "armR002",
      "armL002",
      "browR_1",
      "browL_1",
      "browM",
    ] as const;
  }, []);

  const materialOverride = useMemo(() => {
    return [
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
  }, []);

  // When Tanaki says something new, stream TTS audio into the player.
  useEffect(() => {
    const latest = [...messages].reverse().find((m) => m.role === "tanaki");
    if (!latest) return;
    if (lastSpokenIdRef.current === latest.id) return;
    lastSpokenIdRef.current = latest.id;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    audioRef.current?.interrupt();
    void speak(latest.content, {
      signal: abortRef.current.signal,
      onChunk: (chunk) => audioRef.current?.enqueuePcm16(chunk),
    }).catch((err) => {
      // Avoid crashing the UI if TTS fails.
      console.error("TTS error:", err);
    });
  }, [messages, speak]);

  // Keep the chat scrolled to the newest message.
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div
      style={{ height: "100dvh", width: "100%", position: "relative" }}
      onPointerDownCapture={() => {
        if (unlockedOnceRef.current) return;
        unlockedOnceRef.current = true;
        void audioRef.current?.unlock();
      }}
      onTouchStartCapture={() => {
        // iOS Safari sometimes prefers a touch event specifically.
        if (unlockedOnceRef.current) return;
        unlockedOnceRef.current = true;
        void audioRef.current?.unlock();
      }}
    >
      <Scene
        showControls={false}
        camera={{
          position: [0, 1.2, 5.2],
          fov: 35,
        }}
      >
        <OrbitControls
          makeDefault
          target={[0, 1.0, 0]}
          enableDamping
          dampingFactor={0.05}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          panSpeed={0.8}
        />
        <GLBModel
          url="/Tanaki-anim-web-v1.glb"
          position={[0, 0, 0]}
          animationName="Tanaki_Floating_idle_117"
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

      <Box
        className="absolute left-4 right-4 bottom-4 max-w-2xl mx-auto"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(10px)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Flex justify="between" align="center" className="mb-2" gap="3">
          <Text size="2" color="gray">
            {statusText}
          </Text>
          <Text size="2" color="gray">
            tanaki
          </Text>
        </Flex>

        <ScrollArea
          type="always"
          scrollbars="vertical"
          style={{ maxHeight: 200 }}
        >
          <Box className="flex flex-col gap-2 pr-2">
            {messages.map((m) => (
              <Box key={m.id} className="flex">
                <Box
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{
                    marginLeft: m.role === "user" ? "auto" : undefined,
                    background:
                      m.role === "user"
                        ? "rgba(59,130,246,0.35)"
                        : "rgba(148,163,184,0.18)",
                    maxWidth: "90%",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </Box>
              </Box>
            ))}
            <div ref={scrollBottomRef} />
          </Box>
        </ScrollArea>

        <Box className="mt-3">
          <ChatInput
            disabled={false}
            onSend={async (text) => {
              // Unlock audio on user gesture to satisfy autoplay policies.
              await audioRef.current?.unlock();
              await send(text);
            }}
          />
        </Box>
      </Box>
    </div>
  );
}


