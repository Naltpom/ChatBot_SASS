// « Mes chatbots » — cards Chapote + intégrations + CTA wizard.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Check, ChevronDown, Clipboard, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Btn, BubbleIcon, Card, Chip, brandBg, statusChip } from '../ui'
import { botOwnerLabel, canAccessBotPerm } from '../utils/permissions'
import { BotSummary, Integration } from '../types/bot'

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

export function BotCard({ bot, onOpen, canCopy = true, ownerLabel }: {
  bot: BotSummary; onOpen: (id: number) => void; canCopy?: boolean
  // Badge d'appartenance optionnel (« Perso » ou nom d'équipe). Omis (Admin.tsx)
  // = pas de badge.
  ownerLabel?: string
}) {
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
          <div className="col g6" style={{ alignItems: 'flex-end' }}>
            {statusChip(bot.is_active)}
            {ownerLabel && (
              <Chip tone={bot.scope === 'personal' ? 'mut' : 'acc'}>{ownerLabel}</Chip>
            )}
          </div>
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
  // Nouveau modèle : on liste TOUS mes bots (perso + équipes) via GET /api/bots.
  // Plus de dépendance à l'org active. `organizations` sert à mapper
  // organization_id → nom d'équipe pour le badge d'appartenance.
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApiResource<BotSummary[]>('/api/bots')
  const bots = data ?? []

  if (loading) return <div className="center-page">Chargement…</div>

  // Échec du chargement : ne jamais afficher l'état vide « Créez votre premier
  // chatbot » (mensonger) — message + réessayer.
  if (error) {
    return (
      <div className="col g18">
        <div className="botlist-head">
          <div>
            <h1 className="botlist-title" style={{ fontSize: 32 }}>Mes chatbots</h1>
            <p className="botlist-sub">Vos chatbots personnels et d'équipe.</p>
          </div>
        </div>
        <ErrorRetry message={error} onRetry={reload} />
      </div>
    )
  }

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
        <button className="botlist-create" onClick={() => navigate('/app/bots/new')}>
          <Plus size={17} /> Créer un bot
        </button>
      </div>

      {bots.length === 0 ? (
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
            <Btn onClick={() => navigate('/app/bots/new')}><Plus size={14} /> Créer un bot</Btn>
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
        <div className="bot-grid" style={{ gap: 22 }}>
          {bots.map(b => (
            <BotCard key={b.id} bot={b} onOpen={id => navigate(`/app/bots/${id}`)}
                     canCopy={canAccessBotPerm(user, b, 'copy')} ownerLabel={botOwnerLabel(user, b)} />
          ))}
          <button className="bot-create-cta" onClick={() => navigate('/app/bots/new')}>
            <span className="plus"><Plus size={20} /></span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Créer un bot</span>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>Configuration guidée, ~2 min</span>
          </button>
        </div>
      )}
    </div>
  )
}
