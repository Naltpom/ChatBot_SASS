// Analytics — vue transverse à TOUS mes chatbots (perso + équipes) : regroupe
// Stats, Insights et Leads d'un bot choisi via un sélecteur. Les données restant
// PAR BOT, on liste mes bots (comme BotList : GET /api/bots) et on charge le
// détail du bot sélectionné (tree_json/variant/ab_split + organization_id, qui
// peut être null pour un bot perso) pour alimenter StatsPanel et InsightsPanel.
// Les Leads reprennent la logique de l'onglet Leads du BotPage (GET
// /api/bots/{id}/leads, colonnes date/email/nom/tel/message/source, export CSV
// anti-injection). Style Chapote.
import { useEffect, useMemo, useState } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../ui'
import StatsPanel from '../components/StatsPanel'
import InsightsPanel from '../components/InsightsPanel'
import BotSelector from '../components/BotSelector'
import { downloadCsv } from '../utils/csv'

interface BotSummary {
  id: number
  name: string
  is_active: boolean
  design_json: Record<string, any>
}

interface BotDetail {
  id: number
  name: string
  organization_id: number | null
  tree_json: Record<string, any>
  tree_variant_json: Record<string, any> | null
  ab_split_pct: number
  design_json: Record<string, any>
}

interface LeadRow {
  id: number
  email: string
  phone: string | null
  name: string | null
  message: string | null
  source: 'tree' | 'ai'
  conversation_id: string | null
  created_at: string
}

export default function Analytics() {
  const navigate = useNavigate()

  const [bots, setBots] = useState<BotSummary[]>([])
  const [botsLoading, setBotsLoading] = useState(true)
  const [botsError, setBotsError] = useState('')
  const [retry, setRetry] = useState(0)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<BotDetail | null>(null)
  const [detailError, setDetailError] = useState('')

  const [leads, setLeads] = useState<{ total: number; leads: LeadRow[] } | null>(null)
  const [leadsBusy, setLeadsBusy] = useState(false)
  const [leadsError, setLeadsError] = useState('')

  // Liste de TOUS mes bots — perso + équipes (même endpoint que BotList)
  useEffect(() => {
    setBotsLoading(true)
    setBotsError('')
    api<BotSummary[]>(`/api/bots`)
      .then(b => {
        setBots(b)
        // Sélection par défaut : le 1er bot (conservée si encore présente)
        setSelectedId(prev => (prev && b.some(x => x.id === prev)) ? prev : (b[0]?.id ?? null))
      })
      .catch((err: any) => setBotsError(err.message))
      .finally(() => setBotsLoading(false))
  }, [retry])

  // Détail du bot sélectionné (tree/variant/ab_split + organization_id) + leads
  useEffect(() => {
    if (selectedId == null) { setDetail(null); setLeads(null); return }
    let alive = true
    setDetail(null)
    setDetailError('')
    api<BotDetail>(`/api/bots/${selectedId}`)
      .then(b => { if (alive) setDetail(b) })
      .catch((err: any) => { if (alive) setDetailError(err.message) })
    loadLeads(selectedId, () => alive)
    return () => { alive = false }
  }, [selectedId])

  function loadLeads(botId: number, alive: () => boolean) {
    setLeadsBusy(true)
    setLeadsError('')
    setLeads(null)
    api<{ total: number; leads: LeadRow[] }>(`/api/bots/${botId}/leads?limit=100`)
      .then(d => { if (alive()) setLeads(d) })
      .catch((err: any) => { if (alive()) setLeadsError(err.message) })
      .finally(() => { if (alive()) setLeadsBusy(false) })
  }

  function exportLeadsCsv() {
    const rows = leads?.leads || []
    const header = ['created_at', 'email', 'name', 'phone', 'message', 'source']
    const filename = `leads-${(detail?.name || 'bot').toLowerCase().replace(/\s+/g, '-')}.csv`
    downloadCsv(filename, header, rows.map(l => header.map(h => (l as any)[h])))
  }

  const selectedBot = useMemo(() => bots.find(b => b.id === selectedId) || null, [bots, selectedId])

  // ---------- États de page ----------
  if (botsLoading) return <div className="center-page">Chargement…</div>

  if (botsError) {
    return (
      <div className="col g18">
        <SectionTitle sub="Statistiques, insights et leads de vos chatbots.">Analytics</SectionTitle>
        <InfoBox tone="danger" title="Impossible de charger vos chatbots">{botsError}</InfoBox>
        <div><Btn kind="soft" onClick={() => setRetry(n => n + 1)}>Réessayer</Btn></div>
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
          <StatsPanel botId={detail.id} botName={detail.name} orgId={detail.organization_id ?? undefined}
                      tree={detail.tree_json} variantTree={detail.tree_variant_json}
                      abSplit={detail.ab_split_pct ?? 0} />

          {/* ---------- Insights ---------- */}
          {/* onPrefill : pas d'éditeur d'arbre ici → on renvoie vers l'onglet
              Arbre du bot pour appliquer la suggestion. */}
          <InsightsPanel botId={detail.id}
                         onPrefill={() => navigate(`/app/bots/${detail.id}?tab=tree`)} />

          {/* ---------- Leads ---------- */}
          <SectionTitle sub={`${leads?.total ?? 0} contact(s) capturé(s) par « ${detail.name} ».`}
            right={
              <div className="row g8">
                <Btn kind="ghost" small disabled={leadsBusy}
                     onClick={() => loadLeads(detail.id, () => true)}>
                  <RefreshCw size={13} /> Actualiser
                </Btn>
                <Btn kind="ghost" small onClick={exportLeadsCsv} disabled={!leads?.leads?.length}>
                  Exporter CSV
                </Btn>
              </div>
            }>
            Leads
          </SectionTitle>

          {leadsError ? (
            <InfoBox tone="danger" title="Impossible de charger les leads">{leadsError}</InfoBox>
          ) : leadsBusy && !leads ? (
            <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement…</Card>
          ) : !leads || leads.leads.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div className="col" style={{ alignItems: 'center', gap: 9 }}>
                <Inbox size={24} style={{ color: 'var(--faint)' }} />
                <div style={{ fontSize: 14, fontWeight: 800 }}>Aucun lead pour l'instant</div>
                <div style={{ fontSize: 12, color: 'var(--mut)', maxWidth: 400, lineHeight: 1.55 }}>
                  Ajoutez un nœud « Contact » dans l'arbre, ou une action « Capture de lead », pour
                  collecter des demandes.
                </div>
                <Btn kind="soft" small onClick={() => navigate(`/app/bots/${detail.id}?tab=tree`)}>
                  Ouvrir l'arbre
                </Btn>
              </div>
            </Card>
          ) : (
            <Card nopad>
              <table className="kc">
                <thead>
                  <tr><th>Date</th><th>Email</th><th>Nom</th><th>Téléphone</th><th>Message</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {leads.leads.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                      <td className="mono">{l.email}</td>
                      <td>{l.name || '—'}</td>
                      <td className="mono">{l.phone || '—'}</td>
                      <td title={l.message || ''}>
                        {l.message ? (l.message.length > 60 ? `${l.message.slice(0, 60)}…` : l.message) : '—'}
                      </td>
                      <td>{l.source === 'ai' ? <Chip tone="acc">IA</Chip> : <Chip tone="mut">Arbre</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {selectedBot && (
            <div className="field-hint">
              Notification email : sans SMTP configuré côté serveur, les nouveaux leads sont uniquement
              journalisés. Détail et configuration sur la page du chatbot.
            </div>
          )}
        </>
      )}
    </div>
  )
}
