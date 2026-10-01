/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base path for GitHub Pages ("/<repo>/"). Defaults to "/" for local dev and other hosts.
function normalizeBase(raw: string | undefined): string {
  if (!raw || raw === '/') return '/'
  let base = raw.trim()
  if (!base.startsWith('/') && !base.startsWith('.')) base = `/${base}`
  if (!base.endsWith('/')) base = `${base}/`
  return base
}

const base = normalizeBase(process.env.BASE_PATH)

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new version never reloads the page by itself (it would break a workout in progress).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Training',
        short_name: 'Training',
        description: 'Scheda settimanale di calisthenics al parco: timer, contatori e diario.',
        lang: 'it',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        categories: ['health', 'fitness', 'sports'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,json,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Pinned exercise images/GIFs from other origins: keep them for offline use at the park.
            // CacheFirst keeps a good copy offline. The <img> loads are no-cors, so status 0 (opaque)
            // must be cacheable, and an opaque *error* can get cached too: MediaImage deletes the
            // entry when an image fails while online and on "Riprova", so it is fetched again.
            urlPattern: ({ request, sameOrigin }) => request.destination === 'image' && !sameOrigin,
            handler: 'CacheFirst',
            options: {
              // Must match the cache name purged in src/components/media/MediaView.tsx.
              cacheName: 'pinned-images',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
