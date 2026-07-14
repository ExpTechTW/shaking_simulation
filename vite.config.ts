import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
// GitHub Pages（專案頁）serves at /shaking_simulation/；dev 仍走根路徑 /
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/shaking_simulation/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))
