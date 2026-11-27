// Graphiques du tableau de bord /promo (SVG, sans bibliothèque). Palette catégorielle validée (ordre fixe) ;
// infobulle au survol (title) ; tableau équivalent sous chaque graphique.
import { useState } from 'react'

/** Couleurs catégorielles, ordre fixe (palette de référence validée : clair / sombre via CSS). */
export const SERIES = ['var(--pr-c1)', 'var(--pr-c2)', 'var(--pr-c3)', 'var(--pr-c4)', 'var(--pr-c5)', 'var(--pr-c6)']

/** Barres horizontales groupées : une ligne par critère, une barre par série, ligne du seuil. */
export function BarresGroupees({ lignes, series, seuil, max = 10 }: { lignes: { nom: string; valeurs: (number | undefined)[] }[]; series: string[]; seuil?: number; max?: number }) {
  const [survol, setSurvol] = useState<string | null>(null)
  const L = 150, W = 560, bh = 12, gap = 2, rowH = series.length * (bh + gap) + 14
  const H = lignes.length * rowH + 24
  const x = (v: number) => L + (v / max) * (W - L - 40)
  return (
    <figure className="pr-chart">
      <div className="pr-legende">{series.map((s, i) => <span key={s}><i style={{ background: SERIES[i] }} />{s}</span>)}{seuil !== undefined && <span><i className="pr-legende-seuil" />seuil {seuil}/10</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Notes par critère" className="pr-svg">
        {[0, 2, 4, 6, 8, 10].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 18} className="pr-grille" /><text x={x(t)} y={H - 4} className="pr-axe" textAnchor="middle">{t}</text></g>)}
        {lignes.map((l, i) => {
          const y0 = i * rowH + 4
          return <g key={l.nom}>
            <text x={L - 8} y={y0 + (series.length * (bh + gap)) / 2 + 4} textAnchor="end" className="pr-etiq">{l.nom}</text>
            {l.valeurs.map((v, j) => v === undefined ? null : (
              <g key={j} onMouseEnter={() => setSurvol(`${l.nom} · ${series[j]} : ${v}/10`)} onMouseLeave={() => setSurvol(null)}>
                <rect x={L} y={y0 + j * (bh + gap) - 2} width={W - L} height={bh + 4} fill="transparent" />
                <rect x={L} y={y0 + j * (bh + gap)} width={Math.max(2, x(v) - L)} height={bh} rx={4} fill={SERIES[j]}><title>{`${l.nom} · ${series[j]} : ${v}/10`}</title></rect>
                {j === l.valeurs.length - 1 && <text x={x(v) + 6} y={y0 + j * (bh + gap) + bh - 2} className="pr-val">{v}</text>}
              </g>
            ))}
          </g>
        })}
        {seuil !== undefined && <line x1={x(seuil)} x2={x(seuil)} y1={0} y2={H - 18} className="pr-seuil" />}
      </svg>
      <figcaption className="pr-muted" aria-live="polite">{survol ?? 'Survolez une barre pour sa valeur.'}</figcaption>
    </figure>
  )
}

/** Barres empilées verticales : une colonne par semaine, un segment par série. */
export function BarresEmpilees({ colonnes, series }: { colonnes: { nom: string; valeurs: number[]; sous?: string }[]; series: string[] }) {
  const [survol, setSurvol] = useState<string | null>(null)
  const W = 640, H = 220, B = 28, T = 10
  const maxT = Math.max(1, ...colonnes.map(c => c.valeurs.reduce((a, b) => a + b, 0)))
  const step = (W - 30) / colonnes.length, bw = Math.min(34, step * 0.62)
  const y = (v: number) => (v / maxT) * (H - B - T)
  return (
    <figure className="pr-chart">
      <div className="pr-legende">{series.map((s, i) => <span key={s}><i style={{ background: SERIES[i] }} />{s}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Volume par semaine" className="pr-svg">
        {[0, 0.5, 1].map(f => <g key={f}><line x1={24} x2={W} y1={H - B - f * (H - B - T)} y2={H - B - f * (H - B - T)} className="pr-grille" /><text x={20} y={H - B - f * (H - B - T) + 4} textAnchor="end" className="pr-axe">{Math.round(f * maxT)}</text></g>)}
        {colonnes.map((c, i) => {
          let acc = 0
          const cx = 30 + i * step + (step - bw) / 2
          const total = c.valeurs.reduce((a, b) => a + b, 0)
          return <g key={c.nom} onMouseEnter={() => setSurvol(`${c.nom}${c.sous ? ` (${c.sous})` : ''} : ${total} — ${c.valeurs.map((v, j) => `${series[j]} ${v}`).join(', ')}`)} onMouseLeave={() => setSurvol(null)}>
            <rect x={cx - 4} y={T} width={bw + 8} height={H - B - T} fill="transparent" />
            {c.valeurs.map((v, j) => {
              if (!v) return null
              const h = y(v), yy = H - B - acc - h
              acc += h
              return <rect key={j} x={cx} y={yy + 1} width={bw} height={Math.max(1, h - 2)} rx={j === c.valeurs.length - 1 ? 3 : 0} fill={SERIES[j]}><title>{`${c.nom} · ${series[j]} : ${v}`}</title></rect>
            })}
            <text x={cx + bw / 2} y={H - B + 14} textAnchor="middle" className="pr-axe">{c.nom}</text>
          </g>
        })}
      </svg>
      <figcaption className="pr-muted" aria-live="polite">{survol ?? 'Survolez une semaine pour son détail.'}</figcaption>
    </figure>
  )
}
