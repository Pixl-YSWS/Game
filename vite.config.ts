import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Phaser is a single ~1.35 MB engine module that can't be split further;
    // raise the warning ceiling above it so the known vendor size is quiet,
    // while our own chunks (currently ~50 kB) still trip the warning if they
    // ever grow out of control.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Phaser alone is ~1.4 MB — almost the entire bundle. Splitting it into
        // its own vendor chunk keeps it cached across deploys (our game code
        // changes far more often than the engine) and pulls each individual
        // chunk back under Vite's 500 kB warning threshold.
        manualChunks(id: string) {
          if (id.includes("node_modules/phaser")) return "phaser";
          if (id.includes("node_modules/socket.io")) return "socketio";
        },
      },
    },
  },
});
