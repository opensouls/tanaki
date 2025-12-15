import { useEffect, useMemo, useState } from "react";
import { useSoul } from "@opensouls/react";
import { said } from "@opensouls/soul";

export type ChatMessage = {
  id: string;
  role: "user" | "tanaki";
  content: string;
};

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useTanakiSoul() {
  const organization = "local";
  const local = true;

  const { soul, connected, disconnect } = useSoul({
    blueprint: "tanaki-speaks",
    local,
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

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: randomId(), role: "user", content: trimmed },
    ]);

    await soul.dispatch(said("User", trimmed));
  };

  return useMemo(() => {
    return {
      organization,
      local,
      soul,
      connected,
      messages,
      send,
      disconnect,
    };
  }, [organization, local, soul, connected, messages]);
}
