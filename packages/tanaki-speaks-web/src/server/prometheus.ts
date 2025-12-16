export type WsKind = "presence" | "soul" | "vite";
export type WsDirection = "client_to_upstream" | "upstream_to_client" | "server_to_client";

type MetricType = "counter" | "gauge";
type LabelKey = string;
type Labels = Record<string, string>;

type MetricDef = {
  name: string;
  help: string;
  type: MetricType;
};

const defaultLabels: Labels = {
  app: "tanaki-open-souls",
};

const metricDefs: MetricDef[] = [
  {
    name: "tanaki_connected_users",
    help: "Number of connected users (presence WebSocket clients).",
    type: "gauge",
  },
  {
    name: "tanaki_ws_connections_total",
    help: "Total WebSocket connections opened.",
    type: "counter",
  },
  {
    name: "tanaki_ws_messages_total",
    help: "Total WebSocket messages forwarded/sent.",
    type: "counter",
  },
  {
    name: "tanaki_ws_message_bytes_total",
    help: "Total bytes of WebSocket messages forwarded/sent.",
    type: "counter",
  },
  {
    name: "tanaki_presence_broadcasts_total",
    help: "Total presence broadcast messages sent (userCount payload).",
    type: "counter",
  },
];

const series = new Map<string, Map<LabelKey, number>>();

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function normalizeLabels(labels: Labels): Labels {
  return { ...defaultLabels, ...labels };
}

function labelsToKey(labels: Labels): LabelKey {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}\u0000${labels[k]}`).join("\u0001");
}

function labelsToText(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const body = keys
    .map((k) => `${k}="${escapeLabelValue(labels[k])}"`)
    .join(",");
  return `{${body}}`;
}

function setValue(name: string, labels: Labels, value: number): void {
  const byLabel = series.get(name) ?? new Map<LabelKey, number>();
  byLabel.set(labelsToKey(labels), value);
  series.set(name, byLabel);
}

function incValue(name: string, labels: Labels, by = 1): void {
  const byLabel = series.get(name) ?? new Map<LabelKey, number>();
  const key = labelsToKey(labels);
  const prev = byLabel.get(key) ?? 0;
  byLabel.set(key, prev + by);
  series.set(name, byLabel);
}

function ensureFiniteNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function messageByteLength(message: unknown): number {
  if (typeof message === "string") {
    return new TextEncoder().encode(message).byteLength;
  }
  if (message instanceof ArrayBuffer) return message.byteLength;
  if (ArrayBuffer.isView(message)) return message.byteLength;
  if (typeof Blob !== "undefined" && message instanceof Blob) return message.size;
  return 0;
}

export function setConnectedUsers(count: number): void {
  setValue("tanaki_connected_users", normalizeLabels({}), ensureFiniteNumber(count));
}

export function incWsConnection(kind: WsKind): void {
  incValue("tanaki_ws_connections_total", normalizeLabels({ kind }), 1);
}

export function incWsMessage(kind: WsKind, direction: WsDirection, message: unknown): void {
  incValue("tanaki_ws_messages_total", normalizeLabels({ kind, direction }), 1);
  const bytes = messageByteLength(message);
  if (bytes > 0) incValue("tanaki_ws_message_bytes_total", normalizeLabels({ kind, direction }), bytes);
}

export function incPresenceBroadcast(): void {
  incValue("tanaki_presence_broadcasts_total", normalizeLabels({}), 1);
}

export async function metricsResponse(): Promise<Response> {
  let body = "";

  for (const def of metricDefs) {
    body += `# HELP ${def.name} ${def.help}\n`;
    body += `# TYPE ${def.name} ${def.type}\n`;

    const byLabel = series.get(def.name);
    if (!byLabel) continue;

    for (const [labelKey, value] of byLabel.entries()) {
      const labels: Labels = {};
      if (labelKey.length > 0) {
        for (const part of labelKey.split("\u0001")) {
          if (!part) continue;
          const [k, v] = part.split("\u0000");
          if (!k) continue;
          labels[k] = v ?? "";
        }
      }

      body += `${def.name}${labelsToText(labels)} ${ensureFiniteNumber(value)}\n`;
    }
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}


