import { join, normalize } from "node:path";
import type { ServerWebSocket } from "bun";
import {
  incPresenceBroadcast,
  incWsConnection,
  incWsMessage,
  metricsResponse,
  setConnectedUsers,
  type WsKind,
} from "./src/server/prometheus.ts";

type WsData = {
  kind: "soul" | "vite" | "presence";
  org?: string;
  channel?: string;
  upstreamUrl?: string;
  upstreamProtocol?: string;
  upstream?: WebSocket;
};

// Track connected users by their WebSocket
const connectedPresenceClients = new Set<ServerWebSocket<WsData>>();

function getConnectedUserCount(): number {
  return connectedPresenceClients.size;
}

function broadcastUserCount(): void {
  const count = getConnectedUserCount();
  const message = JSON.stringify({ type: "userCount", count });
  
  for (const ws of connectedPresenceClients) {
    try {
      ws.send(message);
      incWsMessage("presence", "server_to_client", message);
    } catch {
      // ignore send errors
    }
  }
  if (connectedPresenceClients.size > 0) incPresenceBroadcast();
  
  console.log(`[presence] Broadcasting user count: ${count}`);
}

function isWebSocketRequest(req: Request): boolean {
  return (req.headers.get("upgrade") || "").toLowerCase() === "websocket";
}

function isDev(): boolean {
  const dev = (process.env.DEV || "").toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || "").toLowerCase();
  return dev === "1" || dev === "true" || nodeEnv === "development";
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}`;
  return httpUrl;
}

function safeJoin(baseDir: string, urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const full = normalize(join(baseDir, rel));
  if (!full.startsWith(baseDir)) return null;
  return full;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// MIME types that Bun might not recognize correctly
const MIME_OVERRIDES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

function getMimeType(filePath: string, bunFile: ReturnType<typeof Bun.file>): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_OVERRIDES[ext] || bunFile.type || "application/octet-stream";
}

/**
 * Generate an ETag from file size and mtime.
 */
function generateETag(size: number, mtime: number): string {
  return `"${size.toString(16)}-${mtime.toString(16)}"`;
}

/**
 * Serve a static file, checking for pre-compressed .gz version first.
 * If a .gz file exists and client accepts gzip, serve that instead.
 * Supports ETag for conditional requests.
 */
async function serveStaticFile(
  filePath: string,
  req: Request,
): Promise<Response | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const etag = generateETag(file.size, file.lastModified);

  // Check If-None-Match for conditional request
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag },
    });
  }

  // Check for pre-compressed version
  const acceptEncoding = req.headers.get("accept-encoding") || "";
  if (acceptEncoding.includes("gzip")) {
    const gzFile = Bun.file(`${filePath}.gz`);
    if (await gzFile.exists()) {
      const gzEtag = generateETag(gzFile.size, gzFile.lastModified) + "-gz";
      
      // Check ETag for compressed version too
      if (ifNoneMatch === gzEtag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: gzEtag, Vary: "Accept-Encoding" },
        });
      }

      return new Response(gzFile, {
        headers: {
          "Content-Type": getMimeType(filePath, file),
          "Content-Length": gzFile.size.toString(),
          "Content-Encoding": "gzip",
          "Cache-Control": "public, max-age=604800",
          "Vary": "Accept-Encoding",
          "ETag": gzEtag,
        },
      });
    }
  }

  // Serve uncompressed with Content-Length for progress tracking
  return new Response(file, {
    headers: {
      "Content-Type": getMimeType(filePath, file),
      "Content-Length": file.size.toString(),
      "Cache-Control": "public, max-age=604800",
      "ETag": etag,
    },
  });
}

async function handleTts(req: Request): Promise<Response> {
  void req;
  return jsonError("TTS endpoint removed: audio is streamed from the Soul Engine via ephemeral events.", 404);
}

async function proxyToVite(req: Request): Promise<Response> {
  const base = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const url = new URL(req.url);
  const upstreamUrl = new URL(base);
  upstreamUrl.pathname = url.pathname;
  upstreamUrl.search = url.search;

  const headers = new Headers(req.headers);
  headers.set("host", upstreamUrl.host);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
    });
  } catch (err: any) {
    // In dev, browser refreshes frequently cancel in-flight requests; if the upstream
    // socket gets reset, don't take down the proxy.
    const code = typeof err?.code === "string" ? err.code : "";
    const message = err?.message ? String(err.message) : "Upstream fetch failed";
    const status = code === "ECONNRESET" ? 502 : 502;
    return jsonError(`${message}${code ? ` (${code})` : ""}`, status);
  }

  // Avoid leaking Vite internal host/port across redirects when browsing via Bun.
  const outHeaders = new Headers(upstream.headers);
  const loc = outHeaders.get("location");
  if (loc && (loc.startsWith(base) || loc.startsWith(toWsUrl(base)))) {
    try {
      const locUrl = new URL(loc);
      locUrl.host = new URL(req.url).host;
      locUrl.protocol = new URL(req.url).protocol;
      outHeaders.set("location", locUrl.toString());
    } catch {
      // ignore
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

const port = Number.parseInt(process.env.PORT || "3002", 10);
const metricsPort = Number.parseInt(
  process.env.METRICS_PORT || (isDev() ? "9092" : "9091"),
  10,
);
const distDir = join(import.meta.dir, "dist");
const indexPath = join(distDir, "index.html");

// Ensure the gauge is exported even before any clients connect.
setConnectedUsers(0);

// Fly scrapes Prometheus-formatted metrics from this dedicated port.
Bun.serve({
  port: metricsPort,
  hostname: "0.0.0.0",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/metrics") return metricsResponse();
    return new Response("Not found", { status: 404 });
  },
});

Bun.serve<WsData>({
  port,
  hostname: "0.0.0.0",
  fetch: async (req, server) => {
    const url = new URL(req.url);
    const dev = isDev();

    // Presence WebSocket for tracking connected users
    if (url.pathname === "/ws/presence") {
      if (!isWebSocketRequest(req)) {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      
      const ok = server.upgrade(req, { data: { kind: "presence" } });
      return ok ? new Response(null, { status: 101 }) : new Response("Upgrade failed", { status: 400 });
    }

    // API endpoint to get current user count
    if (url.pathname === "/api/presence" && req.method === "GET") {
      return new Response(JSON.stringify({ connectedUsers: getConnectedUserCount() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // WebSocket proxy to internal soul-engine.
    // /ws/soul/:org/:channel -> ws://127.0.0.1:4000/:org/:channel
    if (url.pathname.startsWith("/ws/soul/")) {
      if (!isWebSocketRequest(req)) {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const org = parts[2] || "local";
      const channel = parts[3] || "experience";

      const ok = server.upgrade(req, { data: { kind: "soul", org, channel } });
      return ok ? new Response(null, { status: 101 }) : new Response("Upgrade failed", { status: 400 });
    }

    // Server-side API
    // (TTS is now emitted from the Soul Engine via ephemeral events.)
    if (url.pathname === "/api/tts") {
      return handleTts(req);
    }

    // Dev mode: proxy everything else (including SPA HTML + assets) to Vite for HMR.
    if (dev) {
      if (isWebSocketRequest(req)) {
        const base = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
        const wsBase = toWsUrl(base);
        const upstreamUrl = `${wsBase}${url.pathname}${url.search}`;
        // Vite HMR uses the "vite-hmr" websocket subprotocol; forward it upstream.
        const upstreamProtocol =
          (req.headers.get("sec-websocket-protocol") || "")
            .split(",")[0]
            ?.trim() || undefined;

        const ok = server.upgrade(req, {
          data: { kind: "vite", upstreamUrl, upstreamProtocol },
        });
        return ok ? new Response(null, { status: 101 }) : new Response("Upgrade failed", { status: 400 });
      }
      return proxyToVite(req);
    }

    // Static assets + SPA fallback
    const filePath =
      url.pathname === "/" ? indexPath : safeJoin(distDir, url.pathname);

    if (filePath) {
      const response = await serveStaticFile(filePath, req);
      if (response) return response;
    }

    // SPA fallback to index.html
    const indexResponse = await serveStaticFile(indexPath, req);
    if (indexResponse) return indexResponse;

    return new Response("Missing build output. Run `bun run build`.", {
      status: 500,
    });
  },
  websocket: {
    open: (ws) => {
      // Handle presence connections
      if (ws.data.kind === "presence") {
        connectedPresenceClients.add(ws);
        setConnectedUsers(getConnectedUserCount());
        incWsConnection("presence");
        console.log(`[presence] User connected`);
        
        // Send current count to the new connection
        const initial = JSON.stringify({ type: "userCount", count: getConnectedUserCount() });
        ws.send(initial);
        incWsMessage("presence", "server_to_client", initial);
        
        // Broadcast updated count to all
        broadcastUserCount();
        return;
      }

      let upstreamUrl: string | undefined;

      if (ws.data.kind === "soul") {
        const org = ws.data.org || "local";
        const channel = ws.data.channel || "experience";
        upstreamUrl = `ws://127.0.0.1:4000/${encodeURIComponent(
          org,
        )}/${encodeURIComponent(channel)}`;
      } else {
        upstreamUrl = ws.data.upstreamUrl;
      }

      if (!upstreamUrl) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }

      const protocol = ws.data.upstreamProtocol;
      const upstream = protocol ? new WebSocket(upstreamUrl, protocol) : new WebSocket(upstreamUrl);
      upstream.binaryType = "arraybuffer";
      ws.data.upstream = upstream;

      upstream.addEventListener("message", (evt) => {
        ws.send(evt.data);
        incWsMessage(ws.data.kind as WsKind, "upstream_to_client", evt.data);
      });
      upstream.addEventListener("close", () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
      upstream.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });

      incWsConnection(ws.data.kind as WsKind);
    },
    message: (ws, message) => {
      // Handle presence pings
      if (ws.data.kind === "presence") {
        return;
      }

      const upstream = ws.data.upstream;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(message as any);
      incWsMessage(ws.data.kind as WsKind, "client_to_upstream", message);
    },
    close: (ws) => {
      // Handle presence disconnections
      if (ws.data.kind === "presence") {
        connectedPresenceClients.delete(ws);
        setConnectedUsers(getConnectedUserCount());
        console.log(`[presence] User disconnected`);
        broadcastUserCount();
        return;
      }

      try {
        ws.data.upstream?.close();
      } catch {
        // ignore
      }
    },
  },
});

console.log(`[web] listening on :${port} (serving ${distDir})`);
console.log(`[metrics] listening on :${metricsPort} (/metrics)`);
