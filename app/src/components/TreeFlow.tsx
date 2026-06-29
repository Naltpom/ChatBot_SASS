// TreeFlow — WRAPPER LÉGER de l'éditeur d'arbre de conversation. Mêmes Props
// EXACTES qu'avant ({tree, onChange, allowAI?}) : il est importé STATIQUEMENT
// par TreeTab.tsx (onglet « Arbre », vues A et B) et BotWizard.tsx (création),
// eux-mêmes dans le graphe de App.tsx -> entry-server -> pré-rendu bun.
//
// CRITIQUE : ce fichier NE DOIT PAS importer @xyflow/react (ni TreeFlowCanvas)
// statiquement. Un import statique de @xyflow/react ferait planter le pré-rendu
// de / et /showcase sous bun (accès DOM au chargement du module). Le lazy()
// garantit que @xyflow/react part dans un CHUNK DYNAMIQUE séparé, jamais chargé
// par /,/showcase. Le titre <h3> vit ici (toujours monté, hors du chunk lourd).

import { lazy, Suspense } from 'react'
import type { Tree } from '../types/bot'
import type { ModuleKey } from '../types/billing'

const TreeFlowCanvas = lazy(() => import('./tree-editor/TreeFlowCanvas'))

interface Props {
  tree: Tree
  onChange: (tree: Tree) => void
  allowAI?: boolean
  // Passe-plats OPTIONNELS (gating/onboarding) -> TreeFlowCanvas : modules
  // débloqués (badges « module requis ») et module survolé (« à élaguer »).
  activeModules?: Set<ModuleKey>
  highlightModule?: ModuleKey | null
}

export default function TreeFlow({ tree, onChange, allowAI = true, activeModules, highlightModule }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 17, margin: 0 }}>
        Arbre de conversation
      </h3>
      <Suspense
        fallback={
          <div style={{
            height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #E8ECF0', borderRadius: 14, background: '#FBFCFD',
            color: '#9AA7B4', fontSize: 13.5,
          }}>
            Chargement de l'éditeur…
          </div>
        }
      >
        <TreeFlowCanvas tree={tree} onChange={onChange} allowAI={allowAI}
                        activeModules={activeModules} highlightModule={highlightModule} />
      </Suspense>
    </div>
  )
}
