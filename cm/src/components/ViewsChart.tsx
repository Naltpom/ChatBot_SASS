// Vues cumulées par jour, empilées par plateforme (couleurs fixes : TikTok, YouTube, Instagram).
// Survol : repère vertical + infobulle. Légende toujours visible, vue en tableau à côté.
import { useEffect, useMemo, useRef, useState } from 'react'
import { PLATFORM_LABEL, type Platform, type SeriesPoint } from '../api'
import { num, short } from '../format'

const COLORS: Record<Platform, string> = { tiktok: 'var(--tiktok)', youtube: 'var(--youtube)', instagram: 'var(--instagram)' }
const H = 240, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28

export default function ViewsChart({ series: all, metric = 'views' }: { series: SeriesPoint[]; metric?: 'views' | 'followers' }) {
  // La courbe commence au premier jour relevé (pas de faux départ à zéro).
  const first = all.findIndex(pt => Object.values(pt.by_platform).some(v => v?.[metric] != null))
  const series = first > 0 ? all.slice(first) : all
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const platforms = useMemo(() => (['tiktok', 'youtube', 'instagram'] as Platform[])
    .filter(p => series.some(pt => pt.by_platform[p]?.[metric] != null)), [series, metric])
  const val = (pt: SeriesPoint, p: Platform) => pt.by_platform[p]?.[metric] ?? 0
  const totals = series.map(pt => platforms.reduce((s, p) => s + val(pt, p), 0))
  const max = Math.max(1, ...totals)
  const step = niceStep(max / 4)
  const top = Math.ceil(max / step) * step
  const iw = w - PAD_L - PAD_R, ih = H - PAD_T - PAD_B
  const x = (i: number) => PAD_L + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw)
  const y = (v: number) => PAD_T + ih - (v / top) * ih

  if (!platforms.length) {
    return (
      <div className="muted small" style={{ height: H, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        La courbe apparaîtra après le premier relevé des chiffres de vos comptes.
      </div>
    )
  }

  // Aires empilées : chaque plateforme part du haut de la précédente.
  let base = series.map(() => 0)
  const areas = platforms.map(p => {
    const lo = base, hi = series.map((pt, i) => lo[i] + val(pt, p))
    base = hi
    const upper = hi.map((v, i) => `${x(i)},${y(v)}`)
    const lower = lo.map((v, i) => `${x(i)},${y(v)}`).reverse()
    return { p, d: `M${upper.join('L')}L${lower.join('L')}Z`, line: `M${upper.join('L')}` }
  })

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const i = Math.round(((px - PAD_L) / iw) * (series.length - 1))
    setHover(Math.min(series.length - 1, Math.max(0, i)))
  }
  const label = metric === 'views' ? 'Vues cumulées' : 'Abonnés'
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between">
        <div className="legend">
          {platforms.map(p => <span key={p}><span className="swatch" style={{ background: COLORS[p] }} />{PLATFORM_LABEL[p]}</span>)}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setAsTable(t => !t)}>{asTable ? 'Voir la courbe' : 'Voir en tableau'}</button>
      </div>
      {asTable ? (
        <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table className="data">
            <thead><tr><th scope="col">Jour</th>{platforms.map(p => <th key={p} scope="col" className="r">{PLATFORM_LABEL[p]}</th>)}<th scope="col" className="r">Total</th></tr></thead>
            <tbody>
              {series.slice().reverse().map((pt, k) => (
                <tr key={pt.day}><td>{fmtDay(pt.day)}</td>{platforms.map(p => <td key={p} className="r">{num(pt.by_platform[p]?.[metric])}</td>)}<td className="r">{num(totals[series.length - 1 - k])}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={box}>
          <svg role="img" aria-label={`${label} par jour, par plateforme`} width={w} height={H}
               onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ width: w }}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--surface-2)" strokeWidth={1} />
                <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{short(t)}</text>
              </g>
            ))}
            {areas.map(a => <path key={a.p} d={a.d} fill={COLORS[a.p]} fillOpacity={0.18} stroke="none" />)}
            {areas.map(a => <path key={a.p + 'l'} d={a.line} fill="none" stroke={COLORS[a.p]} strokeWidth={2} strokeLinejoin="round" />)}
            <text x={PAD_L} y={H - 6} fontSize={11} fill="var(--muted)">{fmtDay(series[0].day)}</text>
            <text x={w - PAD_R} y={H - 6} fontSize={11} fill="var(--muted)" textAnchor="end">{fmtDay(series[series.length - 1].day)}</text>
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + ih} stroke="var(--border-strong)" strokeWidth={1} />
                {(() => {
                  let acc = 0
                  return platforms.map(p => {
                    acc += val(series[hover], p)
                    return <circle key={p} cx={x(hover)} cy={y(acc)} r={4} fill={COLORS[p]} stroke="var(--surface)" strokeWidth={2} />
                  })
                })()}
              </g>
            )}
          </svg>
          {hover != null && (
            <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover) - 80, 0), w - 170), top: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{fmtDay(series[hover].day)}</div>
              {platforms.map(p => (
                <div key={p} className="row between" style={{ gap: 12 }}>
                  <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: COLORS[p] }} />{PLATFORM_LABEL[p]}</span>
                  <span className="num">{num(series[hover].by_platform[p]?.[metric])}</span>
                </div>
              ))}
              <div className="row between" style={{ gap: 12, borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
                <span>Total</span><span className="num">{num(totals[hover])}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}
