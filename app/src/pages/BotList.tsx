// « Mes chatbots » — cards + intégrations + CTA wizard (pages-bots-list.jsx).
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Building2, Check, ChevronDown, ChevronRight, Clipboard, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, BubbleIcon, Card, Chip, InfoBox, SectionTitle, brandBg, modeChip, statusChip } from '../ui'
import { PLAN_LABELS } from '../botConstants'

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

export function BotCard({ bot, onOpen, canCopy = true }: { bot: BotSummary; onOpen: (id: number) => void; canCopy?: boolean }) {
  const [copied, setCopied] = useState(false)
  const d = bot.design_json || {}

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

  return (
    <Card nopad className="bot-card" onClick={() => onOpen(bot.id)} style={{ overflow: 'visible' }}>
      <div className="bot-card-body">
        <div className="bot-card-head">
          <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
                style={{ width: 40, height: 40, background: brandBg(d) }}>
            <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 40 : 19} avatarImg={d.avatarImage} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bot-card-name">{bot.name}</div>
            <div className="bot-card-site">{bot.allowed_domains[0] || 'aucun domaine'}</div>
          </div>
          {statusChip(bot.is_active)}
          <ChevronRight size={14} className="open-hint" aria-hidden="true" />
        </div>
        <div className="bot-card-chips">
          {modeChip(bot.mode)}
          <Chip tone="mut">{bot.msgs_7d.toLocaleString('fr-FR')} msg / 7 j</Chip>
          <Chip tone="mut">{bot.visitors_7d.toLocaleString('fr-FR')} visiteurs</Chip>
          {bot.allowed_domains.length === 0 && <Chip tone="warn"><AlertTriangle size={11} /> aucun domaine</Chip>}
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
  const [quota, setQuota] = useState({ bots_quota: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!activeOrg) { setLoading(false); return }
    setLoading(true)
    setError('')
    Promise.all([
      api<BotSummary[]>(`/api/orgs/${activeOrg.id}/bots`),
      api(`/api/orgs/${activeOrg.id}/usage`),
    ]).then(([b, u]) => { setBots(b); setQuota(u) })
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
        <SectionTitle sub={`Chatbots de ${activeOrg.name}.`}>Mes chatbots</SectionTitle>
        <InfoBox tone="danger" title="Impossible de charger vos chatbots">{error}</InfoBox>
        <div><Btn kind="soft" onClick={() => setRetry(n => n + 1)}>Réessayer</Btn></div>
      </div>
    )
  }

  const atLimit = bots.length >= quota.bots_quota
  const planLabel = PLAN_LABELS[activeOrg.plan] || activeOrg.plan
  const isAdmin = activeOrg.role === 'admin'
  const canCopyBot = (botId: number) =>
    isAdmin || (activeOrg.permissions[String(botId)] || []).includes('copy')

  return (
    <div className="col g18">
      <SectionTitle
        sub={`${bots.length} chatbot${bots.length > 1 ? 's' : ''} sur ${quota.bots_quota} inclus dans le plan ${planLabel}.`}
        right={isAdmin
          ? <Btn onClick={() => navigate('/app/bots/new')} disabled={atLimit}><Plus size={14} /> Créer un chatbot</Btn>
          : undefined}>
        Mes chatbots
      </SectionTitle>

      {isAdmin && atLimit && (
        <InfoBox tone="warn" title="Limite du plan atteinte">
          Le plan {planLabel} inclut {quota.bots_quota} bot{quota.bots_quota > 1 ? 's' : ''}. Passez au plan supérieur pour en ajouter.
        </InfoBox>
      )}

      {bots.length === 0 ? (
        isAdmin ? (
          <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
            <div className="col" style={{ alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 54, height: 54, borderRadius: 99, background: 'var(--acc-soft)',
                border: '1px solid var(--acc-bd)', color: 'var(--acc)', display: 'grid', placeItems: 'center',
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
        <div className="bot-grid">
          {bots.map(b => (
            <BotCard key={b.id} bot={b} onOpen={id => navigate(`/app/bots/${id}`)} canCopy={canCopyBot(b.id)} />
          ))}
          {isAdmin && !atLimit && (
            <button className="bot-create-cta" onClick={() => navigate('/app/bots/new')}>
              <span className="plus"><Plus size={18} /></span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Ajouter un chatbot</span>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>Configuration guidée, ~2 min</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
