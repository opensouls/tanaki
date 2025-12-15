import { spawn } from "bun";

function waitForExit(...procs: Array<ReturnType<typeof spawn>>) {
  return Promise.race(
    procs.map(
      (p) =>
        p.exited.then((code) => {
          throw new Error(`process exited with code ${code}`);
        }),
    ),
  );
}

function killAll(...procs: Array<ReturnType<typeof spawn>>) {
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

const vitePort = Number.parseInt(process.env.VITE_PORT || "5173", 10);
const bunPort = Number.parseInt(process.env.PORT || "3002", 10);
const viteUrl = process.env.VITE_DEV_SERVER_URL || `http://127.0.0.1:${vitePort}`;

console.log(`[dev] starting vite on :${vitePort}`);
const vite = spawn(["bun", "run", "dev:ui"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: { ...process.env, VITE_PORT: String(vitePort) },
});

console.log(`[dev] starting bun proxy on :${bunPort} -> ${viteUrl}`);
const bunServer = spawn(["bun", "run", "dev:server"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    DEV: process.env.DEV || "1",
    PORT: String(bunPort),
    VITE_DEV_SERVER_URL: viteUrl,
  },
});

const shutdown = () => {
  console.log("\n[dev] shutting down...");
  killAll(bunServer, vite);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await waitForExit(vite, bunServer);
} finally {
  shutdown();
}


