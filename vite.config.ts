import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["nitralpc.tail887134.ts.net"],
    proxy: {
      "/api": "http://127.0.0.1:8780",
      "/assets": "http://127.0.0.1:8780"
    }
  }
});
