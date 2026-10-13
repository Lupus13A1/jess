import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
});
