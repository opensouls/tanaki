import { useEffect, useState, useCallback, useRef } from "react";

interface UsePresenceOptions {
  enabled?: boolean;
}

export function usePresence({ enabled = true }: UsePresenceOptions = {}) {
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Build WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/presence`;

    console.log("[presence] Connecting to", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[presence] Connected");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "userCount") {
          console.log("[presence] User count:", data.count);
          setConnectedUsers(data.count);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log("[presence] Disconnected");
      setIsConnected(false);
      wsRef.current = null;

      // Reconnect after a delay
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error("[presence] WebSocket error:", error);
    };
  }, [enabled]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    connectedUsers,
    isConnected,
    disconnect,
    reconnect: connect,
  };
}
