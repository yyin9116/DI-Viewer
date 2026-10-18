import { defineConfig, type Plugin } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The start page must live inside the frontend dist so it is embedded into the
 * binary and served through the application protocol (http://tauri.localhost on
 * Windows). `file://` home pages cannot host the injected shell because the
 * IPC layer rejects their null origin.
 */
function copyStartPage(): Plugin {
  return {
    name: "copy-lucid-start-page",
    closeBundle() {
      const outDir = resolve(__dirname, "dist", "lucid-start-page");
      mkdirSync(outDir, { recursive: true });
      copyFileSync(
        resolve(__dirname, "..", "lucid-start-page", "index.html"),
        resolve(outDir, "index.html")
      );
    }
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [copyStartPage()],
  server: {
    port: 5173,
    strictPort: true
  }
});
