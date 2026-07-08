import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from 'vite-plugin-web-extension'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: 'manifest.json',
      // The offscreen document (voice-note capture) isn't declared anywhere
      // in manifest.json's schema — chrome.offscreen.createDocument() just
      // takes a URL string at runtime — so it needs to be listed here
      // explicitly or the plugin never bundles it into dist/.
      additionalInputs: ['src/offscreen/index.html'],
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
