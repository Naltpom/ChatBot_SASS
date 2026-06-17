// Card « Test A/B » — comparatif des variantes A et B (conversations + CSAT),
// pur présentationnel, extrait de StatsPanel (refacto R13).
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Card, Chip, Meter } from '../../ui'
import type { Stats } from './types'
import { satPct } from './types'

export default function AbTestCard({ variants, variantActive, showAb, abSplit }: {
  variants: Stats['variants']
  variantActive: boolean   // tree_variant_json présent
  showAb: boolean          // variante active OU données B résiduelles
  abSplit: number          // ab_split_pct courant (chip « N % vers B »)
}) {
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Test A/B</div>
        {variantActive ? (
          <Chip tone="acc">{abSplit} % vers B</Chip>
        ) : showAb ? (
          <Chip tone="mut">test arrêté</Chip>
        ) : null}
      </div>
      {!showAb ? (
        <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55, marginTop: 10 }}>
          Aucune variante B active sur la période. Activez un test A/B dans l'onglet Arbre pour comparer
          deux versions du menu.
        </div>
      ) : (
        <div className="grid2" style={{ marginTop: 12 }}>
          {(['a', 'b'] as const).map(k => {
            const v = variants[k]
            const tot = v.satisfaction.total
            const pct = satPct(v.satisfaction)
            return (
              <div key={k} className="col" style={{ gap: 7 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mut)' }}>
                  Variante {k.toUpperCase()}
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <span className="num" style={{ fontSize: 18, fontWeight: 800 }}>
                    {v.conversations.toLocaleString('fr-FR')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mut)' }}>conversations</span>
                </div>
                <div className="row" style={{ gap: 12, fontSize: 12, fontWeight: 700 }}>
                  <span className="row" style={{ gap: 4 }}>
                    <ThumbsUp size={12} style={{ color: 'var(--go)' }} /> {v.satisfaction.up}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <ThumbsDown size={12} style={{ color: 'var(--danger)' }} /> {v.satisfaction.down}
                  </span>
                </div>
                <div className="row g8">
                  <div style={{ flex: 1 }}>
                    <Meter pct={pct} height={6} />
                  </div>
                  <span className="num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', width: 34, textAlign: 'right' }}>
                    {tot ? `${pct} %` : '—'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="field-hint" style={{ marginTop: 10 }}>
        L'affectation A/B est tirée au sort à l'ouverture de la conversation et reste stable ensuite.
      </div>
    </Card>
  )
}
