import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    // Docker sur Windows : les événements inotify ne traversent pas le bind
    // mount -> sans polling, Vite sert du cache périmé après chaque édition.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
