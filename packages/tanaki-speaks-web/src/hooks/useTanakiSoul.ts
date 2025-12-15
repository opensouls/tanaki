import { useEffect, useMemo, useState, useCallback } from "react";
import { useSoul } from "@opensouls/react";
import { said } from "@opensouls/soul";
import { usePresence } from "./usePresence";

export type ChatMessage = {
  id: string;
  role: "user" | "tanaki";
  content: string;
};

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Consistent session ID for all users to share
const SHARED_SOUL_ID = "tanaki-shared-session";

export function useTanakiSoul() {
  const organization = "local";
  const local = true;

  // Connect to presence tracking
  const { connectedUsers: presenceCount, isConnected: presenceConnected } = usePresence({ 
    enabled: true 
  });

  const { soul, connected, disconnect } = useSoul({
    blueprint: "tanaki-speaks",
    soulId: SHARED_SOUL_ID,
    local,
    token: "test",
    debug: true,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const onSays = async ({ content }: { content: () => Promise<string> }) => {
      console.log("onSays");
      const text = await content();
      console.log("text", text);
      setMessages((prev) => [
        ...prev,
        { id: randomId(), role: "tanaki", content: text },
      ]);
    };

    soul.on("says", onSays);
    return () => {
      soul.off("says", onSays);
    };
  }, [soul]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: randomId(), role: "user", content: trimmed },
    ]);

    // Dispatch with connected count in metadata
    await soul.dispatch({
      ...said("User", trimmed),
      _metadata: {
        connectedUsers: presenceCount,
      },
    });
  }, [soul, presenceCount]);

  return useMemo(() => {
    return {
      organization,
      local,
      soul,
      connected,
      messages,
      send,
      disconnect,
      connectedUsers: presenceCount,
      presenceConnected,
    };
  }, [organization, local, soul, connected, messages, send, disconnect, presenceCount, presenceConnected]);
}
