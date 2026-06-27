// Liste des chatbots dans la sidebar (aside) — variante « liste à plat ».
// Chaque bot pointe vers sa page, avec une pastille de statut. Alimentée par le
// MÊME endpoint que la page « Mes chatbots » (GET /api/bots via useApiResource).
// À monter dans Layout.tsx, dans la <nav> de l'espace client (!inAdmin).
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useApiResource } from '../hooks/useApiResource'
import { brandBg, orgInitials } from '../ui'
import type { BotSummary } from '../types/bot'

// Statut visuel d'un bot dans l'aside — dérivé des champs réels de BotSummary.
//   attn (ambre, clignote) : à finaliser / paiement requis / impayé.
//   paused (gris)          : désactivé manuellement (config OK).
//   online (mint)          : en ligne.
type DotKind = 'online' | 'attn' | 'paused'
const DOT_COLOR: Record<DotKind, string> = { online: '#2F9E79', attn: '#E0A82E', paused: '#C7D0DA' }
function botDot(b: BotSummary): DotKind {
  if (b.billing_status === 'inactive' || b.billing_status === 'past_due'
      || b.billing_status === 'suspended') return 'attn'
  if (!b.is_active) return b.allowed_domains.length === 0 ? 'attn' : 'paused'
  return 'online'
}

export default function BotNav() {
  const { data } = useApiResource<BotSummary[]>('/api/bots')
  const bots = data ?? []
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [query, setQuery] = useState('')

  // Recherche affichée seulement au-delà de 10 bots. Filtre sur le nom.
  const showSearch = bots.length > 10
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () => (q ? bots.filter(b => b.name.toLowerCase().includes(q)) : bots),
    [bots, q],
  )

  return (
    <div className="col" style={{ gap: 2 }}>
      {/* Intitulé de section — cliquable -> vue récap /app (au lieu d'une page imposée). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px' }}>
        <button onClick={() => navigate('/app')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                         fontSize: 10, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Mes chatbots
        </button>
        <button title="Nouveau bot" aria-label="Nouveau bot" onClick={() => navigate('/app/bots/new')}
                style={{ width: 22, height: 22, borderRadius: 7, border: 'none', background: 'var(--surface2)',
                         color: 'var(--mut)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Plus size={13} />
        </button>
      </div>

      {/* Recherche (>10 bots) */}
      {showSearch && (
        <div style={{ position: 'relative', padding: '0 4px 4px' }}>
          <Search size={13} style={{ position: 'absolute', left: 14, top: 9, color: 'var(--faint)', pointerEvents: 'none' }} />
          <input type="text" value={query} placeholder="Rechercher un bot…"
                 onChange={e => setQuery(e.target.value)}
                 style={{ width: '100%', fontFamily: 'inherit', fontSize: 12.5, padding: '7px 10px 7px 30px',
                          borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }} />
        </div>
      )}

      {/* Liste : ~5 bots visibles, puis défilement. */}
      <div className="col" style={{ gap: 2, maxHeight: 192, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)', padding: '7px 12px' }}>Aucun bot trouvé</div>
        )}
        {visible.map(b => {
          const active = pathname === `/app/bots/${b.id}`
          const dot = botDot(b)
          const d = b.design_json || {}
          return (
            <button key={b.id} onClick={() => navigate(`/app/bots/${b.id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9,
                      border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                      background: active ? 'rgba(var(--mint-rgb), .10)' : 'transparent',
                    }}>
              <span style={{
                width: 22, height: 22, borderRadius: 7, background: brandBg(d), color: '#fff', flexShrink: 0,
                display: 'grid', placeItems: 'center', fontFamily: 'var(--display)', fontWeight: 600, fontSize: 10,
                opacity: dot === 'paused' ? .7 : 1,
              }}>{orgInitials(b.name)}</span>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: active ? 700 : 600, color: active ? 'var(--acc)' : (dot === 'paused' ? 'var(--mut)' : 'var(--ink)'),
              }}>{b.name}</span>
              <span aria-hidden="true" style={{
                width: 8, height: 8, borderRadius: 99, background: DOT_COLOR[dot], flexShrink: 0,
                animation: dot === 'attn' ? 'kcAsidePulse 1.8s infinite' : 'none',
              }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
