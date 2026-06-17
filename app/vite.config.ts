import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠ Quirk vite+bun : sous Bun, `bun run build` laisse `import.meta.env.DEV`
// à TRUE même en build de prod (constaté dans le bundle servi). NE PAS se fier
// à import.meta.env.DEV / PROD côté front pour distinguer dev/prod — utiliser un
// test runtime (ex. window.location.hostname). Le script "build" force
// `--mode production` par sécurité ; le garde dev-login (AuthContext) teste l'hôte.
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
