import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, /api/* part vers l'API locale (même origine qu'en production, où le nginx
// du conteneur `cm` relaie /api/cm/, /api/tiktok/, /api/youtube/ et /api/auth/ vers `api`).
// `npm run build` fait aussi un build SSR (src/prerender.tsx → dist-ssr/) pour pré-rendre les pages
// publiques (scripts/prerender.mjs) ; le manifeste du build client lui donne les CSS de chaque page.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  server: { port: 3003, proxy: { '/api': 'http://localhost:8001' } },
  build: isSsrBuild
    ? { target: 'node18', outDir: 'dist-ssr', emptyOutDir: true }
    : {
        target: 'es2020',
        cssCodeSplit: true,
        manifest: true,
        rollupOptions: {
          output: {
            // React et le routeur changent rarement : un fichier à part, gardé en cache d'un déploiement à l'autre.
            manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
          },
        },
      },
}))
