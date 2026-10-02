import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt'：新版下載好之後先等著，使用者按「立即更新」才換版。
      // 不用 autoUpdate，避免數呼吸數到一半畫面被自動重新整理。
      registerType: 'prompt',
      injectRegister: false,
      // manifest 放在 public/manifest.json（手動維護），這裡不重複產生
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,json}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
