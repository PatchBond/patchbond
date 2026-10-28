import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5317,
    // /setup is the operator's one-click GitHub App creation, served by the API.
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8787", "/setup": process.env.API_URL ?? "http://localhost:8787" },
  },
});
