import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function splitPathList(value) {
  if (!value) return [];
  return value.split(path.delimiter).filter(Boolean);
}

function buildPathWithCargo(env) {
  const existing = splitPathList(env.PATH || env.Path || "");
  const dedup = new Set(existing.map((item) => item.toLowerCase()));

  const candidates = [];
  if (env.CARGO_HOME) {
    candidates.push(path.join(env.CARGO_HOME, "bin"));
  }
  candidates.push(path.join(os.homedir(), ".cargo", "bin"));

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const key = dir.toLowerCase();
    if (!dedup.has(key)) {
      existing.unshift(dir);
      dedup.add(key);
    }
  }
  return existing.join(path.delimiter);
}

function applyPathEnv(env, value) {
  if (process.platform !== "win32") {
    env.PATH = value;
    return;
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path" && key !== pathKey) {
      delete env[key];
    }
  }
  env[pathKey] = value;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/tauri-with-cargo.mjs <tauri args...>");
  process.exit(1);
}

function runChecked(command, commandArgs, options) {
  const result = spawn(command, commandArgs, {
    ...options,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  return new Promise((resolve, reject) => {
    result.on("error", reject);
    result.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const commandArgs = ["tauri", ...args];

const env = { ...process.env };
applyPathEnv(env, buildPathWithCargo(env));

function shellEscape(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

const fullCommand = [command, ...commandArgs.map(shellEscape)].join(" ");

try {
  await runChecked(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "prepare:tauri"], {
    cwd: process.cwd(),
    env
  });
} catch (error) {
  console.error(`[DI-Viewer] prepare:tauri failed: ${error.message}`);
  process.exit(1);
}

const child = spawn(fullCommand, [], {
  cwd: process.cwd(),
  stdio: "inherit",
  env,
  shell: true
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
