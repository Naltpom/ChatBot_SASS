// « Inbox » — live chat staff transverse à TOUS mes bots (perso + équipes), page
// autonome hors BotPage. Un sélecteur de bot (ceux où j'ai accès au live chat)
// puis le même <InboxPanel> que l'onglet Inbox de la page bot : tout le câblage
// live chat (polling/refetch 5 s, take/reply/close) vit DANS le panneau, on ne
// le touche pas. Style Chapote : carte blanche, titre Clash, sélecteur en
// pilules avec pastille « à prendre ».
import { useEffect, useMemo, useState } from 'react'
import { Inbox as InboxIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Btn, Card, SectionTitle } from '../ui'
import InboxPanel from '../components/InboxPanel'
import BotSelector from '../components/BotSelector'
import { canAccessBotPerm } from '../utils/permissions'
import { BotSummary } from '../types/bot'

export default function Inbox() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // Liste de TOUS mes bots — perso + équipes (même endpoint que BotList).
  const { data: bots, loading, error, reload } = useApiResource<BotSummary[]>('/api/bots')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Compteur « à prendre » par bot (alimenté par onPending de l'InboxPanel monté
  // ET, pour les bots non sélectionnés, par un sondage léger au chargement).
  const [pending, setPending] = useState<Record<number, number>>({})

  // Bots visibles dans l'Inbox, sur TOUS mes bots (perso + équipes) :
  // - superadmin : tous ; bot perso : son propriétaire (tous droits) ;
  // - bot d'équipe : admin de l'équipe, ou member avec la perm 'inbox'
  //   (même règle que hasPerm('inbox') de BotPage).
  const accessibleBots = useMemo(() => {
    if (!bots || !user) return [] as BotSummary[]
    if (user.is_superadmin) return bots
    return bots.filter(b => canAccessBotPerm(user, b, 'inbox'))
  }, [bots, user])

  // Sélection par défaut + pré-comptage des demandes en attente sur TOUS les
  // bots accessibles (sondage léger limit=1 : on ne lit que le total). Le bot
  // sélectionné est ensuite affiné en continu par l'InboxPanel via onPending.
  // On repart d'un pending vierge à chaque (re)chargement de la liste pour ne
  // pas conserver le compteur d'un bot qui aurait disparu.
  useEffect(() => {
    if (accessibleBots.length === 0) return
    setSelectedId(prev => (prev && accessibleBots.some(b => b.id === prev) ? prev : accessibleBots[0].id))
    setPending({})
    let alive = true
    accessibleBots.forEach(b => {
      api(`/api/bots/${b.id}/conversations?status=human_requested&limit=1`)
        .then((d: { total: number }) => { if (alive) setPending(p => ({ ...p, [b.id]: d.total })) })
        .catch(() => {})
    })
    return () => { alive = false }
  }, [accessibleBots])

  // ---------- États bordés ----------
  if (error) {
    return (
      <div className="col g18">
        <SectionTitle sub="Conversations en direct de vos chatbots.">Inbox</SectionTitle>
        <ErrorRetry message={error} onRetry={reload} />
      </div>
    )
  }

  if (loading || bots === null) return <div className="center-page">Chargement…</div>

  const totalPending = accessibleBots.reduce((s, b) => s + (pending[b.id] || 0), 0)

  return (
    <div className="col g18">
      <SectionTitle
        sub={`Live chat — prenez la main sur les conversations transmises à un conseiller${
          totalPending > 0 ? ` · ${totalPending} en attente` : ''}.`}>
        Inbox
      </SectionTitle>

      {accessibleBots.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div className="col" style={{ alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 54, height: 54, borderRadius: 99, background: 'var(--acc-soft)',
              border: '1px solid var(--acc-bd)', color: 'var(--acc)', display: 'grid', placeItems: 'center',
            }}>
              <InboxIcon size={26} />
            </span>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Aucune conversation à suivre</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 420, lineHeight: 1.55 }}>
              {bots.length === 0
                ? "Vous n'avez pas encore de chatbot. Créez-en un pour activer le live chat."
                : "Aucun de vos chatbots n'a de conversation transmise à un conseiller, ou la permission « Boîte de réception » ne vous a pas été accordée sur ces bots."}
            </div>
            {bots.length === 0 && (
              <Btn onClick={() => navigate('/app/bots/new')}>Créer un chatbot</Btn>
            )}
          </div>
        </Card>
      ) : (
        <>
          {/* Sélecteur de bot : pilules avec avatar de marque + pastille « à
              prendre ». Masqué s'il n'y a qu'un seul bot accessible. */}
          {accessibleBots.length > 1 && (
            <Card nopad>
              <BotSelector bots={accessibleBots} selectedId={selectedId}
                           onSelect={setSelectedId} pending={pending} />
            </Card>
          )}

          {/* InboxPanel : intégralité du live chat (mêmes props que BotPage).
              key={selectedId} = remontage propre du polling au changement de bot.
              onPending alimente la pastille du bot courant. */}
          {selectedId !== null && (
            <InboxPanel key={selectedId} botId={selectedId}
                        onPending={n => setPending(p => ({ ...p, [selectedId]: n }))} />
          )}
        </>
      )}
    </div>
  )
}
