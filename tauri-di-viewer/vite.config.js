import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The start page must live inside the frontend dist so it is embedded into the
 * binary and served through the application protocol (http://tauri.localhost on
 * Windows). `file://` home pages cannot host the injected shell because the
 * IPC layer rejects their null origin.
 *
 * `warm.html` rides along for a different reason: a new tab is created on a
 * local placeholder document so the webview paints before it navigates to the
 * real URL (see `create_tab_webview`). It has to be in the bundle, not fetched.
 * @returns {import("vite").Plugin}
 */
function copyStartPage() {
  const pages = ["index.html", "warm.html"];
  return {
    name: "copy-lucid-start-page",
    closeBundle() {
      const outDir = resolve(__dirname, "dist", "lucid-start-page");
      mkdirSync(outDir, { recursive: true });
      for (const page of pages) {
        copyFileSync(
          resolve(__dirname, "..", "lucid-start-page", page),
          resolve(outDir, page)
        );
      }
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
