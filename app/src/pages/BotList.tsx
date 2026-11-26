// « Mes chatbots » — cards Chapote + intégrations + CTA wizard.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Check, ChevronDown, Clipboard, Plus } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Btn, BubbleIcon, Card, Chip, billingChip, brandBg, orgInitials, statusChip } from '../ui'
import { botOwnerLabel, canAccessBotPerm, botsInSpace } from '../utils/permissions'
import { BotSummary, Integration } from '../types/bot'

// Copie presse-papiers ROBUSTE : navigator.clipboard peut être absent (contexte
// non sécurisé : http://, certains iframes) ou rejeter (permission refusée). On
// renvoie un booléen de SUCCÈS réel — l'UI ne doit afficher « Copié ! » qu'en cas
// de vraie réussite — avec repli execCommand pour les contextes non sécurisés.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* permission/contexte refusé → on tente le repli execCommand ci-dessous */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function IntegrationMenu({ botId, onCopied }: { botId: number; onCopied: (ok: boolean) => void }) {
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
      // Échec réseau : on n'ouvre pas un menu vide silencieux ; on relaie l'échec
      // via le même feedback que la copie (l'utilisateur peut réessayer).
      try {
        const data = await api(`/api/bots/${botId}/embed`)
        setIntegrations(data.integrations)
      } catch {
        onCopied(false)
        return
      }
    }
    setOpen(o => !o)
  }

  async function copy(integ: Integration) {
    const ok = await copyToClipboard(integ.snippet)
    setOpen(false)
    onCopied(ok)
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
  const [copyFail, setCopyFail] = useState(false)
  const d = bot.design_json || {}
  const initials = orgInitials(bot.name)

  function flashOk() {
    setCopyFail(false)
    setCopied(true)
    setTimeout(() => setCopied(false), 1700)
  }
  function flashFail() {
    setCopied(false)
    setCopyFail(true)
    setTimeout(() => setCopyFail(false), 2200)
  }

  async function copyMain(e: React.MouseEvent) {
    e.stopPropagation()
    // « Copié ! » UNIQUEMENT en cas de succès réel : la récupération de la balise
    // (réseau) comme l'écriture presse-papiers peuvent échouer → feedback d'échec.
    try {
      const data = await api(`/api/bots/${bot.id}/embed`)
      const ok = await copyToClipboard(data.integrations[0].snippet)
      if (ok) flashOk()
      else flashFail()
    } catch {
      flashFail()
    }
  }

  function flash(ok: boolean) {
    if (ok) flashOk()
    else flashFail()
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
            {/* Badge de facturation, DISTINCT de la pastille is_active (widget
                on/off) : un bot en ligne peut réclamer un paiement. null si
                billing OFF ou bot payé (état nominal). */}
            {billingChip(bot.billing_status, bot.trial_end)}
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
            {copied
              ? <><Check size={13} /> Copié !</>
              : copyFail
                ? <><AlertTriangle size={13} /> Échec — réessayez</>
                : <><Clipboard size={13} /> {'Copier le <script>'}</>}
          </Btn>
          <IntegrationMenu botId={bot.id} onCopied={flash} />
        </div>
      )}
    </Card>
  )
}

// Priorité d'atterrissage sur /app : on redirige vers le bot qui demande le plus
// d'attention. 0 = paiement requis (billing_status inactive/past_due), 1 =
// configuration à finaliser (hors ligne ou sans domaine autorisé), 2 = en ligne &
// configuré. À priorité égale, ordre alphabétique (FR, insensible à la casse).
function botLandingPriority(b: BotSummary): number {
  if (b.billing_status === 'inactive' || b.billing_status === 'past_due'
      || b.billing_status === 'suspended') return 0
  if (!b.is_active || b.allowed_domains.length === 0) return 1
  return 2
}

export default function BotList() {
  const { user, activeOrg } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApiResource<BotSummary[]>('/api/bots')
  // Espace affiché uniquement (bots perso + équipe active).
  const bots = botsInSpace(data ?? [], activeOrg?.id)

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

  // /app n'est plus une page liste : dès qu'il existe au moins un bot, on
  // atterrit directement sur le plus prioritaire (paiement requis, puis config à
  // finaliser, puis alpha). La liste reste accessible via l'aside (BotNav).
  if (bots.length > 0) {
    const target = [...bots].sort(
      (a, b) => botLandingPriority(a) - botLandingPriority(b)
        || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    )[0]
    return <Navigate to={`/app/bots/${target.id}`} replace />
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
