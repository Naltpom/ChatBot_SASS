// Entrée de PRÉRENDU (référencement) : exécutée par scripts/prerender.mjs via le runtime SSR de Vite, sans
// navigateur. Même arbre que main.tsx (SessionProvider + Shell), routeur figé sur l'adresse demandée : la
// sortie est la page vue par un visiteur sans compte, identique au premier rendu du navigateur (hydratation).
// renderToPipeableStream + onAllReady attend les pages chargées à la demande (lazy) avant d'écrire : le
// flux rendu est versé par le script dans un Writable de Node (pas de types Node dans ce projet).
import { StrictMode } from 'react'
import { renderToPipeableStream, type PipeableStream } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { SessionProvider } from './session'
import { Shell } from './App'

export function render(url: string): Promise<PipeableStream> {
  return new Promise((resolve, reject) => {
    const stream = renderToPipeableStream(
      <StrictMode>
        <SessionProvider>
          <StaticRouter location={url}>
            <Shell />
          </StaticRouter>
        </SessionProvider>
      </StrictMode>,
      { onAllReady() { resolve(stream) }, onShellError: reject, onError: reject },
    )
  })
}
