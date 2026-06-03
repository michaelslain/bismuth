import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

  // Harper ships a large WASM blob it loads itself; let Vite serve it as-is
  // rather than attempting to pre-bundle it through esbuild (which mangles the
  // inlined worker + WASM path resolution).
  optimizeDeps: { exclude: ["harper.js"] },

  // Peel heavy, non-boot vendors into their own named chunks so the entry stays
  // small and they load only when their feature is first used (graph, terminal,
  // PDF export, math). `marked` shares a chunk so it's deduped across importers.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "d3-force-3d"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          exportpdf: ["jspdf", "html2canvas"],
          codemirror: ["codemirror"],
          katex: ["katex"],
          marked: ["marked"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
