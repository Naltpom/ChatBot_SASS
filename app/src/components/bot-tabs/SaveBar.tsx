// Save bar SOMBRE de l'éditeur de bot — fixée en bas
// (left:248px en desktop, left:0 en mobile/drawer). role="status" : pills des
// onglets dirty (cliquables -> switchTab), Annuler/Enregistrer + indication
// Ctrl/Cmd S. Présentationnel : tout l'état (dirty/saved/error, dirtyTabs) et les
// handlers (save/cancelChanges/switchTab) viennent de BotPage via useBotEditor.
// La pastille .tab-dot par onglet vit dans la barre d'onglets (.tabs), pas ici.
import { Check } from 'lucide-react'

interface TabDef { id: string; label: string }

export default function SaveBar({
  saveBarRef, isMobile, dirty, saved, error,
  dirtyTabs, visibleTabs, switchTab, cancelChanges, save,
}: {
  saveBarRef: React.RefObject<HTMLDivElement>
  isMobile: boolean
  dirty: boolean
  saved: boolean
  error: string
  dirtyTabs: string[]
  visibleTabs: TabDef[]
  switchTab: (t: string) => void
  cancelChanges: () => void
  save: () => void
}) {
  return (
    <div role="status" ref={saveBarRef} style={{
      // En mobile (<=860px) la sidebar est un drawer off-canvas : la barre
      // doit couvrir toute la largeur (left:0). En desktop elle reste alignée
      // sur la sidebar fixe de 248px.
      position: 'fixed', left: isMobile ? 0 : 248, right: 0, bottom: 0, zIndex: 90,
      background: '#1E2A32', color: '#fff',
      boxShadow: '0 -12px 32px -14px rgba(0,0,0,.4)',
    }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: isMobile ? '11px 14px' : '13px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 10 : 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0, fontSize: 13.5 }}>
          {error ? (
            <span style={{ color: '#FFB4AC', fontWeight: 700 }}>{error}</span>
          ) : dirty ? (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: '#E0A82E', display: 'inline-block', flexShrink: 0 }} />
                Modifications non enregistrées
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {dirtyTabs.map(t => {
                  const def = visibleTabs.find(x => x.id === t)
                  if (!def) return null
                  return (
                    <button key={t} onClick={() => switchTab(t)} style={{
                      background: 'rgba(255,255,255,.1)', color: '#fff', border: 'none',
                      borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>{def.label}</button>
                  )
                })}
              </div>
            </>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#7FE3BE' }}>
              <Check size={16} /> Enregistré
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#7FA0B5', whiteSpace: 'nowrap' }}>Ctrl/Cmd S pour enregistrer</span>
          {dirty && (
            <button onClick={cancelChanges} style={{
              background: 'transparent', color: '#D6E2EA', border: '1px solid rgba(255,255,255,.22)',
              borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            }}>Annuler</button>
          )}
          <button onClick={save} disabled={!dirty && !saved} style={{
            background: dirty ? '#2F9E79' : 'rgba(255,255,255,.15)', color: '#fff', border: 'none',
            borderRadius: 10, padding: '10px 20px', fontWeight: 600, fontSize: 14,
            cursor: dirty ? 'pointer' : 'default', fontFamily: 'inherit',
          }}>{saved ? 'Enregistré' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
