// Analytics — vue transverse à TOUS mes chatbots (perso + équipes) : regroupe
// Stats, Insights et Leads d'un bot choisi via un sélecteur. Les données restant
// PAR BOT, on liste mes bots (comme BotList : GET /api/bots) et on charge le
// détail du bot sélectionné (tree_json/variant/ab_split + organization_id, qui
// peut être null pour un bot perso) pour alimenter StatsPanel et InsightsPanel.
// Les Leads sont délégués à LeadsSection (tableau date/email/nom/tel/message/
// source + export CSV anti-injection). Style Chapote.
import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { errMsg } from '../utils/errors'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../ui'
import { useApiResource } from '../hooks/useApiResource'
import type { BotSummary, DesignJson, Tree } from '../types/bot'
import StatsPanel from '../components/StatsPanel'
import InsightsPanel from '../components/InsightsPanel'
import BotSelector from '../components/BotSelector'
import LeadsSection, { type LeadsData } from '../components/analytics/LeadsSection'

// Sous-ensemble du détail BotOut effectivement lu ici (tree/variant/ab_split +
// organization_id). tree_json typé Tree pour alimenter le funnel de StatsPanel.
interface BotDetail {
  id: number
  name: string
  organization_id: number | null
  tree_json: Tree
  tree_variant_json: Tree | null
  ab_split_pct: number
  design_json: DesignJson
}

export default function Analytics() {
  const navigate = useNavigate()

  // 1er fetch (liste de TOUS mes bots — perso + équipes, même endpoint que
  // BotList) via le hook partagé : loading/error/reload mutualisés.
  const { data: botsData, loading: botsLoading, error: botsError, reload } = useApiResource<BotSummary[]>('/api/bots')
  const bots = botsData ?? []

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<BotDetail | null>(null)
  const [detailError, setDetailError] = useState('')

  const [leads, setLeads] = useState<LeadsData | null>(null)
  const [leadsBusy, setLeadsBusy] = useState(false)
  const [leadsError, setLeadsError] = useState('')

  // Sélection par défaut : le 1er bot (conservée si encore présente après reload).
  useEffect(() => {
    if (!botsData) return
    setSelectedId(prev => (prev && botsData.some(x => x.id === prev)) ? prev : (botsData[0]?.id ?? null))
  }, [botsData])

  // Détail du bot sélectionné (tree/variant/ab_split + organization_id) + leads
  useEffect(() => {
    if (selectedId == null) { setDetail(null); setLeads(null); return }
    let alive = true
    setDetail(null)
    setDetailError('')
    api<BotDetail>(`/api/bots/${selectedId}`)
      .then(b => { if (alive) setDetail(b) })
      .catch((err: unknown) => { if (alive) setDetailError(errMsg(err, 'Erreur')) })
    loadLeads(selectedId, () => alive)
    return () => { alive = false }
  }, [selectedId])

  function loadLeads(botId: number, alive: () => boolean) {
    setLeadsBusy(true)
    setLeadsError('')
    setLeads(null)
    api<LeadsData>(`/api/bots/${botId}/leads?limit=100`)
      .then(d => { if (alive()) setLeads(d) })
      .catch((err: unknown) => { if (alive()) setLeadsError(errMsg(err, 'Erreur')) })
      .finally(() => { if (alive()) setLeadsBusy(false) })
  }

  // ---------- États de page ----------
  if (botsLoading) return <div className="center-page">Chargement…</div>

  if (botsError) {
    return (
      <div className="col g18">
        <SectionTitle sub="Statistiques, insights et leads de vos chatbots.">Analytics</SectionTitle>
        <InfoBox tone="danger" title="Impossible de charger vos chatbots">{botsError}</InfoBox>
        <div><Btn kind="soft" onClick={reload}>Réessayer</Btn></div>
      </div>
    )
  }

  if (bots.length === 0) {
    return (
      <div className="col g18">
        <SectionTitle sub="Statistiques, insights et leads de vos chatbots.">Analytics</SectionTitle>
        <Card style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div className="col" style={{ alignItems: 'center', gap: 10 }}>
            <Inbox size={24} style={{ color: 'var(--faint)' }} />
            <div style={{ fontSize: 15, fontWeight: 800 }}>Aucun chatbot à analyser</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 420, lineHeight: 1.55 }}>
              Créez un chatbot pour commencer à suivre ses conversations, sa satisfaction et ses leads.
            </div>
            <Btn onClick={() => navigate('/app')}>Mes chatbots</Btn>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="col g18">
      <SectionTitle sub="Statistiques, insights et leads de vos chatbots — un chatbot à la fois.">
        Analytics
      </SectionTitle>

      {/* ---------- Sélecteur de bot ---------- */}
      {/* Même rendu en pilules .inbox-bot-* que l'Inbox (cohérence inter-pages) ;
          chip « En pause » pour les bots inactifs via le slot `extra`. */}
      <Card nopad>
        <div className="card-title" style={{ padding: '12px 12px 0' }}>Chatbot analysé</div>
        <BotSelector bots={bots} selectedId={selectedId} onSelect={setSelectedId}
                     extra={b => (!(b as BotSummary).is_active ? <Chip tone="mut">En pause</Chip> : null)} />
      </Card>

      {detailError ? (
        <InfoBox tone="danger" title="Impossible de charger ce chatbot">{detailError}</InfoBox>
      ) : !detail ? (
        <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement du chatbot…</Card>
      ) : (
        <>
          {/* ---------- Stats ---------- */}
          <StatsPanel botId={detail.id} botName={detail.name}
                      tree={detail.tree_json} variantTree={detail.tree_variant_json}
                      abSplit={detail.ab_split_pct ?? 0} />

          {/* ---------- Insights ---------- */}
          {/* onPrefill : pas d'éditeur d'arbre ici → on renvoie vers l'onglet
              Arbre du bot pour appliquer la suggestion. */}
          <InsightsPanel botId={detail.id}
                         onPrefill={() => navigate(`/app/bots/${detail.id}?tab=tree`)} />

          {/* ---------- Leads ---------- */}
          <LeadsSection botName={detail.name} leads={leads} leadsBusy={leadsBusy} leadsError={leadsError}
                        onReload={() => loadLeads(detail.id, () => true)}
                        onOpenTree={() => navigate(`/app/bots/${detail.id}?tab=tree`)} />

          <div className="field-hint">
            Notification email : sans SMTP configuré côté serveur, les nouveaux leads sont uniquement
            journalisés. Détail et configuration sur la page du chatbot.
          </div>
        </>
      )}
    </div>
  )
}
