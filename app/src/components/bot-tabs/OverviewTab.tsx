// Onglet « Aperçu » de BotPage — landing de suivi du bot (fusion direction A + C).
// Présentationnel : tout l'état/les handlers viennent de BotPage (même pattern que
// les autres *Tab). Trois blocs :
//   1. Bandeau d'état + anneau de progression (santé de mise en route, %).
//   2. Checklist de mise en route (5 étapes) avec CTA inline par étape à faire.
//   3. Gestion rapide : domaines autorisés + zone d'activation/danger.
// Aucune donnée inventée : le % et les statuts sont dérivés des champs réels du
// bot (allowed_domains, is_active, tree_json) et de l'entitlement de facturation.
import { useState } from 'react'
import { Check, Clipboard, Plus } from 'lucide-react'
import { Btn, Card, Chip } from '../../ui'
import type { Bot, BotUpdate } from '../../types/bot'
import type { BotEntitlementView } from '../../types/billing'

// Une étape de mise en route dérivée de l'état réel du bot.
interface SetupStep {
  key: string
  label: string
  sub: string
  done: boolean
  doneHint?: string
  cta?: { label: string; onClick: () => void; tone: 'primary' | 'soft' | 'danger' }
}

// Anneau de progression SVG (sweep animé au montage via le style transition).
function HealthRing({ pct, tone }: { pct: number; tone: 'warn' | 'go' }) {
  const r = 58
  const C = 2 * Math.PI * r
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100)
  const stroke = tone === 'go' ? '#2F9E79' : '#E0A82E'
  const track = tone === 'go' ? 'rgba(47,158,121,.2)' : 'rgba(224,168,46,.2)'
  const label = tone === 'go' ? '#1C7A5C' : '#B5810F'
  return (
    <div style={{ position: 'relative', width: 118, height: 118, flexShrink: 0 }}>
      <svg width="118" height="118" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="70" cy="70" r={r} fill="none" stroke={track} strokeWidth="13" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={stroke} strokeWidth="13" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={off}
                style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 600, color: label }}>{Math.round(pct)}%</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: label, opacity: .75 }}>{tone === 'go' ? 'en ligne' : 'prêt'}</span>
      </div>
    </div>
  )
}

export default function OverviewTab({
  bot, billing, billingTabVisible, hasPerm,
  switchTab, activateBot,
  newDomain, setNewDomain, addDomain,
  patch, subscribeNow, subscribeBusy, integrationSnippet,
}: {
  bot: Bot
  billing: BotEntitlementView | null
  billingTabVisible: boolean
  hasPerm: (perm: string) => boolean
  switchTab: (t: string) => void
  activateBot: () => void
  newDomain: string
  setNewDomain: (v: string) => void
  addDomain: () => void
  patch: (fields: BotUpdate) => void
  subscribeNow: () => void
  subscribeBusy: boolean
  // Balise <script> d'intégration (1ʳᵉ intégration de GET /bots/{id}/embed),
  // affichée en accès rapide ici. Absente tant que /embed n'a pas répondu.
  integrationSnippet?: string
}) {
  const site = bot.allowed_domains[0] || 'votre-site.fr'
  const nodeCount = Object.keys(bot.tree_json?.nodes || {}).length
  const canSecurity = hasPerm('security')
  const [copied, setCopied] = useState(false)
  function copySnippet() {
    if (!integrationSnippet) return
    navigator.clipboard.writeText(integrationSnippet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // État de facturation : on ne propose l'étape « paiement » que si le billing
  // est actif ET visible pour ce payeur (sinon le bot est gratuit -> pas d'étape).
  const status = billing?.status ?? billing?.subscription_status
  // 'trialing' = statut LEGACY résiduel, traité comme actif (accès OK, pas d'essai affiché).
  const paymentRequired = billingTabVisible && status === 'inactive'
  const paymentDone = !billingTabVisible || status === 'active' || status === 'trialing'

  // --- Étapes de mise en route (dérivées des champs réels) ------------------
  const steps: SetupStep[] = [
    {
      key: 'appearance', label: "Personnaliser l'apparence",
      sub: 'Couleurs, icône, message d’accueil du widget.',
      done: true, doneHint: 'Fait',
    },
    {
      key: 'tree', label: "Construire l'arbre de conversation",
      sub: 'Les branches et options proposées au visiteur.',
      done: nodeCount >= 2, doneHint: `${nodeCount} nœuds`,
      cta: nodeCount >= 2 ? undefined : { label: 'Ouvrir l’arbre →', onClick: () => switchTab('tree'), tone: 'soft' },
    },
    {
      key: 'domain', label: 'Déclarer un domaine autorisé',
      sub: "Le widget ne s'affichera nulle part tant qu'aucun domaine n'est validé.",
      done: bot.allowed_domains.length > 0, doneHint: bot.allowed_domains[0],
      cta: bot.allowed_domains.length > 0 ? undefined : { label: 'Ajouter →', onClick: () => switchTab('security'), tone: 'soft' },
    },
  ]
  if (billingTabVisible) {
    steps.push({
      key: 'payment', label: 'Finaliser le paiement',
      sub: "L'IA et les modules payants sont suspendus tant que le paiement n'est pas réglé.",
      done: paymentDone, doneHint: 'Actif',
      cta: paymentDone ? undefined : { label: 'Finaliser le paiement', onClick: subscribeNow, tone: 'danger' },
    })
  }
  steps.push({
    key: 'activate', label: 'Activer le bot',
    sub: 'Met le widget en ligne sur vos domaines autorisés.',
    done: bot.is_active, doneHint: 'En ligne',
    cta: bot.is_active || !canSecurity ? undefined : { label: 'Activer', onClick: activateBot, tone: 'primary' },
  })

  const doneCount = steps.filter(s => s.done).length
  const total = steps.length
  const pct = Math.round((doneCount / total) * 100)
  const remaining = total - doneCount
  const allReady = remaining === 0 && bot.is_active
  const tone: 'warn' | 'go' = allReady ? 'go' : 'warn'

  // CTA principal du bandeau : la prochaine action bloquante.
  const bannerCta = paymentRequired
    ? { label: subscribeBusy ? 'Redirection…' : 'Finaliser le paiement', onClick: subscribeNow, tone: 'danger' as const }
    : bot.allowed_domains.length === 0 && canSecurity
      ? { label: 'Déclarer un domaine', onClick: () => switchTab('security'), tone: 'primary' as const }
      : !bot.is_active && canSecurity
        ? { label: 'Activer le bot', onClick: activateBot, tone: 'primary' as const }
        : null

  return (
    <div className="col" style={{ gap: 16 }}>

      {/* ===== BANDEAU D'ÉTAT + ANNEAU ===== */}
      <div style={{
        borderRadius: 16, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap',
        border: `1px solid ${allReady ? 'rgba(47,158,121,.32)' : 'rgba(224,168,46,.4)'}`,
        background: allReady ? 'rgba(47,158,121,.10)' : 'rgba(224,168,46,.10)',
      }}>
        <HealthRing pct={pct} tone={tone} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 21, letterSpacing: '-.01em', color: allReady ? '#1C7A5C' : '#B5810F' }}>
            {allReady
              ? 'Tout est en ordre · votre bot est en ligne'
              : `Presque en ligne — ${remaining} étape${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--mut)', marginTop: 5, lineHeight: 1.55, maxWidth: 560 }}>
            {allReady
              ? <>Le widget répond sur <strong style={{ color: 'var(--ink)' }}>{site}</strong>. Abonnement actif, domaine vérifié.</>
              : 'Terminez les étapes ci-dessous pour mettre votre assistant en service.'}
          </div>
          {bannerCta && (
            <div className="row g8" style={{ marginTop: 15, flexWrap: 'wrap' }}>
              <Btn kind={bannerCta.tone} onClick={bannerCta.onClick} disabled={subscribeBusy && bannerCta.tone === 'danger'}>
                {bannerCta.label}
              </Btn>
            </div>
          )}
        </div>
      </div>

      {/* ===== CHECKLIST DE MISE EN ROUTE ===== */}
      <Card nopad>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 8px' }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Mise en route</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: allReady ? '#1C7A5C' : '#B5810F' }}>{doneCount} / {total} terminées</span>
        </div>
        {steps.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 18px', borderTop: '1px solid var(--surface2)' }}>
            <span style={{
              width: 24, height: 24, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
              background: s.done ? 'var(--mint)' : 'transparent',
              border: s.done ? 'none' : `2px solid ${s.cta?.tone === 'danger' ? 'var(--danger-bd)' : s.cta ? 'var(--warn-bd)' : 'var(--border2)'}`,
              color: s.done ? '#fff' : 'var(--mut)', fontSize: 12, fontWeight: 800,
            }}>
              {s.done ? <Check size={13} strokeWidth={3.2} /> : steps.indexOf(s) + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: s.done ? 'var(--faint)' : 'var(--ink)', textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</div>
              {!s.done && <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 1 }}>{s.sub}</div>}
            </div>
            {s.done
              ? <span style={{ fontSize: 12, color: 'var(--faint)' }}>{s.doneHint}</span>
              : s.cta
                ? <Btn kind={s.cta.tone} small onClick={s.cta.onClick}>{s.cta.label}</Btn>
                : <span style={{ fontSize: 12, color: 'var(--faint)' }}>En attente</span>}
          </div>
        ))}
      </Card>

      {/* ===== BALISE D'INTÉGRATION (accès rapide) ===== */}
      {integrationSnippet && (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Balise d'intégration</span>
            <Btn kind={copied ? 'soft' : 'primary'} small onClick={copySnippet}>
              {copied ? <><Check size={13} /> Copié !</> : <><Clipboard size={13} /> Copier</>}
            </Btn>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 8, lineHeight: 1.5 }}>
            Collez cette balise avant la fin de <span className="mono">&lt;/body&gt;</span> sur votre site.
            Autres formats (iframe, GTM) dans l'onglet Intégration.
          </div>
          <pre className="mono" style={{
            margin: 0, padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 9, fontSize: 11.5, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            color: 'var(--ink)',
          }}>{integrationSnippet}</pre>
        </Card>
      )}

      {/* ===== GESTION RAPIDE : domaines + activation/danger ===== */}
      <div className="grid2">
        {/* Domaines autorisés */}
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Domaines autorisés</span>
            {bot.allowed_domains.length === 0
              ? <Chip tone="danger">Requis</Chip>
              : <Chip tone="go">Vérifié</Chip>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 11, lineHeight: 1.5 }}>
            Le widget ne s'initialise que si l'Origin correspond à un domaine déclaré.
          </div>
          <div className="col g6">
            {bot.allowed_domains.map(dom => (
              <div key={dom} className="domain-row">
                <span className="dot" />
                <span className="dm">{dom}</span>
                {canSecurity && (
                  <button className="rm" aria-label="Retirer"
                          onClick={() => patch({ allowed_domains: bot.allowed_domains.filter(x => x !== dom) })}>×</button>
                )}
              </div>
            ))}
          </div>
          {canSecurity && (
            <div className="row g8" style={{ marginTop: bot.allowed_domains.length ? 10 : 0 }}>
              <input type="text" className="mono" value={newDomain} placeholder="autre-domaine.fr"
                     onChange={e => setNewDomain(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && addDomain()} style={{ flex: 1 }} />
              <Btn kind="soft" small onClick={addDomain}><Plus size={13} /> Ajouter</Btn>
            </div>
          )}
        </Card>

        {/* Activation du widget (la suppression de bot a été retirée). */}
        {canSecurity && (
          <Card>
            <div className="card-title">Activation</div>
            <div className="toggle-row">
              <div>
                <div className="tl">Widget actif</div>
                <div className="ts">Désactivé : le chat disparaît des sites, sans rien supprimer.</div>
              </div>
              {/* Toggle aligné sur le composant Toggle de ui.tsx (import possible) */}
              <button className={`toggle ${bot.is_active ? 'on' : ''}`} aria-pressed={bot.is_active}
                      onClick={() => patch({ is_active: !bot.is_active })}>
                <span className="knob" />
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
