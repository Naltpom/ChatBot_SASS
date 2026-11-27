// Vidéos promo v2 (pilotes) : caméra virtuelle qui voyage dans les vrais écrans, taps simulés, téléphone 3D,
// texte-accroche dès l'image 0, sous-titres 2-3 mots dans la zone sûre, musique et effets mixés (docs/promo-video).
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

export interface Mot { word: string; start: number; end: number; ligne?: number; cle?: boolean }
export interface Cam { t: number; x: number; y: number; z: number; rx?: number; ry?: number }
export interface Tap { t: number; x: number; y: number }
export interface Boite { t0: number; t1: number; x: number; y: number; w: number; h: number }
export interface Masque { t1: number; x: number; y: number; w: number; h: number; style?: 'case' | 'blanc' }
export interface Plan {
  type: 'ecran' | 'texte' | 'chaos' | 'split' | 'fin'
  start: number; end: number
  ecran?: string; cam?: Cam[]; taps?: Tap[]; hl?: Boite[]; masques?: Masque[]
  entree?: 'whip' | 'punch' | 'plonge' | 'aucune'
  mots?: string[]; cles?: string[]; sansSousTitres?: boolean
  badges?: { t: number; x: number; y: number }[]
  horloge?: number; apparitions?: number[]; comptes8?: number[]
}
export interface Son { t: number; src: string; vol: number }
export interface PropsPilote { audio: string; musique: string; volMusique?: number; duree: number; mots: Mot[]; accroche: { texte: string; fin: number }; plans: Plan[]; sons: Son[] }

const ORANGE = '#ff6a2b', ENCRE = '#1c1917'
const POLICE = `@font-face{font-family:Inter;src:url(${staticFile('inter.woff2')}) format('woff2');font-weight:100 900}`
const W = 1080, H = 1920
const K = 600 / 390, BZ = 18, PW = 600 + 2 * BZ, PH = 844 * K + 2 * BZ
const PL = W / 2 - PW / 2, PT = H / 2 - PH / 2 - 40
const doux = Easing.bezier(0.65, 0, 0.35, 1)

function camA(cam: Cam[], t: number): Cam {
  if (t <= cam[0].t) return cam[0]
  for (let i = 0; i < cam.length - 1; i++) {
    const a = cam[i], b = cam[i + 1]
    if (t <= b.t) {
      const p = doux((t - a.t) / Math.max(0.001, b.t - a.t))
      const m = (u?: number, v?: number) => (u ?? 0) + ((v ?? 0) - (u ?? 0)) * p
      return { t, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, z: a.z + (b.z - a.z) * p, rx: m(a.rx, b.rx), ry: m(a.ry, b.ry) }
    }
  }
  return cam[cam.length - 1]
}
// Point de l'écran (px CSS du téléphone) → coordonnées dans le monde (z = 1).
const monde = (x: number, y: number) => ({ X: PL + BZ + x * K, Y: PT + BZ + y * K })

function Fond({ t }: { t: number }) {
  const b = (i: number) => ({ x: 540 + Math.sin(t * 0.6 + i * 2) * 380, y: 960 + Math.cos(t * 0.45 + i * 1.7) * 700 })
  return <AbsoluteFill style={{ background: 'linear-gradient(165deg,#fff4ec 0%,#ffd9c2 55%,#ffc2a1 100%)', overflow: 'hidden' }}>
    {[0, 1, 2].map(i => <div key={i} style={{ position: 'absolute', left: b(i).x - 320, top: b(i).y - 320, width: 640, height: 640, borderRadius: 320,
      background: ['#ff8a4c', '#ffd1b3', '#f9a8d4'][i], opacity: 0.45, filter: 'blur(90px)' }} />)}
    {Array.from({ length: 14 }).map((_, i) => {
      const y = ((i * 211 + t * (40 + (i % 4) * 25)) % 2200) - 140
      return <div key={i} style={{ position: 'absolute', left: (i * 397) % 1040, top: 1920 - y, width: 14 + (i % 3) * 10, height: 14 + (i % 3) * 10,
        borderRadius: i % 2 ? 99 : 4, background: i % 3 ? 'rgba(255,255,255,.55)' : 'rgba(226,85,31,.28)', transform: `rotate(${t * 40 + i * 30}deg)` }} />
    })}
  </AbsoluteFill>
}

function Ecran({ p, t, fps }: { p: Plan; t: number; fps: number }) {
  const cam = p.cam && p.cam.length ? p.cam : [{ t: p.start, x: 195, y: 422, z: 1 }]
  const c = camA(cam, t), c2 = camA(cam, t - 1 / fps)
  const tremble = { x: Math.sin(t * 2.1) * 3 + Math.sin(t * 5.3) * 1.5, y: Math.cos(t * 1.7) * 3, r: Math.sin(t * 1.3) * 0.35 }
  const vit = Math.hypot((c.x - c2.x) * K * c.z, (c.y - c2.y) * K * c.z) + Math.abs(c.z - c2.z) * 900
  const local = t - p.start
  let entree = ''
  let flou = Math.min(3.5, vit / 28)
  if (p.entree === 'whip' && local < 0.3) { const q = Easing.out(Easing.cubic)(local / 0.3); entree = `translateX(${(1 - q) * 900}px)`; flou = Math.max(flou, (1 - q) * 16) }
  if (p.entree === 'punch' && local < 0.35) { const q = Easing.out(Easing.back(2))(local / 0.35); entree = `scale(${1.35 - 0.35 * q})` }
  const P = monde(c.x, c.y)
  const z = c.z
  return <AbsoluteFill style={{ transform: entree, filter: flou > 0.6 ? `blur(${flou.toFixed(1)}px)` : undefined }}>
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '0 0',
      transform: `translate(${W / 2 + tremble.x}px, ${H / 2 - 40 + tremble.y}px) rotate(${tremble.r}deg) scale(${z}) translate(${-P.X}px, ${-P.Y}px)` }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, perspective: 2200 }}>
        <div style={{ position: 'absolute', left: PL, top: PT, width: PW, height: PH, borderRadius: 78, background: '#121212',
          transform: `rotateX(${c.rx ?? 0}deg) rotateY(${c.ry ?? 0}deg)`, transformStyle: 'preserve-3d',
          boxShadow: `${-(c.ry ?? 0) * 3}px 60px 120px rgba(80,30,10,.35), 0 0 0 3px #2a2a2a inset` }}>
          <div style={{ position: 'absolute', left: BZ, top: BZ, width: 600, height: 844 * K, borderRadius: 62, overflow: 'hidden', background: '#fff' }}>
            <Img src={staticFile(`pilotes/${p.ecran}.png`)} style={{ width: 600, height: 844 * K, display: 'block' }} />
            {(p.masques || []).filter(m => t < m.t1).map((m, i) => <div key={i} style={{ position: 'absolute', left: m.x * K, top: m.y * K, width: m.w * K, height: m.h * K,
              background: '#fff', borderRadius: m.style === 'case' ? 7 : 0, border: m.style === 'case' ? '3px solid #a8a29e' : undefined, boxSizing: 'border-box' }} />)}
            {(p.hl || []).filter(b => t >= b.t0 && t <= b.t1).map((b, i) => {
              const s = spring({ frame: Math.round((t - b.t0) * fps), fps, config: { damping: 12, stiffness: 180 } })
              const pulse = 1 + Math.sin((t - b.t0) * 8) * 0.015
              return <div key={i} style={{ position: 'absolute', left: (b.x - 5) * K, top: (b.y - 5) * K, width: (b.w + 10) * K, height: (b.h + 10) * K,
                border: `${5 / Math.max(1, z * 0.6)}px solid ${ORANGE}`, borderRadius: 18, boxShadow: `0 0 0 ${10 * s}px rgba(255,106,43,.18), 0 0 40px rgba(255,106,43,.45)`,
                opacity: s, transform: `scale(${(1.25 - 0.25 * s) * pulse})` }} />
            })}
            {(p.badges || []).filter(b => t >= b.t).map((b, i) => {
              const s = spring({ frame: Math.round((t - b.t) * fps), fps, config: { damping: 9, stiffness: 220 } })
              return <div key={i} style={{ position: 'absolute', left: b.x * K - 30, top: b.y * K - 30, width: 60, height: 60, borderRadius: 30, background: '#16a34a',
                color: '#fff', fontSize: 40, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${s})`,
                boxShadow: '0 8px 24px rgba(22,163,74,.45)' }}>✓</div>
            })}
          </div>
        </div>
      </div>
      {(p.taps || []).map((tp, i) => {
        const d = t - tp.t
        if (d < -0.45 || d > 0.6) return null
        const M = monde(tp.x, tp.y)
        const arr = Easing.out(Easing.cubic)(Math.min(1, (d + 0.45) / 0.4))
        const fx = M.X + (1 - arr) * 160 / z, fy = M.Y + (1 - arr) * 260 / z
        const appui = d >= 0 && d < 0.15 ? 0.82 : 1
        const op = d > 0.3 ? 1 - (d - 0.3) / 0.3 : Math.min(1, (d + 0.45) / 0.15)
        return <div key={i}>
          {d >= 0 && <div style={{ position: 'absolute', left: M.X, top: M.Y, width: 0, height: 0 }}>
            <div style={{ position: 'absolute', left: -(20 + d * 260) / z, top: -(20 + d * 260) / z, width: 2 * (20 + d * 260) / z, height: 2 * (20 + d * 260) / z,
              borderRadius: 999, border: `${6 / z}px solid ${ORANGE}`, opacity: Math.max(0, 1 - d / 0.5) }} />
          </div>}
          <div style={{ position: 'absolute', left: fx - 34 / z, top: fy - 34 / z, width: 68 / z, height: 68 / z, borderRadius: 999,
            background: 'rgba(255,255,255,.92)', border: `${4 / z}px solid rgba(28,25,23,.85)`, boxShadow: `0 ${10 / z}px ${24 / z}px rgba(0,0,0,.35)`,
            transform: `scale(${appui})`, opacity: op }} />
        </div>
      })}
    </div>
  </AbsoluteFill>
}

function Texte({ p, t, fps, mots }: { p: Plan; t: number; fps: number; mots: Mot[] }) {
  // Les mots de la phrase tombent un par un, au moment où la voix les dit.
  const ms = mots.filter(m => m.start >= p.start - 0.05 && m.start < p.end)
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 90px' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 26px', transform: `rotate(${Math.sin(t * 2) * 1.2}deg)` }}>
      {ms.map((m, i) => {
        if (t < m.start - 0.04) return null
        const s = spring({ frame: Math.round((t - m.start + 0.04) * fps), fps, config: { damping: 10, stiffness: 260 } })
        const cle = (p.cles || []).some(k => m.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === k)
        return <span key={i} style={{ fontSize: 132, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.0, textTransform: 'uppercase',
          color: cle ? '#fff' : ENCRE, background: cle ? ORANGE : 'transparent', padding: cle ? '6px 22px 12px' : 0, borderRadius: 22,
          transform: `scale(${0.4 + 0.6 * s}) translateY(${(1 - s) * 80}px) rotate(${(1 - s) * (i % 2 ? 8 : -8)}deg)`, display: 'inline-block' }}>{m.word.replace(/[,.:;!?]$/, '')}</span>
      })}
    </div>
  </AbsoluteFill>
}

const APPS = [{ n: 'TikTok', c: '#111' }, { n: 'YouTube', c: '#e00' }, { n: 'Instagram', c: 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)' }]
function Chaos({ p, t, fps }: { p: Plan; t: number; fps: number }) {
  // Avant : l'heure qui tourne, les comptes à remplir, trois applis qui arrivent une par une (sur les mots), barres d'envoi, tout qui tremble.
  const ap = p.apparitions || []
  const h0 = p.horloge ?? p.start
  const enHaut = ap.length ? Math.min(1, Math.max(0, (t - ap[0] + 0.3) / 0.35)) : 1
  const sh = spring({ frame: Math.round((t - h0) * fps) + 6, fps, config: { damping: 9, stiffness: 220 } })
  const minutes = Math.min(59, Math.floor(Math.max(0, t - h0) * 7))
  const c8 = p.comptes8
  return <AbsoluteFill>
    {t >= h0 - 0.05 && <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: 820 - enHaut * 520, fontSize: 165 - enHaut * 45, fontWeight: 900, color: ENCRE,
      letterSpacing: '-0.04em', transform: `scale(${sh}) rotate(${Math.sin(t * 22) * 2.5}deg)` }}>⏰ 23:{String(minutes).padStart(2, '0')}</div>}
    {c8 && enHaut < 1 && <div style={{ position: 'absolute', top: 1080, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 14, opacity: 1 - enHaut }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const ti = c8[0] + (c8[1] - c8[0]) * i / 8
        const s = spring({ frame: Math.round((t - ti) * fps), fps, config: { damping: 10, stiffness: 240 } })
        return <div key={i} style={{ width: 92, height: 92, borderRadius: 46, background: ['#e2551f', '#111', '#e00', '#8134af', '#0ea5e9', '#16a34a', '#f59e0b', '#dd2a7b'][i],
          transform: `scale(${s})`, border: '6px solid #fff', boxShadow: '0 10px 20px rgba(0,0,0,.2)' }} />
      })}
    </div>}
    {APPS.map((a, i) => {
      if (ap[i] === undefined || t < ap[i] - 0.05) return null
      const l = t - ap[i]
      const s = spring({ frame: Math.round(l * fps) + 2, fps, config: { damping: 11, stiffness: 220 } })
      const prog = Math.max(0, Math.min(1, (l - 0.15) / 1.8))
      const sec = Math.sin(t * 30 + i) * 6 * Math.min(1, l)
      return <div key={i} style={{ position: 'absolute', top: 450 + i * 180, left: 140 + (i % 2) * 60, width: 740, height: 160, borderRadius: 36,
        background: '#fff', boxShadow: '0 30px 60px rgba(80,30,10,.25)', display: 'flex', alignItems: 'center', gap: 30, padding: '0 34px', boxSizing: 'border-box',
        transform: `scale(${s}) rotate(${(i - 1) * 4 + sec * 0.3}deg) translateX(${sec + (1 - s) * (i % 2 ? 500 : -500)}px)` }}>
        <div style={{ width: 110, height: 110, borderRadius: 28, background: a.c, flex: 'none' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: ENCRE }}>{a.n}</div>
          <div style={{ marginTop: 10, height: 22, borderRadius: 11, background: '#eee', overflow: 'hidden' }}>
            <div style={{ width: `${prog * 100}%`, height: '100%', background: prog >= 1 ? '#16a34a' : ORANGE }} />
          </div>
          <div style={{ marginTop: 8, fontSize: 30, color: '#78716c', fontWeight: 600 }}>{prog >= 1 ? 'Envoyée. Au suivant…' : `Envoi ${Math.round(prog * 100)} %`}</div>
        </div>
      </div>
    })}
  </AbsoluteFill>
}

function Split({ p, t, fps }: { p: Plan; t: number; fps: number }) {
  // Avant / après : le chaos à gauche se fige, le planning à droite.
  const l = t - p.start
  const s = spring({ frame: Math.round(l * fps), fps, config: { damping: 14, stiffness: 160 } })
  const s2 = spring({ frame: Math.round((l - 0.45) * fps), fps, config: { damping: 11, stiffness: 200 } })
  const s3 = spring({ frame: Math.round((l - 1.0) * fps), fps, config: { damping: 8, stiffness: 220 } })
  return <AbsoluteFill style={{ flexDirection: 'row' }}>
    <div style={{ flex: 1, background: '#2a2522', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 300, gap: 30, filter: 'grayscale(.6)',
      transform: `translateX(${(1 - s) * -540}px)` }}>
      <div style={{ fontSize: 64, fontWeight: 900, color: '#fff', marginBottom: 20 }}>AVANT</div>
      {APPS.map((a, i) => <div key={i} style={{ width: 300, height: 140, borderRadius: 28, background: a.c, transform: `rotate(${Math.sin(l * 20 + i) * 4}deg)`,
        color: '#fff', fontSize: 40, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a.n}</div>)}
      <div style={{ fontSize: 44, color: '#fca5a5', fontWeight: 800 }}>3 envois</div>
    </div>
    <div style={{ flex: 1, background: '#fff4ec', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 300, gap: 24,
      transform: `translateX(${(1 - s2) * 540}px)` }}>
      <div style={{ fontSize: 64, fontWeight: 900, color: ORANGE }}>APRÈS</div>
      <div style={{ width: 300, height: 600, borderRadius: 40, border: '12px solid #121212', overflow: 'hidden', boxShadow: '0 30px 70px rgba(80,30,10,.3)',
        transform: `scale(${1 + Math.sin(l * 1.5) * 0.015})` }}>
        <Img src={staticFile('pilotes/planning.png')} style={{ width: '100%', display: 'block' }} />
      </div>
      <div style={{ fontSize: 44, color: '#15803d', fontWeight: 800, transform: `scale(${s3})` }}>1 planning</div>
    </div>
    <div style={{ position: 'absolute', left: 536, top: 0, bottom: 0, width: 8, background: ORANGE, transform: `scaleY(${s})` }} />
  </AbsoluteFill>
}

function Fin({ p, t, fps }: { p: Plan; t: number; fps: number }) {
  const l = t - p.start
  const s = spring({ frame: Math.round(l * fps), fps, config: { damping: 9, stiffness: 160 } })
  const s2 = spring({ frame: Math.round((l - 0.25) * fps), fps, config: { damping: 12 } })
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 300, gap: 34, transform: `scale(${1 + l * 0.025}) rotate(${Math.sin(l * 1.8) * 0.8}deg)` }}>
    <Img src={staticFile('logo.svg')} style={{ width: 220, height: 220, transform: `scale(${s}) rotate(${(1 - s) * -30}deg)` }} />
    <div style={{ fontSize: 112, fontWeight: 900, letterSpacing: '-0.04em', color: ENCRE, transform: `scale(${0.6 + 0.4 * s2})`, opacity: s2 }}>Chapote CM</div>
    <div style={{ fontSize: 60, fontWeight: 800, color: '#fff', background: ORANGE, borderRadius: 999, padding: '16px 44px', transform: `translateY(${(1 - s2) * 60}px)`, opacity: s2 }}>cm.chapote.fr</div>
    <div style={{ fontSize: 46, fontWeight: 800, color: ENCRE, opacity: s2, transform: `scale(${1 + 0.12 * spring({ frame: Math.round((l - 1.6) * fps), fps, config: { damping: 8 } }) * Math.max(0, 1 - Math.max(0, l - 1.6) * 1.5)})` }}>Gratuit · sans carte bancaire</div>
  </AbsoluteFill>
}

function SousTitres({ mots, t, plans }: { mots: Mot[]; t: number; plans: Plan[] }) {
  const p = plans.find(x => t >= x.start && t < x.end)
  if (!p || p.sansSousTitres) return null
  // Pages de 2-3 mots, coupées aux ponctuations et aux changements de phrase.
  const pages: Mot[][] = []; let g: Mot[] = []
  mots.forEach(m => {
    if (g.length && g[g.length - 1].ligne !== m.ligne) { pages.push(g); g = [] }
    g.push(m)
    const court = m.word.replace(/[^\p{L}\p{N}]/gu, '').length <= 3
    if (g.length >= 3 || (g.length >= 2 && !court && /[.,!?:;]$/.test(m.word)) || /[.!?:]$/.test(m.word)) { pages.push(g); g = [] }
  })
  if (g.length) pages.push(g)
  const cur = pages.find((x, i) => t >= x[0].start - 0.06 && t < (pages[i + 1] ? Math.min(pages[i + 1][0].start - 0.06, x[x.length - 1].end + 0.4) : x[x.length - 1].end + 0.4))
  if (!cur) return null
  return <div style={{ position: 'absolute', left: 120, right: 192, top: 1030, height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 20px', background: 'rgba(28,25,23,.55)', borderRadius: 26, padding: '10px 26px 16px', backdropFilter: 'blur(6px)' }}>
    {cur.map((m, i) => {
      const dit = t >= m.start - 0.03
      const s = dit ? Math.min(1, (t - m.start + 0.03) / 0.09) : 0
      return <span key={i} style={{ fontSize: 80, fontWeight: 900, lineHeight: 1.08, textTransform: 'uppercase', letterSpacing: '-0.02em',
        color: m.cle ? ORANGE : '#fff', WebkitTextStroke: '9px #1c1917', paintOrder: 'stroke fill', textShadow: '0 8px 20px rgba(0,0,0,.35)',
        transform: `scale(${dit ? 1 + 0.14 * (1 - Math.abs(2 * s - 1)) * (s < 1 ? 1 : 0) : 0.92})`, opacity: dit ? 1 : 0.7, display: 'inline-block' }}>{m.word}</span>
    })}
  </div></div>
}

function Accroche({ a, t, fps }: { a: { texte: string; fin: number }; t: number; fps: number }) {
  if (t > a.fin + 0.25) return null
  const s = spring({ frame: Math.round(t * fps) + 8, fps, config: { damping: 10, stiffness: 200 } })   // visible dès l'image 0
  const sortie = t > a.fin ? 1 - (t - a.fin) / 0.25 : 1
  return <div style={{ position: 'absolute', left: 120, right: 192, top: 330, display: 'flex', justifyContent: 'center' }}>
    <div style={{ background: '#fff', color: ENCRE, fontSize: 70, fontWeight: 900, lineHeight: 1.08, letterSpacing: '-0.03em', textAlign: 'center',
      borderRadius: 28, padding: '22px 34px', boxShadow: '0 18px 50px rgba(80,30,10,.3)', transform: `scale(${s * sortie}) rotate(-2deg)`, border: `6px solid ${ORANGE}` }}>{a.texte}</div>
  </div>
}

export function Pilote({ audio, musique, volMusique = 0.3, mots, accroche, plans, sons }: PropsPilote) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps
  const p = plans.find(x => t >= x.start && t < x.end) || plans[plans.length - 1]
  const parle = (u: number) => mots.some(m => u >= m.start - 0.12 && u <= m.end + 0.12)
  return <AbsoluteFill style={{ fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
    <style>{POLICE}</style>
    <Fond t={t} />
    {p.type === 'ecran' && <Ecran p={p} t={t} fps={fps} />}
    {p.type === 'texte' && <Texte p={p} t={t} fps={fps} mots={mots} />}
    {p.type === 'chaos' && <Chaos p={p} t={t} fps={fps} />}
    {p.type === 'split' && <Split p={p} t={t} fps={fps} />}
    {p.type === 'fin' && <Fin p={p} t={t} fps={fps} />}
    <Accroche a={accroche} t={t} fps={fps} />
    <SousTitres mots={mots} t={t} plans={plans} />
    {audio && <Audio src={staticFile(audio)} />}
    {musique && <Audio src={staticFile(musique)} volume={f => {
      const u = f / fps
      // Ducking : la musique descend sous la voix (≈ -18 dB sous elle après normalisation), remonte dans les silences.
      let v = 0; for (let k = -4; k <= 4; k++) v += parle(u + k * 0.04) ? 1 : 0
      return volMusique * (1 - 0.62 * (v / 9))
    }} />}
    {sons.map((s, i) => <Sequence key={i} from={Math.max(0, Math.round(s.t * fps))} durationInFrames={Math.round(2 * fps)}><Audio src={staticFile(s.src)} volume={s.vol} /></Sequence>)}
  </AbsoluteFill>
}
