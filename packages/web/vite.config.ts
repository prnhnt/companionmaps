import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // MapLibre is most of the bundle and the join screen does not need
        // it, so it gets its own chunk rather than blocking first paint.
        manualChunks: { maplibre: ["maplibre-gl"] },
      },
    },
  },
  // The shared package is published as TypeScript source, so Vite has to
  // compile it rather than treat it as a pre-built dependency.
  optimizeDeps: { exclude: ["@companionmaps/shared"] },
});
