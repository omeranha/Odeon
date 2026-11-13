import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const navidromeUrl = env.NAVIDROME_URL || 'http://localhost:4533'
  const builtAt = new Date()
  // Per-build file names: an asset a CDN cached badly (e.g. an error page) can never be served for a later build.
  const buildId = builtAt.getTime().toString(36)
  const proxy: Record<string, ProxyOptions> = {
    '/rest': { target: navidromeUrl, changeOrigin: true },
    '/api': { target: env.ODEON_API_URL || 'http://localhost:3000', changeOrigin: true },
  }

  return {
    define: {
      __APP_BUILD__: JSON.stringify(builtAt.toISOString()),
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-${buildId}-[hash].js`,
          chunkFileNames: `assets/[name]-${buildId}-[hash].js`,
          assetFileNames: `assets/[name]-${buildId}-[hash][extname]`,
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        pwaAssets: { config: true, overrideManifestIcons: true },
        manifest: {
          name: 'Odeon',
          short_name: 'Odeon',
          description: 'Music player for your Navidrome library',
          theme_color: '#121212',
          background_color: '#000000',
          display: 'standalone',
          start_url: '/',
          scope: '/',
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        },
      }),
    ],
    server: { proxy },
    preview: { proxy },
  }
})
