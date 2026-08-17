import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: "src/main/index.ts",
          "vdf-worker": "src/main/workers/vdf-worker.ts",
        },
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: "src/renderer/index.html",
          "design-system": "src/renderer/design-system.html",
        },
      },
    },
  },
})
