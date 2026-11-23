import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, /api/* part vers l'API locale (même origine qu'en production, où le nginx
// du conteneur `cm` relaie /api/cm/, /api/tiktok/, /api/youtube/ et /api/auth/ vers `api`).
export default defineConfig({
  plugins: [react()],
  server: { port: 3003, proxy: { '/api': 'http://localhost:8001' } },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // React et le routeur changent rarement : un fichier à part, gardé en cache d'un déploiement à l'autre.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
