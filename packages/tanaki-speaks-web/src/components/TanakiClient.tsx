import { SoulEngineProvider } from "@opensouls/react";
import { OrbitControls } from "@react-three/drei";
import { Box, ScrollArea, Text } from "@radix-ui/themes";
import { useMemo } from "react";

import { ChatInput } from "@/components/ChatInput";
import { GLBModel, Scene } from "@/components/3d";
import { useTanakiSoul } from "@/hooks/useTanakiSoul";

function readBoolEnv(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export default function TanakiClient() {
  const organization = import.meta.env.VITE_SOUL_ENGINE_ORGANIZATION as
    | string
    | undefined;
  const local = readBoolEnv(import.meta.env.VITE_SOUL_ENGINE_LOCAL, true);

  if (!organization) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <p className="font-mono text-sm">
          Missing <code>VITE_SOUL_ENGINE_ORGANIZATION</code>. Add it to{" "}
          <code>.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <SoulEngineProvider organization={organization} local={local}>
      <TanakiExperience />
    </SoulEngineProvider>
  );
}

function TanakiExperience() {
  const { connected, messages, send } = useTanakiSoul();

  const statusText = useMemo(() => {
    return connected ? "connected" : "connecting…";
  }, [connected]);

  return (
    <div style={{ height: "100dvh", width: "100%", position: "relative" }}>
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
        />
      </Scene>

      <Box
        className="absolute left-4 right-4 bottom-4 max-w-2xl mx-auto"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(10px)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Box className="flex items-center justify-between mb-2">
          <Text size="2" color="gray">
            {statusText}
          </Text>
          <Text size="2" color="gray">
            tanaki
          </Text>
        </Box>

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
          </Box>
        </ScrollArea>

        <Box className="mt-3">
          <ChatInput disabled={false} onSend={send} />
        </Box>
      </Box>
    </div>
  );
}


