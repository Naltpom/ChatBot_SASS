import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, /api/music/* part vers l'API locale (même origine qu'en production,
// où le nginx du conteneur `music` relaie /api/music/ vers le service `api`).
export default defineConfig({
  plugins: [react()],
  server: { port: 3002, proxy: { '/api/music': 'http://localhost:8001' } },
})
