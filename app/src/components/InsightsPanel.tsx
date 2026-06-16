// Onglet « Insights » — analyse IA des « questions sans réponse » (perm context).
// Le panneau est autonome : ses erreurs (422 aucune question, 429 limiteur)
// restent dans une div locale, jamais dans le canal setError de BotPage (réservé
// à la save bar). Le CTA « Pré-remplir dans l'arbre » remonte à BotPage
// (onPrefill) qui crée le nœud et ouvre l'onglet Arbre — la save bar qui
// apparaît alors est le comportement contractuel.
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '../api'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../ui'

interface Cluster { theme: string; count: number; examples: string[]; suggested_bubble: string }

interface Report {
  id: number
  bot_id: number
  message_count: number
  created_at: string
  report_json: { clusters: Cluster[] }
}

export default function InsightsPanel({ botId, onPrefill }: {
  botId: number
  onPrefill: (theme: string, bubble: string) => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Dernier rapport persisté : GET → objet ou littéralement null (aucun rapport)
  useEffect(() => {
    let alive = true
    setLoaded(false)
    setReport(null)
    setError('')
    api<Report | null>(`/api/bots/${botId}/insights`)
      .then(r => { if (alive) { setReport(r); setLoaded(true) } })
      .catch((err: any) => { if (alive) { setError(err.message); setLoaded(true) } })
    return () => { alive = false }
  }, [botId])

  async function generate() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setReport(await api<Report>(`/api/bots/${botId}/insights/generate`, { method: 'POST' }))
    } catch (err: any) {
      setError(err.message)   // 403 / 422 / 429 : detail serveur verbatim
    } finally {
      setBusy(false)
    }
  }

  const clusters = report?.report_json?.clusters || []

  return (
    <div className="col g18">
      <SectionTitle
        sub="L'IA regroupe les questions des visiteurs des 30 derniers jours et vous suggère des bulles d'arbre pour y répondre gratuitement."
        right={
          <Btn kind="primary" onClick={generate} disabled={busy}>
            {busy ? 'Analyse en cours…' : 'Analyser les questions sans réponse'}
          </Btn>
        }>
        Questions sans réponse
      </SectionTitle>

      <div className="field-hint" style={{ marginTop: -10 }}>
        3 analyses par jour et par organisation — chaque lancement compte, même sans résultat.
      </div>

      {error && <div className="error">{error}</div>}

      {!loaded ? (
        <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement…</Card>
      ) : report === null ? (
        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div className="col" style={{ alignItems: 'center', gap: 9 }}>
            <Sparkles size={24} style={{ color: 'var(--faint)' }} />
            <div style={{ fontSize: 14, fontWeight: 800 }}>Aucune analyse pour l'instant</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', maxWidth: 440, lineHeight: 1.55 }}>
              Lancez une première analyse pour découvrir les thèmes que votre bot ne couvre pas encore — et
              transformez-les en bulles d'arbre, gratuites et illimitées.
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            Dernière analyse : {new Date(report.created_at + 'Z').toLocaleString('fr-FR')} ·{' '}
            {report.message_count} messages analysés
          </div>
          {clusters.length === 0 ? (
            <Card style={{ textAlign: 'center', color: 'var(--faint)' }}>
              L'analyse n'a dégagé aucun thème récurrent — bon signe.
            </Card>
          ) : (
            clusters.map((c, i) => (
              <Card key={i}>
                <div className="row g10" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, flex: 1, minWidth: 180 }}>{c.theme}</div>
                  <Chip tone="mut">{c.count} question{c.count > 1 ? 's' : ''}</Chip>
                </div>
                {(c.examples || []).length > 0 && (
                  <div className="col" style={{ gap: 5, marginBottom: 10 }}>
                    {(c.examples || []).slice(0, 3).map((ex, j) => (
                      <div key={j} style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--faint)', lineHeight: 1.5 }}>
                        « {ex} »
                      </div>
                    ))}
                  </div>
                )}
                <InfoBox tone="go" title="Bulle suggérée">
                  {c.suggested_bubble}
                  <div style={{ marginTop: 8 }}>
                    <Btn kind="soft" small onClick={() => onPrefill(c.theme, c.suggested_bubble)}>
                      Pré-remplir dans l'arbre
                    </Btn>
                  </div>
                </InfoBox>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  )
}
