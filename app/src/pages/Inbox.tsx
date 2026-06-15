// « Inbox » — live chat staff au niveau de l'ORGANISATION (page autonome, hors
// BotPage). Un sélecteur de bot (bots de l'org active où l'utilisateur a la perm
// inbox) puis le même <InboxPanel> que l'onglet Inbox de la page bot : tout le
// câblage live chat (polling/refetch 5 s, take/reply/close) vit DANS le panneau,
// on ne le touche pas. Style Chapote : carte blanche, titre Clash, sélecteur en
// pilules avec pastille « à prendre ».
import { useEffect, useMemo, useState } from 'react'
import { Building2, Inbox as InboxIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, BubbleIcon, Card, InfoBox, SectionTitle, brandBg } from '../ui'
import InboxPanel from '../components/InboxPanel'
import { BotSummary } from './BotList'

export default function Inbox() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()
  const [bots, setBots] = useState<BotSummary[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Compteur « à prendre » par bot (alimenté par onPending de l'InboxPanel monté
  // ET, pour les bots non sélectionnés, par un sondage léger au chargement).
  const [pending, setPending] = useState<Record<number, number>>({})

  const isOrgAdmin = activeOrg?.role === 'admin'

  // Bots visibles dans l'Inbox : admins/superadmins = tous ; members = ceux où
  // ils ont la perm inbox (même règle que hasPerm('inbox') de BotPage). Le
  // superadmin a role 'admin' sur les orgs qu'il possède ; sur les autres il
  // n'y a pas d'entrée /me → cette page reste org-scopée (cohérent avec Team).
  const accessibleBots = useMemo(() => {
    if (!bots || !activeOrg) return [] as BotSummary[]
    if (isOrgAdmin) return bots
    return bots.filter(b => (activeOrg.permissions[String(b.id)] || []).includes('inbox'))
  }, [bots, activeOrg, isOrgAdmin])

  useEffect(() => {
    if (!activeOrg) { setBots([]); return }
    setBots(null)
    setError('')
    setSelectedId(null)
    setPending({})
    api<BotSummary[]>(`/api/orgs/${activeOrg.id}/bots`)
      .then(setBots)
      .catch((err: any) => setError(err.message))
  }, [activeOrg?.id, retry])

  // Sélection par défaut + pré-comptage des demandes en attente sur TOUS les
  // bots accessibles (sondage léger limit=1 : on ne lit que le total). Le bot
  // sélectionné est ensuite affiné en continu par l'InboxPanel via onPending.
  useEffect(() => {
    if (accessibleBots.length === 0) return
    setSelectedId(prev => (prev && accessibleBots.some(b => b.id === prev) ? prev : accessibleBots[0].id))
    let alive = true
    accessibleBots.forEach(b => {
      api(`/api/bots/${b.id}/conversations?status=human_requested&limit=1`)
        .then((d: any) => { if (alive) setPending(p => ({ ...p, [b.id]: d.total })) })
        .catch(() => {})
    })
    return () => { alive = false }
  }, [accessibleBots])

  // ---------- États bordés ----------
  if (!activeOrg) {
    return (
      <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
        <div className="col" style={{ alignItems: 'center', gap: 10 }}>
          <Building2 size={24} style={{ color: 'var(--faint)' }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>Vous n'appartenez à aucune organisation</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 400, lineHeight: 1.55 }}>
            Rejoignez ou créez une organisation pour suivre les conversations en direct.
          </div>
          <Btn onClick={() => navigate('/app/orgs')}>Mes organisations</Btn>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <div className="col g18">
        <SectionTitle sub={`Conversations en direct de ${activeOrg.name}.`}>Inbox</SectionTitle>
        <InfoBox tone="danger" title="Impossible de charger vos chatbots">{error}</InfoBox>
        <div><Btn kind="soft" onClick={() => setRetry(n => n + 1)}>Réessayer</Btn></div>
      </div>
    )
  }

  if (bots === null) return <div className="center-page">Chargement…</div>

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
                ? `${activeOrg.name} n'a pas encore de chatbot. Créez-en un pour activer le live chat.`
                : isOrgAdmin
                  ? "Aucun de vos chatbots n'a de conversation transmise à un conseiller pour le moment."
                  : "Aucun chatbot ne vous a été confié pour la boîte de réception. Demandez la permission « Boîte de réception » à un admin de l'organisation."}
            </div>
            {bots.length === 0 && isOrgAdmin && (
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
              <div className="inbox-bot-picker" role="tablist" aria-label="Choisir un chatbot">
                {accessibleBots.map(b => {
                  const d = b.design_json || {}
                  const n = pending[b.id] || 0
                  const active = b.id === selectedId
                  return (
                    <button key={b.id} role="tab" aria-selected={active}
                            className={`inbox-bot-tab ${active ? 'active' : ''}`}
                            onClick={() => setSelectedId(b.id)}>
                      <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
                            style={{ width: 26, height: 26, background: brandBg(d), flex: '0 0 auto' }}>
                        <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 26 : 13}
                                    avatarImg={d.avatarImage} />
                      </span>
                      <span className="inbox-bot-name">{b.name}</span>
                      {n > 0 && (
                        <span className="tab-badge" role="img" aria-label={`${n} en attente`}>{n}</span>
                      )}
                    </button>
                  )
                })}
              </div>
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
