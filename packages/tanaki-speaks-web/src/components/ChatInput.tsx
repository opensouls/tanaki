import { Box, Button, TextField } from "@radix-ui/themes";
import { useCallback, useState } from "react";

export type ChatInputProps = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void | Promise<void>;
};

export function ChatInput({
  disabled = false,
  placeholder = "type a message…",
  onSend,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setIsSending(false);
    }
  }, [onSend, text]);

  return (
    <Box className="flex w-full gap-2 items-center">
      <TextField.Root className="flex-1">
        {/* Radix Themes v3 has some bundler quirks around TextField.Input; keep it simple. */}
        <input
          className="rt-TextFieldInput"
          value={text}
          placeholder={placeholder}
          disabled={disabled || isSending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            e.preventDefault();
            void send();
          }}
        />
      </TextField.Root>

      <Button
        disabled={disabled || isSending || text.trim().length === 0}
        onClick={() => void send()}
      >
        Send
      </Button>
    </Box>
  );
}


