const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/healthz": "http://127.0.0.1:3000"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
