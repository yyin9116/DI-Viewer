import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function toPort(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

async function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(startPort, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const port = startPort + i;
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + attempts - 1}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const basePort = toPort(process.env.DI_VIEWER_DEV_PORT, 17333);
  const port = await findFreePort(basePort);
  const devUrl = `http://127.0.0.1:${port}`;

  const override = {
    build: {
      beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      devUrl
    }
  };

  const tempConfigPath = path.join(
    os.tmpdir(),
    `di-viewer-tauri-dev-${process.pid}-${Date.now()}.json`
  );
  await fs.writeFile(tempConfigPath, JSON.stringify(override, null, 2), "utf8");

  console.log(`[DI-Viewer] Using dev server: ${devUrl}`);
  console.log(`[DI-Viewer] Config override: ${tempConfigPath}`);

  if (dryRun) {
    await fs.unlink(tempConfigPath);
    return;
  }

  const runner = path.join(process.cwd(), "scripts", "tauri-with-cargo.mjs");
  const child = spawn(process.execPath, [runner, "dev", "--config", tempConfigPath], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env },
    shell: false
  });

  const cleanup = async () => {
    try {
      await fs.unlink(tempConfigPath);
    } catch {
      // ignore
    }
  };

  child.on("exit", async (code, signal) => {
    await cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(`[DI-Viewer] tauri-dev-auto-port failed: ${error.message}`);
  process.exit(1);
});
