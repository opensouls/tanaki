import { join, normalize } from "node:path";

type WsData = {
  kind: "soul" | "vite";
  org?: string;
  channel?: string;
  upstreamUrl?: string;
  upstream?: WebSocket;
};

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

async function handleTts(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonError("Missing OPENAI_API_KEY on server.", 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const text = typeof (body as any)?.text === "string" ? (body as any).text : "";
  const voice =
    typeof (body as any)?.voice === "string" ? (body as any).voice : "sage";

  const trimmed = text.trim();
  if (!trimmed) {
    return jsonError('Missing "text" in request body.');
  }

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instructions: "Speak as a Japanese schoolgirl who is not a native English speaker, using a strong Japanese accent. Make sure the tone is cheerful, friendly, and emotive. Speak quickly and keep each response short, using simple vocabulary and sentence structures common among English learners. Responses should sound organic and natural for a Japanese schoolgirl speaking English as a second language.",
      model: "gpt-4o-mini-tts",
      voice,
      input: trimmed,
      response_format: "pcm",
      format: "pcm",
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return jsonError(
      `Upstream TTS error (${upstream.status}). ${errText}`.trim(),
      502,
    );
  }

  if (!upstream.body) {
    return jsonError("Upstream did not return a streaming body.", 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Audio-Sample-Rate": "24000",
      "X-Audio-Channels": "1",
      "X-Audio-Format": "pcm_s16le",
    },
  });
}

async function proxyToVite(req: Request): Promise<Response> {
  const base = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const url = new URL(req.url);
  const upstreamUrl = new URL(base);
  upstreamUrl.pathname = url.pathname;
  upstreamUrl.search = url.search;

  const headers = new Headers(req.headers);
  headers.set("host", upstreamUrl.host);

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "manual",
  });

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
const distDir = join(import.meta.dir, "dist");
const indexPath = join(distDir, "index.html");
const indexFile = Bun.file(indexPath);

Bun.serve<WsData>({
  port,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    const dev = isDev();

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
    if (url.pathname === "/api/tts" && req.method === "POST") {
      return handleTts(req);
    }

    // Dev mode: proxy everything else (including SPA HTML + assets) to Vite for HMR.
    if (dev) {
      if (isWebSocketRequest(req)) {
        const base = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
        const wsBase = toWsUrl(base);
        const upstreamUrl = `${wsBase}${url.pathname}${url.search}`;
        const ok = server.upgrade(req, { data: { kind: "vite", upstreamUrl } });
        return ok ? new Response(null, { status: 101 }) : new Response("Upgrade failed", { status: 400 });
      }
      return proxyToVite(req);
    }

    // Static assets + SPA fallback
    const filePath =
      url.pathname === "/" ? indexPath : safeJoin(distDir, url.pathname);

    if (filePath) {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Missing build output. Run `bun run build`.", {
      status: 500,
    });
  },
  websocket: {
    open: (ws) => {
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

      const upstream = new WebSocket(upstreamUrl);
      upstream.binaryType = "arraybuffer";
      ws.data.upstream = upstream;

      upstream.addEventListener("message", (evt) => {
        ws.send(evt.data);
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
    },
    message: (ws, message) => {
      const upstream = ws.data.upstream;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(message as any);
    },
    close: (ws) => {
      try {
        ws.data.upstream?.close();
      } catch {
        // ignore
      }
    },
  },
});

console.log(`[web] listening on :${port} (serving ${distDir})`);


