# tanaki-open-souls

Tanaki is a conversational “AI soul” (personality + cognition) running on the OpenSouls Soul Engine, with a web frontend that renders a 3D Tanaki avatar and plays real-time TTS audio.

If you want to learn the Soul Engine itself, start here: [opensouls/opensouls](https://github.com/opensouls/opensouls).

### Quickstart (run from scratch)

**Prereqs**
- **Bun**: install from [bun.sh](https://bun.sh)

**0) Clone and initialize the submodules**

```bash
git clone https://github.com/opensouls/tanaki
cd tanaki
git submodule init
git submodule update
```

**1) Install workspace deps**

```bash
bun install
```

**2) One-time setup for the Soul Engine services**

This repo vendors `opensouls/` as a workspace. Run the setup script once (it configures the engine workspace; you may be prompted for keys depending on your setup):

```bash
bun run setup
```

**3) Start the Soul Engine services (UI + cloud + docs)**

```bash
bun run start
```

- Docs usually come up on `http://localhost:3001` (see `opensouls/README.md`).

**4) Start Tanaki’s soul (the blueprint)**

In a new terminal:

```bash
cd packages/tanaki-speaks
bunx soul-engine dev
```

This runs the **`tanaki-speaks`** blueprint against your local Soul Engine.

**5) Start the web app**

In a new terminal:

```bash
cd packages/tanaki-speaks-web
bun dev
```

Open the site at `http://localhost:3002`.

---

### Where Tanaki’s personality comes from (`packages/tanaki-speaks`)

Tanaki’s “who am I?” mainly comes from **static memories** loaded by the soul definition:

- **Core personality + scene**: `packages/tanaki-speaks/soul/staticMemories/core.md`
- **Loaded into the soul**: `packages/tanaki-speaks/soul/soul.ts` (via `staticMemories.core = load("./staticMemories/core.md")`)

Tanaki’s behavior loop is implemented in:

- **Main mental process**: `packages/tanaki-speaks/soul/initialProcess.ts`
  - Batches messages, adapts instructions for 1:1 vs group chat, generates dialog, and triggers TTS.
- **Cognitive steps**: `packages/tanaki-speaks/soul/cognitiveSteps/`

If you want to change Tanaki’s vibe quickly, edit `core.md` and save—when running `bunx soul-engine dev`, changes sync immediately.

---

### How the web app hooks up (`packages/tanaki-speaks-web`)

The web app talks to the Soul Engine over WebSockets, and the 3D avatar + audio playback are driven by events coming back from the soul.

#### High-level architecture

```mermaid
flowchart LR
  user[User in browser] -->|types message| webUI[React UI]

  subgraph Web App (localhost:3002)
    webUI -->|dispatch perception\nsaid("User", text)| reactSDK[@opensouls/react useSoul()]
    reactSDK -->|WS same-origin| bunServer[Bun server\n/ws/soul/:org/:channel]
    presence[Presence WS\n/ws/presence] --> bunServer
  end

  bunServer -->|WS proxy| soulEngine[Soul Engine\nws://127.0.0.1:4000/:org/:channel]

  soulEngine -->|\"says\" event (text)| reactSDK
  soulEngine -->|ephemeral audio events\n(audio-chunk/audio-complete)| webAudio[TanakiAudio\nAudioContext playback]
  webAudio -->|volume -> mouth blend| avatar[3D Tanaki avatar]
```

#### Message + audio flow (what happens when you press “send”)

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Web UI (React)
  participant WS as Bun WS proxy (/ws/soul/...)
  participant SE as Soul Engine (localhost:4000)
  participant S as Tanaki soul (tanaki-speaks)
  participant A as Audio player (TanakiAudio)

  U->>UI: type + send message
  UI->>SE: dispatch perception (said("User", text)) via WS proxy
  SE->>S: invoke mental process (initialProcess.ts)
  S-->>SE: stream "speak" tokens (text)
  SE-->>UI: "says" event (final text)
  UI-->>U: show chat bubbles

  Note over S: initialProcess.ts calls useTTS().speak(...)
  S-->>SE: ephemeral:audio-chunk events (base64 PCM16)
  SE-->>A: audio chunks (not persisted)
  A-->>U: audio playback
```

#### The key integration points in code

- **WebSocket URL + provider**: `packages/tanaki-speaks-web/src/components/TanakiClient.tsx`
  - Wraps the app in `SoulEngineProvider`.
  - Forces same-origin WS via `/ws/soul/:org/:channel` (so this works both locally and on Fly).
- **Soul connection + chat dispatch**: `packages/tanaki-speaks-web/src/hooks/useTanakiSoul.ts`
  - `useSoul({ blueprint: "tanaki-speaks", soulId: "tanaki-shared-session", debug: true, ... })`
  - Sends user text as a perception with `said("User", text)`.
  - Adds `_metadata.connectedUsers` so Tanaki can adapt to group chat.
- **WS proxy + presence**: `packages/tanaki-speaks-web/bun-server.ts`
  - `/ws/soul/:org/:channel` → proxies to `ws://127.0.0.1:4000/:org/:channel`
  - `/ws/presence` → tracks connected users for “group hangout” behavior.
- **TTS audio**: `packages/tanaki-speaks/soul/initialProcess.ts` + `packages/tanaki-speaks-web/src/components/TanakiClient.tsx`
  - The soul emits **ephemeral** audio events (chunks) while speaking.
  - The web app plays PCM16 in real-time and uses volume to drive mouth animation.

---

### Ports & endpoints (local dev)

| Component | Default | Notes |
| --- | ---: | --- |
| Web app (Bun server) | `:3002` | `bun dev` in `packages/tanaki-speaks-web` |
| Web app (Vite dev server) | `:5173` | Proxied behind `:3002` in dev |
| Soul Engine WS | `:4000` | Bun server proxies `/ws/soul/...` → here |
| Soul Engine docs | `:3001` | Started by `bun run start` (see `opensouls/README.md`) |

---

### Learn more

- **OpenSouls engine + docs + examples**: [opensouls/opensouls](https://github.com/opensouls/opensouls)
