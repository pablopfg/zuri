import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { releaseNotes } from "./src/lib/release-notes.ts";

// "Novidades desta versão" (Settings > Sobre a Zuri): the newest section of CHANGELOG.md, read
// once at build time as plain text. Only the About section references it.
const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __RELEASE_NOTES__: JSON.stringify(releaseNotes(changelog)) },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
