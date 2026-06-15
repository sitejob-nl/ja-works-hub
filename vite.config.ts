import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name: "SiteJob — Uitzend Software",
        short_name: "SiteJob",
        description: "SiteJob Uitzend software voor uitzendbureaus",
        theme_color: "#0a1628",
        background_color: "#f5f7fa",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor libs into their own chunks so they
        // cache independently and stay off the critical path. Combined with the
        // route-level lazy() imports in App.tsx, this keeps the initial bundle small.
        // Function form (matches resolved module ids by substring) is used instead of
        // the object form so packages that only expose subpath exports — e.g.
        // read-excel-file — don't trigger root-entry resolution failures.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("pdfjs-dist") || id.includes("tesseract.js")) return "pdf-ocr";
          if (
            id.includes("papaparse") ||
            id.includes("read-excel-file") ||
            id.includes("write-excel-file")
          ) return "spreadsheet";
          if (id.includes("recharts")) return "charts";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "editor";
          if (id.includes("html2pdf")) return "pdf-export";
        },
      },
    },
  },
}));
