import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from 'vite-plugin-web-extension'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: 'manifest.json',
      // Neither the offscreen document nor the mic-permission tab (both part
      // of voice-note capture) are declared anywhere in manifest.json's
      // schema — chrome.offscreen.createDocument() and chrome.tabs.create()
      // just take URL strings at runtime — so both need to be listed here
      // explicitly or the plugin never bundles them into dist/.
      additionalInputs: ['src/offscreen/index.html', 'src/permission/index.html'],
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
