// « Mes chatbots » — cards Chapote + intégrations + CTA wizard.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Building2, Check, ChevronDown, Clipboard, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, BubbleIcon, Card, InfoBox, brandBg, statusChip } from '../ui'

export interface BotSummary {
  id: number
  name: string
  public_key: string
  is_active: boolean
  mode: string
  ai_provider: string
  allowed_domains: string[]
  design_json: Record<string, any>
  msgs_7d: number
  visitors_7d: number
}

interface Integration { id: string; label: string; icon: string; description: string; snippet: string }

function IntegrationMenu({ botId, onCopied }: { botId: number; onCopied: () => void }) {
  const [open, setOpen] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && integrations.length === 0) {
      const data = await api(`/api/bots/${botId}/embed`)
      setIntegrations(data.integrations)
    }
    setOpen(o => !o)
  }

  function copy(integ: Integration) {
    navigator.clipboard.writeText(integ.snippet).catch(() => {})
    setOpen(false)
    onCopied()
  }

  return (
    <div ref={ref} className="integ-menu-wrap" onClick={e => e.stopPropagation()}>
      <Btn kind="ghost" small onClick={toggle}>Autres <ChevronDown size={13} /></Btn>
      {open && (
        <div className="integ-menu">
          <div className="integ-menu-title">Copier l'intégration</div>
          {integrations.map(it => (
            <button key={it.id} className="integ-item" onClick={() => copy(it)}>
              <span className="integ-ico">{it.icon}</span>
              <span className="lbl">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Pills de mode déduites du VRAI mode du bot (tree | hybrid | ai). On n'affiche
// que des capacités réelles : « Arbre » toujours, « IA » si le mode l'autorise.
// Pas de pill « Humain » fabriquée (le handoff dépend de l'arbre/des actions,
// non porté par l'objet liste — on n'invente rien).
function modePills(mode: string) {
  const pills: { label: string; cls: string }[] = []
  pills.push({ label: 'Arbre', cls: 'mp-tree' })
  if (mode === 'ai' || mode === 'hybrid') pills.push({ label: 'IA', cls: 'mp-ai' })
  return pills
}

export function BotCard({ bot, onOpen, canCopy = true }: { bot: BotSummary; onOpen: (id: number) => void; canCopy?: boolean }) {
  const [copied, setCopied] = useState(false)
  const d = bot.design_json || {}
  const initials = bot.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

  async function copyMain(e: React.MouseEvent) {
    e.stopPropagation()
    const data = await api(`/api/bots/${bot.id}/embed`)
    await navigator.clipboard.writeText(data.integrations[0].snippet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1700)
  }

  function flash() {
    setCopied(true)
    setTimeout(() => setCopied(false), 1700)
  }

  // L'avatar suit la marque du bot : image perso si design_json le prévoit,
  // sinon dégradé/couleur de marque avec initiales (visuel Chapote).
  const hasImg = d.icon === 'image' && d.avatarImage
  const customIcon = d.icon && d.icon !== 'image'

  return (
    <Card nopad className="bot-card" onClick={() => onOpen(bot.id)} style={{ overflow: 'visible' }}>
      <div className="bot-card-body">
        <div className="bot-card-head">
          <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`} style={{ background: brandBg(d) }}>
            {hasImg
              ? <BubbleIcon kind="image" size={44} avatarImg={d.avatarImage} />
              : customIcon
                ? <BubbleIcon kind={d.icon} size={20} />
                : <span className="bot-avatar-initials">{initials}</span>}
          </span>
          <div className="bot-card-id">
            <div className="bot-card-name">{bot.name}</div>
            <div className="bot-card-site">{bot.allowed_domains[0] || 'aucun domaine'}</div>
          </div>
          {statusChip(bot.is_active)}
        </div>

        <div className="bot-card-sep" />

        <div className="bot-card-stats">
          <div className="bcs-cell">
            <div className="bcs-label">Conversations · 7 j</div>
            <div className="bcs-value">{bot.visitors_7d.toLocaleString('fr-FR')}</div>
          </div>
          <div className="bcs-cell">
            <div className="bcs-label">Messages · 7 j</div>
            <div className="bcs-value mint">{bot.msgs_7d.toLocaleString('fr-FR')}</div>
          </div>
        </div>

        <div className="bot-card-modes">
          {modePills(bot.mode).map(p => (
            // Pills de mode : forme exacte du template Chapote (radius 8px,
            // padding 4/10, tint 12 %). Couleurs portées par la classe mp-*.
            <span key={p.label} className={`mode-pill ${p.cls}`}
                  style={{ borderRadius: 8, padding: '4px 10px' }}>{p.label}</span>
          ))}
          {bot.allowed_domains.length === 0 && (
            <span className="mode-pill mp-warn" style={{ borderRadius: 8, padding: '4px 10px' }}>
              <AlertTriangle size={11} /> aucun domaine
            </span>
          )}
        </div>
      </div>

      {canCopy && (
        <div className="bot-card-foot">
          <Btn kind={copied ? 'soft' : 'primary'} small onClick={copyMain} style={{ flex: 1, justifyContent: 'center' }}>
            {copied ? <><Check size={13} /> Copié !</> : <><Clipboard size={13} /> {'Copier le <script>'}</>}
          </Btn>
          <IntegrationMenu botId={bot.id} onCopied={flash} />
        </div>
      )}
    </Card>
  )
}

export default function BotList() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()
  const [bots, setBots] = useState<BotSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!activeOrg) { setLoading(false); return }
    setLoading(true)
    setError('')
    api<BotSummary[]>(`/api/orgs/${activeOrg.id}/bots`)
      .then(setBots)
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false))
  }, [activeOrg, retry])

  if (!activeOrg) {
    return (
      <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
        <div className="col" style={{ alignItems: 'center', gap: 10 }}>
          <Building2 size={24} style={{ color: 'var(--faint)' }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>Vous n'appartenez à aucune organisation</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 400, lineHeight: 1.55 }}>
            Demandez à un collègue de vous inviter, ou créez votre propre organisation pour commencer.
          </div>
          <Btn onClick={() => navigate('/app/orgs')}>Mes organisations</Btn>
        </div>
      </Card>
    )
  }
  if (loading) return <div className="center-page">Chargement…</div>

  // Échec du chargement : ne jamais afficher l'état vide « Créez votre premier
  // chatbot » (mensonger) ni un quota par défaut — message + réessayer.
  if (error) {
    return (
      <div className="col g18">
        <div className="botlist-head">
          <div>
            <h1 className="botlist-title" style={{ fontSize: 32 }}>Mes chatbots</h1>
            <p className="botlist-sub">Chatbots de {activeOrg.name}.</p>
          </div>
        </div>
        <InfoBox tone="danger" title="Impossible de charger vos chatbots">{error}</InfoBox>
        <div><Btn kind="soft" onClick={() => setRetry(n => n + 1)}>Réessayer</Btn></div>
      </div>
    )
  }

  const isAdmin = activeOrg.role === 'admin'
  const canCopyBot = (botId: number) =>
    isAdmin || (activeOrg.permissions[String(botId)] || []).includes('copy')

  // Sous-ligne : chiffres RÉELS uniquement. Conversations 7 j = somme des
  // visiteurs uniques par bot.
  const conv7d = bots.reduce((s, b) => s + (b.visitors_7d || 0), 0)
  const subParts = [`${bots.length} chatbot${bots.length > 1 ? 's' : ''}`]
  if (bots.length > 0) subParts.push(`${conv7d.toLocaleString('fr-FR')} conversation${conv7d > 1 ? 's' : ''} sur 7 j`)

  return (
    <div className="col g18">
      <div className="botlist-head">
        <div>
          <h1 className="botlist-title">Mes chatbots</h1>
          <p className="botlist-sub">{subParts.join(' · ')}</p>
        </div>
        {isAdmin && (
          <button className="botlist-create" onClick={() => navigate('/app/bots/new')}>
            <Plus size={17} /> Créer un bot
          </button>
        )}
      </div>

      {bots.length === 0 ? (
        isAdmin ? (
          <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
            <div className="col" style={{ alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 54, height: 54, borderRadius: 99, background: 'var(--acc-soft)',
                border: '1px solid var(--acc-bd)', color: 'var(--mint)', display: 'grid', placeItems: 'center',
              }}>
                <Bot size={28} />
              </span>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Créez votre premier chatbot</div>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 380, lineHeight: 1.55 }}>
                Wizard guidé : arbre, IA ou hybride — en ligne en 2 minutes.
              </div>
              <Btn onClick={() => navigate('/app/bots/new')}><Plus size={14} /> Créer un chatbot</Btn>
              <div className="row" style={{ gap: 22, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                {['Configurez', 'Collez la balise', 'Suivez les stats'].map((s, i) => (
                  <span key={s} className="row g8">
                    <span className="timeline-num">{i + 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>{s}</span>
                  </span>
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <Card style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--faint)', fontSize: 12.5 }}>
            Aucun chatbot pour l'instant — un admin de {activeOrg.name} doit le créer.
          </Card>
        )
      ) : (
        <div className="bot-grid" style={{ gap: 22 }}>
          {bots.map(b => (
            <BotCard key={b.id} bot={b} onOpen={id => navigate(`/app/bots/${id}`)} canCopy={canCopyBot(b.id)} />
          ))}
          {isAdmin && (
            <button className="bot-create-cta" onClick={() => navigate('/app/bots/new')}>
              <span className="plus"><Plus size={20} /></span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Créer un bot</span>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>Configuration guidée, ~2 min</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
