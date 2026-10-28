import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5317,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8787" },
  },
});
