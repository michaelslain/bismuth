import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

  // Harper ships a large WASM blob it loads itself; let Vite serve it as-is rather than
  // pre-bundling through esbuild (which mangles the inlined worker + WASM path resolution).
  // NOTE: transformers.js must NOT be excluded — unlike Harper it relies on Vite's normal
  // dep pre-bundling, and excluding it makes the dev server hang serving its unbundled
  // module graph (the onnxruntime-web import never resolves).
  optimizeDeps: { exclude: ["harper.js"] },

  // Peel heavy, non-boot vendors into their own named chunks so the entry stays
  // small and they load only when their feature is first used (graph, terminal,
  // PDF export, math). `marked` shares a chunk so it's deduped across importers.
  build: {
    rollupOptions: {
      output: {
        // Function-form so we can pin Vite's shared `__vitePreload` helper into its
        // own tiny chunk. Otherwise Rollup hoists the helper into whichever vendor
        // chunk it lands in (it ended up in `exportpdf`), and because the entry needs
        // the helper it then statically imports that whole chunk — dragging
        // jspdf+html2canvas (~175 KB gz) into boot even though ExportView is lazy.
        manualChunks(id: string) {
          if (id.includes("vite/preload-helper") || id.includes("vite/modulepreload"))
            return "vite";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "exportpdf";
          // AI-text detector (transformers.js + onnxruntime-web): heavy + only used when the
          // "Detect AI" command runs, so keep it in its own lazy chunk out of the boot path.
          if (id.includes("@huggingface/transformers") || id.includes("onnxruntime")) return "transformers";
          // pdfjs-dist (PDF markup rasterizer): only pulled in when a PDF is opened for markup,
          // so keep it in its own lazy chunk off the boot path. The worker is a separate `?url`
          // asset, so it stays out of this chunk regardless.
          if (id.includes("pdfjs-dist")) return "pdfjs";
          if (id.includes("/three/") || id.includes("d3-force-3d")) return "three";
          if (id.includes("@xterm/")) return "xterm";
          if (id.includes("/katex/")) return "katex";
          if (id.includes("/marked/")) return "marked";
          // NOTE: intentionally NO codemirror rule. FileView/Editor are now lazy, so
          // Rollup auto-splits CodeMirror into its own chunk that loads on first note
          // open. Forcing all @codemirror/@lezer into one manual chunk would also pull
          // in @codemirror/language-data's per-language grammars (normally dynamically
          // imported on demand), bloating the editor chunk ~5×. Let Rollup keep those
          // grammar modules as separate lazy chunks.
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
