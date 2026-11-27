// Graphiques de l'espace /promo (SVG, sans bibliothèque). Palette catégorielle validée (ordre fixe).
// Les valeurs sont écrites sur le graphique (lisible sans survol, donc sur mobile) ; le survol ajoute le détail.
import { useEffect, useRef, useState } from 'react'

/** Largeur réelle du conteneur : le SVG est dessiné à sa taille (textes lisibles sur mobile, pas de mise à l'échelle). */
function useLargeur(defaut: number) {
  const ref = useRef<HTMLElement>(null)
  const [w, setW] = useState(defaut)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Couleurs catégorielles, ordre fixe (palette de référence validée : clair / sombre via CSS). */
export const SERIES = ['var(--pr-c1)', 'var(--pr-c2)', 'var(--pr-c3)', 'var(--pr-c4)', 'var(--pr-c5)', 'var(--pr-c6)']

function Legende({ series, seuil }: { series: string[]; seuil?: number }) {
  return <div className="pr-legende">{series.map((s, i) => <span key={s}><i style={{ background: SERIES[i] }} />{s}</span>)}{seuil !== undefined && <span><i className="pr-legende-seuil" />seuil {seuil}/10</span>}</div>
}

/** Barres horizontales groupées : une ligne par critère, une barre par série (valeur écrite au bout), ligne du seuil. */
export function BarresGroupees({ lignes, series, seuil, max = 10 }: { lignes: { nom: string; valeurs: (number | undefined)[] }[]; series: string[]; seuil?: number; max?: number }) {
  const [survol, setSurvol] = useState<string | null>(null)
  const [ref, W] = useLargeur(560)
  const L = Math.min(150, Math.round(W * 0.34)), bh = 10, gap = 2, rowH = series.length * (bh + gap) + 10
  const H = lignes.length * rowH + 20
  const x = (v: number) => L + (v / max) * (W - L - 34)
  return (
    <figure className="pr-chart" ref={ref}>
      <Legende series={series} seuil={seuil} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Notes par critère : ${lignes.map(l => `${l.nom} ${l.valeurs.map((v, j) => `${series[j]} ${v ?? '—'}`).join(', ')}`).join(' ; ')}`} className="pr-svg">
        {[0, 2, 4, 6, 8, 10].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 16} className="pr-grille" /><text x={x(t)} y={H - 3} className="pr-axe" textAnchor="middle">{t}</text></g>)}
        {lignes.map((l, i) => {
          const y0 = i * rowH + 4
          return <g key={l.nom}>
            <text x={L - 8} y={y0 + (series.length * (bh + gap)) / 2 + 2} textAnchor="end" className="pr-etiq">{l.nom}</text>
            {l.valeurs.map((v, j) => v === undefined ? null : (
              <g key={j} onMouseEnter={() => setSurvol(`${l.nom} · ${series[j]} : ${v}/10`)} onMouseLeave={() => setSurvol(null)}>
                <rect x={L} y={y0 + j * (bh + gap)} width={Math.max(2, x(v) - L)} height={bh} rx={3} fill={SERIES[j]}><title>{`${l.nom} · ${series[j]} : ${v}/10`}</title></rect>
                <text x={x(v) + 5} y={y0 + j * (bh + gap) + bh - 2} className={j === l.valeurs.length - 1 ? 'pr-val' : 'pr-val pr-val-2'}>{v}</text>
              </g>
            ))}
          </g>
        })}
        {seuil !== undefined && <line x1={x(seuil)} x2={x(seuil)} y1={0} y2={H - 16} className="pr-seuil" />}
      </svg>
      {survol && <figcaption className="pr-muted pr-survol" aria-live="polite">{survol}</figcaption>}
    </figure>
  )
}

/** Barres empilées verticales : une colonne par semaine (total écrit au-dessus), un segment par série ; colonnes prévues en clair. */
export function BarresEmpilees({ colonnes, series }: { colonnes: { nom: string; valeurs: number[]; sous?: string; prevu?: boolean }[]; series: string[] }) {
  const [survol, setSurvol] = useState<string | null>(null)
  const [ref, W] = useLargeur(640)
  const H = 210, B = 22, T = 18
  const maxT = Math.max(1, ...colonnes.map(c => c.valeurs.reduce((a, b) => a + b, 0)))
  const step = (W - 10) / colonnes.length, bw = Math.min(32, step * 0.62)
  const y = (v: number) => (v / maxT) * (H - B - T)
  const iPrevu = colonnes.findIndex(c => c.prevu)
  return (
    <figure className="pr-chart" ref={ref}>
      <Legende series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Volume par semaine : ${colonnes.map(c => `${c.nom} ${c.valeurs.reduce((a, b) => a + b, 0)}`).join(', ')}`} className="pr-svg">
        <line x1={0} x2={W} y1={H - B} y2={H - B} className="pr-grille" />
        {iPrevu > 0 && <g>
          <line x1={10 + iPrevu * step} x2={10 + iPrevu * step} y1={4} y2={H - B} className="pr-grille pr-sep" />
          <text x={10 + iPrevu * step + 6} y={11} className="pr-axe">prévisionnel →</text>
        </g>}
        {colonnes.map((c, i) => {
          let acc = 0
          const cx = 10 + i * step + (step - bw) / 2
          const total = c.valeurs.reduce((a, b) => a + b, 0)
          return <g key={c.nom} className={c.prevu ? 'pr-prevu' : ''} onMouseEnter={() => setSurvol(`${c.nom}${c.sous ? ` (${c.sous})` : ''} : ${total} — ${c.valeurs.map((v, j) => `${series[j]} ${v}`).join(', ')}`)} onMouseLeave={() => setSurvol(null)}>
            <rect x={cx - 4} y={T} width={bw + 8} height={H - B - T} fill="transparent" />
            {c.valeurs.map((v, j) => {
              if (!v) return null
              const h = y(v), yy = H - B - acc - h
              acc += h
              return <rect key={j} x={cx} y={yy + 1} width={bw} height={Math.max(1, h - 1.5)} fill={SERIES[j]}><title>{`${c.nom} · ${series[j]} : ${v}`}</title></rect>
            })}
            <text x={cx + bw / 2} y={H - B - acc - 4} textAnchor="middle" className="pr-val">{total}</text>
            <text x={cx + bw / 2} y={H - B + 14} textAnchor="middle" className="pr-axe">{c.nom}</text>
          </g>
        })}
      </svg>
      {survol && <figcaption className="pr-muted pr-survol" aria-live="polite">{survol}</figcaption>}
    </figure>
  )
}
