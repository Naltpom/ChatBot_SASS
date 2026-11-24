import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, les routes servies par l'API partent vers l'API locale (même origine qu'en production, où le
// nginx du conteneur `emails` relaie /api/emails/, /api/auth/…, /mcp, /oauth/ et /.well-known/oauth-*).
const api = 'http://localhost:8001'
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3004,
    proxy: { '/api': api, '/oauth': api, '/mcp': api, '/.well-known/oauth-protected-resource': api, '/.well-known/oauth-authorization-server': api },
  },
  build: {
    target: 'es2020',
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] } } },
  },
})
