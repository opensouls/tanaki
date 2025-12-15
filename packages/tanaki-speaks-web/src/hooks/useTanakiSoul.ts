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

function readBoolEnv(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function useTanakiSoul() {
  const organization = import.meta.env.VITE_SOUL_ENGINE_ORGANIZATION as
    | string
    | undefined;
  const local = readBoolEnv(import.meta.env.VITE_SOUL_ENGINE_LOCAL, true);

  if (!organization) {
    throw new Error(
      "Missing VITE_SOUL_ENGINE_ORGANIZATION. Add it to your env (e.g. .env.local)."
    );
  }

  const { soul, connected, disconnect } = useSoul({
    blueprint: "tanaki-speaks",
    local,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const onSays = async ({ content }: { content: () => Promise<string> }) => {
      const text = await content();
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
    };
  }, [organization, local, soul, connected, messages]);
}


