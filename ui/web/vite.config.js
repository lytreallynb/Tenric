// Build configuration for the interface's front end. The output in dist/ is
// served by ui/server/server.ts; nothing here runs in production.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500, modulePreload: { polyfill: false } },
  server: { proxy: { "/api": "http://localhost:4173" } },
});
