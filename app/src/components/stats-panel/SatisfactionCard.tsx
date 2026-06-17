// Card « Satisfaction visiteurs (CSAT) » — pur présentationnel, extrait de
// StatsPanel (refacto R13). Affiche pouces haut/bas + jauge d'avis positifs.
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Card, Chip, Meter } from '../../ui'
import type { Satisfaction } from './types'

export default function SatisfactionCard({ sat }: { sat: Satisfaction }) {
  const satPct = Math.round((sat.up / Math.max(1, sat.up + sat.down)) * 100)
  return (
    <Card>
      <div className="card-title">Satisfaction visiteurs (CSAT)</div>
      {sat.total === 0 ? (
        <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55 }}>
          Aucun avis sur la période. Les visiteurs peuvent noter chaque réponse du bot (pouces sous les
          bulles du widget).
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 6 }}>
              <ThumbsUp size={14} style={{ color: 'var(--go)' }} />
              <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{sat.up}</span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <ThumbsDown size={14} style={{ color: 'var(--danger)' }} />
              <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{sat.down}</span>
            </span>
            <Chip tone="mut">{sat.total} avis</Chip>
          </div>
          <div style={{ margin: '10px 0 6px' }}>
            <Meter pct={satPct} tone={satPct < 50 ? 'warn' : 'acc'} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{satPct} % d'avis positifs</div>
        </>
      )}
      <div className="field-hint" style={{ marginTop: 10 }}>
        Recueillis via les pouces sous les réponses arbre et IA du widget (30 avis max par visiteur et
        par heure).
      </div>
    </Card>
  )
}
