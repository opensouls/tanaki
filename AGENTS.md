# Tanaki Open Souls

This repository contains the **Tanaki** soul—a conversational AI character built on the [Open Souls](https://opensouls.org) Soul Engine—along with a web frontend that renders a 3D avatar with real-time text-to-speech audio.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TANAKI SYSTEM                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────┐       ┌─────────────────────┐       ┌───────────────┐ │
│  │   tanaki-speaks/    │       │   Soul Engine       │       │  tanaki-      │ │
│  │   soul/             │◀─────▶│   (Local or Cloud)  │◀─────▶│  speaks-web/  │ │
│  │                     │       │                     │       │               │ │
│  │  - soul.ts          │ sync  │  - Bundles code     │  WS   │  - 3D Avatar  │ │
│  │  - initialProcess   │──────▶│  - Runs sandbox     │◀─────▶│  - TTS Audio  │ │
│  │  - cognitiveSteps/  │       │  - YJS persistence  │       │  - React UI   │ │
│  │  - staticMemories/  │       │                     │       │               │ │
│  └─────────────────────┘       └─────────────────────┘       └───────────────┘ │
│                                                                                 │
│  Documentation: opensouls/packages/beta-docs/ (44 MDX files)                   │
│  React Helpers: opensouls/packages/react/ (SoulEngineProvider, hooks)          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

| Package | Purpose |
|---------|---------|
| `packages/tanaki-speaks/` | Soul blueprint code that runs in the Soul Engine |
| `packages/tanaki-speaks-web/` | TanStack Start frontend with 3D rendering and TTS streaming |
| `opensouls/packages/beta-docs/` | Comprehensive MDX documentation for the Soul Engine |
| `opensouls/packages/react/` | React components for connecting to a local or cloud Soul Engine |

---

## Understanding the Soul Engine

The Soul Engine is the runtime that executes "soul code"—TypeScript that defines an AI character's cognition, personality, and behavior. Extensive documentation lives in:

```
opensouls/packages/beta-docs/pages/
├── architecture.mdx          # How the engine works
├── blueprints.mdx            # Soul blueprint structure
├── blueprints/
│   ├── mental-processes.mdx  # Main cognitive loop
│   ├── subprocesses.mdx      # Background processes
│   ├── hooks.mdx             # useSoulMemory, useActions, etc.
│   └── hooks/*.mdx           # Individual hook documentation
├── core/
│   ├── cognitive-step.mdx    # Building cognitive steps
│   └── working-memory.mdx    # Memory manipulation
└── getting-started/
    └── connect-external-app.mdx  # Integrating with external apps
```

Key concepts:

- **Mental Processes** – The main "thought loop" triggered by perceptions (user messages, events)
- **Cognitive Steps** – Reusable functions like `externalDialog`, `internalMonologue`
- **Working Memory** – The context window the soul reasons over
- **Hooks** – `useActions()`, `useSoulMemory()`, `useSoulStore()` for state and actions

---

## Tanaki Soul Code

Location: `packages/tanaki-speaks/soul/`

```
soul/
├── soul.ts                  # Soul definition (name, static memories)
├── initialProcess.ts        # Entry point mental process
├── cognitiveSteps/
│   ├── externalDialog.ts    # Generates spoken responses
│   └── internalMonologue.ts # Internal reasoning
├── staticMemories/
│   └── core.md              # Tanaki's personality and context
└── subprocesses/
    └── summarizeConversation.ts  # Background conversation summary
```

### Soul Definition

```typescript
// soul/soul.ts
import { Soul, load } from "@opensouls/engine";

const soul: Soul = {
  name: "Tanaki",
  staticMemories: {
    core: load("./staticMemories/core.md")
  }
}

export default soul
```

### Initial Process

```typescript
// soul/initialProcess.ts
import { MentalProcess, useActions } from "@opensouls/engine";
import externalDialog from "./cognitiveSteps/externalDialog.ts";

const initialProcess: MentalProcess = async ({ workingMemory }) => {
  const { speak } = useActions()

  const [withDialog, stream] = await externalDialog(
    workingMemory,
    "Talk to the user trying to gain trust and learn about their inner world.",
    { stream: true, model: "quality" }
  );
  speak(stream);

  return withDialog;
}

export default initialProcess
```

### Personality

```markdown
<!-- soul/staticMemories/core.md -->
You are modeling the mind of Tanaki.

## Conversational Scene
Tanaki is a little bit on edge, trying to understand the interlocutor.

## Tanaki's Speaking Style
* Tanaki speaks very informally, mostly lowercase.
* Lots of gen-z slang.
* Tanaki texts MAX 1-2 sentences at a time
```

---

## React Integration

Location: `opensouls/packages/react/`

The `@opensouls/react` package provides React components to connect your frontend to a Soul Engine instance:

```typescript
import { SoulEngineProvider } from '@opensouls/react';

function App() {
  return (
    <SoulEngineProvider
      organization="your-org"
      local={true}  // Connect to local soul-engine
    >
      <YourChatComponent />
    </SoulEngineProvider>
  );
}
```

Key exports:
- `SoulEngineProvider` – Context provider for soul connections
- `SharedContextProvider` – Shared context across multiple souls
- `SoulsProvider` – Manages multiple soul instances

The provider handles WebSocket connections via HocusPocus for real-time sync with the Soul Engine.

---

## Web Frontend (tanaki-speaks-web)

Location: `packages/tanaki-speaks-web/`

A TanStack Start application that:

1. **Renders a 3D avatar** using React Three Fiber
2. **Streams TTS audio** from server-side text-to-speech
3. **Connects to the Soul Engine** for conversation

### Tech Stack

- **TanStack Start** – Full-stack React framework with SSR
- **React Three Fiber** – 3D rendering (`reference-only/components/3d/`)
- **Nitro** – Server-side functions for TTS generation
- **Tailwind CSS** – Styling

### Architecture

```
Client                          Server (TanStack Start + Nitro)
──────                          ─────────────────────────────────
                                
┌──────────────┐                ┌──────────────────────────────┐
│   3D Scene   │                │  TTS Generation              │
│   (GLB Model)│                │  - Receives text from Soul   │
│              │                │  - Generates audio bytes     │
│   Audio      │◀── PCM bytes ──│  - Streams PCM16 to client   │
│   Playback   │                │                              │
│              │                │  Soul Engine Connection      │
│   React UI   │── WebSocket ──▶│  - Forwards perceptions      │
└──────────────┘                └──────────────────────────────┘
```

### Audio Flow

The `TanakiAudio` component (see `reference-only/components/tanakiAudio.tsx`):

1. Creates an `AudioContext` at 24kHz sample rate
2. Subscribes to `hostAudio` events (server → client)
3. Converts base64-encoded PCM16 audio to Float32
4. Schedules audio buffers for gapless playback
5. Analyzes audio volume to drive mouth blend shapes on the 3D model

### 3D Model

The GLB model (`public/tanaki-animation.glb`) includes:
- Idle floating animation
- Phoneme blend shapes for lip sync
- Custom procedural gradient materials

---

## Development Workflow

### 1. Run the Soul Engine locally

```bash
cd packages/tanaki-speaks
bunx soul-engine dev
```

This syncs the soul code and opens the debugger UI.

### 2. Run the web frontend

```bash
cd packages/tanaki-speaks-web
bun install
bun run dev
```

### 3. Test in browser

The frontend connects to the local Soul Engine. Speak to Tanaki and watch the 3D avatar respond with lip-synced audio.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SOUL_ENGINE_ORGANIZATION` | Your Soul Engine org ID |
| `SOUL_ENGINE_BLUEPRINT` | Blueprint name (e.g., `tanaki-speaks`) |
| TTS provider keys | Depends on your TTS integration |

---

## Key Documentation References

For deeper understanding, read these MDX docs in `opensouls/packages/beta-docs/pages/`:

| Topic | File |
|-------|------|
| System architecture | `architecture.mdx` |
| Soul blueprints | `blueprints.mdx` |
| Mental processes | `blueprints/mental-processes.mdx` |
| Available hooks | `blueprints/hooks.mdx` |
| Cognitive steps | `core/cognitive-step.mdx` |
| Working memory | `core/working-memory.mdx` |
| External app integration | `getting-started/connect-external-app.mdx` |

---

## Style Guidelines

- **Runtime**: Bun only (`bun install`, `bun run`, `bun test`)
- **TypeScript**: Strict mode, explicit types
- **Imports**: ESM style, no `require()`
- **Formatting**: 2-space indent
- **Naming**: camelCase for functions/variables, PascalCase for React components

