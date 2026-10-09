import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "../Server/src/shared") },
  },
  server: {
    port: 5173,
    // In dev, the React app talks to the Node server through this proxy (same origin, no CORS).
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/api": { target: "http://localhost:3000" },
    },
    fs: { allow: [".."] },
  },
  build: { outDir: "dist", sourcemap: false },
});
