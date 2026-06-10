// « Facturation » — plan actuel, consommation du mois, changement de plan
// self-serve par les admins de l'organisation (l'API revérifie le rôle et
// applique les garde-fous de downgrade). TODO Stripe : à terme, le bouton
// « Passer à ce plan » ouvrira le checkout / portail client.
import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, CreditCard } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, Meter, SectionTitle } from '../ui'
import { PLANS_INFO, PLAN_LABELS } from '../botConstants'

interface Usage {
  plan: string
  plan_price: number
  type: string
  ai_messages_used: number
  ai_messages_quota: number
  bots_used: number
  bots_quota: number
  tree_only: boolean
  max_tree_nodes: number | null
}

function UsageMeter({ label, used, quota, unit }: { label: string; used: number; quota: number; unit: string }) {
  const pct = Math.round((used / Math.max(1, quota)) * 100)
  const tone = pct > 95 ? 'danger' : pct > 70 ? 'warn' : 'acc'
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {used.toLocaleString('fr-FR')} / {quota.toLocaleString('fr-FR')} {unit}
        </span>
      </div>
      <Meter pct={pct} tone={tone} height={6} />
    </div>
  )
}

export default function Billing() {
  const { user, activeOrg, refreshUser } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const isAdmin = !!user?.is_superadmin || activeOrg?.role === 'admin'

  const loadUsage = useCallback(() => {
    if (!activeOrg) return
    api<Usage>(`/api/orgs/${activeOrg.id}/usage`).then(setUsage).catch(() => setUsage(null))
  }, [activeOrg?.id])
  useEffect(loadUsage, [loadUsage])

  if (!activeOrg) return <Card>Sélectionnez d'abord une organisation.</Card>

  const currentKey = usage?.plan || activeOrg.plan
  const current = PLANS_INFO.find(p => p.key === currentKey)

  async function changePlan(planKey: string) {
    if (!activeOrg) return
    setSaving(true)
    setError('')
    setInfo('')
    try {
      await api(`/api/orgs/${activeOrg.id}/plan`, { method: 'POST', body: { plan: planKey } })
      setConfirming(null)
      setInfo(`Plan ${PLAN_LABELS[planKey] || planKey} activé pour ${activeOrg.name}.`)
      await refreshUser()
      loadUsage()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col g18">
      <SectionTitle sub={`Plan, consommation du mois et changement de formule pour ${activeOrg.name}.`}>
        Facturation
      </SectionTitle>

      {error && <div className="error">{error}</div>}
      {info && <InfoBox tone="go">{info}</InfoBox>}

      {/* ---- Plan actuel + usage du mois ---- */}
      <Card>
        <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 10, background: 'var(--acc-soft, rgba(13,148,136,.12))',
              color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <CreditCard size={17} />
            </span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>
                Plan {PLAN_LABELS[currentKey] || currentKey}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                {current?.desc || 'Formule actuelle de votre organisation.'}
              </div>
            </div>
          </div>
          <Chip tone="acc">{(usage?.plan_price ?? current?.price ?? 0).toLocaleString('fr-FR')} €/mois</Chip>
        </div>
        {usage ? (
          <div className="row" style={{ gap: 22, flexWrap: 'wrap' }}>
            <UsageMeter label="Réponses IA ce mois-ci" used={usage.ai_messages_used}
                        quota={usage.ai_messages_quota} unit="réponses" />
            <UsageMeter label="Chatbots" used={usage.bots_used} quota={usage.bots_quota} unit="bots" />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>Chargement de la consommation…</div>
        )}
      </Card>

      {/* ---- Grille des plans ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        {PLANS_INFO.map(p => {
          const isCurrent = p.key === currentKey
          return (
            <Card key={p.key} style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              borderColor: isCurrent ? 'var(--acc)' : undefined,
            }}>
              <div className="row g8" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{p.label}</span>
                {isCurrent ? <Chip tone="go">Plan actuel</Chip> : p.popular ? <Chip tone="acc">Populaire</Chip> : null}
              </div>
              <div>
                <span style={{ fontSize: 24, fontWeight: 800 }}>{p.price.toLocaleString('fr-FR')} €</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}> /mois</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', minHeight: 30 }}>{p.desc}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {p.features.map(f => (
                  <li key={f} className="row" style={{ gap: 7, fontSize: 12, color: 'var(--ink)' }}>
                    <Check size={13} style={{ color: 'var(--acc)', flexShrink: 0 }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* Action : changement de plan (admins uniquement), confirmation inline */}
              {!isCurrent && isAdmin && (
                confirming === p.key ? (
                  <div className="col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.45 }}>
                      Passer au plan {p.label} ({p.price.toLocaleString('fr-FR')} €/mois) ? Effet immédiat.
                    </div>
                    <div className="row g8">
                      <Btn small onClick={() => changePlan(p.key)} disabled={saving}>
                        {saving ? 'Changement…' : 'Confirmer'}
                      </Btn>
                      <Btn small kind="ghost" onClick={() => setConfirming(null)} disabled={saving}>Annuler</Btn>
                    </div>
                  </div>
                ) : (
                  <Btn kind={p.popular ? 'primary' : 'soft'} small
                       onClick={() => { setError(''); setInfo(''); setConfirming(p.key) }}>
                    Passer à ce plan <ArrowUpRight size={13} />
                  </Btn>
                )
              )}
            </Card>
          )
        })}
      </div>

      {isAdmin ? (
        <InfoBox tone="info" title="Paiement">
          Le paiement en ligne arrive bientôt — pour l'instant les changements de plan sont appliqués
          immédiatement, sans facturation. Un passage à un plan inférieur est refusé tant que vos bots
          dépassent ses limites (nombre de bots, mode IA, taille d'arbre).
        </InfoBox>
      ) : (
        <InfoBox tone="info">
          Seuls les admins de l'organisation peuvent changer de plan. Contactez un admin de {activeOrg.name}.
        </InfoBox>
      )}
    </div>
  )
}
