import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠ Quirk vite+bun : sous Bun, `bun run build` laisse le bundle en mode DEV
// (import.meta.env.DEV=true, NODE_ENV non-prod -> warnings React/react-router
// visibles EN PROD, code de dev non éliminé). On FORCE donc le mode prod au
// build via `define(process.env.NODE_ENV)` — indépendant du shell, c'est la clé
// que React et react-router lisent pour DCE leur code de dev. Le script "build"
// passe aussi NODE_ENV=production + --mode production (ceinture+bretelles).
// Côté front, NE PAS se fier à import.meta.env.DEV/PROD (toujours douteux sous
// bun) : utiliser un test runtime (ex. window.location.hostname, cf. l'auto-
// login dev dans AuthContext).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
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
}))
