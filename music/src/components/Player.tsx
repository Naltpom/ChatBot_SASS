// Lecteur « Play » : joue les notes de la vidéo (synthèse Web Audio), affiche en grand la note
// jouée, fait défiler un rouleau de notes et la partition. Aperçu de 25 s ; complet pour l'acheteur.
import { useEffect, useRef, useState } from 'react'
import { getNotes, type NoteRow, type NotesData } from '../api'
import { useI18n } from '../i18n'

const GOLD = '#F2B544'
const TEAL = '#5FD4D0'

function midiHz(p: number) { return 440 * Math.pow(2, (p - 69) / 12) }

/** Synthèse simple et légère : piano (deux oscillateurs + décroissance), corde pincée, archet, batterie (bruit/sinus). */
function scheduleNote(ctx: AudioContext, out: AudioNode, n: NoteRow, at: number, instrument: string) {
  const [, d, p, v, , role, element] = n
  const vel = Math.max(0.05, Math.min(1, v / 127)) * (role ? 0.55 : 0.22)
  if (instrument === 'batterie') {
    const el = (element || '').toLowerCase()
    const g = ctx.createGain()
    g.connect(out)
    if (/grosse|kick|bass/.test(el)) {
      const o = ctx.createOscillator()
      o.frequency.setValueAtTime(140, at)
      o.frequency.exponentialRampToValueAtTime(45, at + 0.18)
      g.gain.setValueAtTime(vel * 1.4, at)
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.25)
      o.connect(g); o.start(at); o.stop(at + 0.3)
      return
    }
    if (/tom/.test(el)) {
      const o = ctx.createOscillator()
      o.frequency.setValueAtTime(midiHz(p) * 2, at)
      o.frequency.exponentialRampToValueAtTime(midiHz(p), at + 0.2)
      g.gain.setValueAtTime(vel, at)
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.3)
      o.connect(g); o.start(at); o.stop(at + 0.35)
      return
    }
    const len = /cymbale|crash|ride/.test(el) ? 0.8 : /charleston|hi/.test(el) ? 0.06 : 0.16
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = /claire|snare/.test(el) ? 1500 : 6000
    g.gain.setValueAtTime(vel * 0.9, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + len)
    src.connect(f); f.connect(g); src.start(at); src.stop(at + len)
    return
  }
  const hz = midiHz(p)
  const dur = Math.max(0.12, Math.min(d, 4))
  const g = ctx.createGain()
  g.connect(out)
  const bowed = instrument === 'violon'
  const plucked = instrument === 'guitare'
  const o1 = ctx.createOscillator()
  o1.type = bowed ? 'sawtooth' : 'triangle'
  o1.frequency.value = hz
  const o2 = ctx.createOscillator()
  o2.type = 'sine'
  o2.frequency.value = hz * 2
  const g2 = ctx.createGain()
  g2.gain.value = bowed ? 0.15 : 0.3
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = bowed ? 2600 : plucked ? 3200 : 4200
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g)
  const attack = bowed ? 0.06 : 0.004
  const release = bowed ? 0.15 : plucked ? 0.9 : 1.4
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vel, at + attack)
  if (bowed) {
    g.gain.setValueAtTime(vel * 0.85, at + Math.max(attack, dur - 0.05))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release)
  } else {
    g.gain.exponentialRampToValueAtTime(vel * 0.35, at + Math.min(dur, 0.6))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release)
  }
  const end = at + dur + release + 0.05
  o1.start(at); o2.start(at); o1.stop(end); o2.stop(end)
}

export default function Player({ sheetId, pages, instrument, auth, title }: {
  sheetId: number
  pages: string[]
  instrument: string
  title: string
  auth?: { order?: string; k?: string }
}) {
  const { t } = useI18n()
  const [data, setData] = useState<NotesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [ended, setEnded] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const startRef = useRef(0)       // ctx.currentTime au temps 0 du morceau
  const fromRef = useRef(0)        // position de départ (reprise)
  const nextIdx = useRef(0)
  const raf = useRef(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const master = useRef<GainNode | null>(null)

  useEffect(() => () => { cancelAnimationFrame(raf.current); ctxRef.current?.close() }, [])
  useEffect(() => { stop(true); setData(null) }, [sheetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const stop = (reset = false) => {
    cancelAnimationFrame(raf.current)
    setPlaying(false)
    if (master.current && ctxRef.current) {
      master.current.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.03)
      master.current = null
    }
    if (reset) { fromRef.current = 0; setTime(0); setEnded(false) }
  }

  const tick = (d: NotesData) => {
    const ctx = ctxRef.current!
    const now = ctx.currentTime - startRef.current
    // programme les notes des 0,6 s à venir
    while (nextIdx.current < d.notes.length && d.notes[nextIdx.current][0] < now + 0.6) {
      const n = d.notes[nextIdx.current]
      if (n[0] >= fromRef.current - 0.01 && master.current) scheduleNote(ctx, master.current, n, startRef.current + n[0], d.instrument)
      nextIdx.current++
    }
    setTime(now)
    if (now >= d.duration) {
      stop()
      fromRef.current = 0
      setEnded(true)
      return
    }
    raf.current = requestAnimationFrame(() => tick(d))
  }

  const play = async () => {
    if (playing) { fromRef.current = time; stop(); return }
    let d = data
    if (!d) {
      setLoading(true); setError(false)
      try { d = await getNotes(sheetId, auth); setData(d) } catch { setError(true); setLoading(false); return }
      setLoading(false)
    }
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = ctxRef.current
    await ctx.resume()
    const g = ctx.createGain()
    g.gain.value = 0.8
    const comp = ctx.createDynamicsCompressor()
    g.connect(comp); comp.connect(ctx.destination)
    master.current = g
    if (ended) { fromRef.current = 0; setEnded(false) }
    startRef.current = ctx.currentTime + 0.1 - fromRef.current
    nextIdx.current = d!.notes.findIndex(n => n[0] >= fromRef.current)
    if (nextIdx.current < 0) nextIdx.current = d!.notes.length
    setPlaying(true)
    raf.current = requestAnimationFrame(() => tick(d!))
  }

  // rouleau de notes + défilement de la partition
  useEffect(() => {
    const c = canvas.current
    if (!c || !data) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const ps = data.notes.map(n => n[2])
    const lo = Math.min(...ps) - 2, hi = Math.max(...ps) + 2
    const pxs = w / 6 // 6 s visibles
    const head = w * 0.22
    g.fillStyle = 'rgba(127,127,127,0.08)'
    g.fillRect(0, 0, w, h)
    for (const n of data.notes) {
      const x = head + (n[0] - time) * pxs
      const len = Math.max(3, n[1] * pxs)
      if (x > w || x + len < 0) continue
      const y = h - ((n[2] - lo) / (hi - lo)) * (h - 10) - 5
      const on = time >= n[0] && time < n[0] + n[1]
      g.globalAlpha = n[5] ? (on ? 1 : 0.85) : 0.35
      g.fillStyle = data.instrument === 'batterie' ? (n[4] ? GOLD : TEAL) : (n[4] ? GOLD : TEAL)
      g.beginPath()
      g.roundRect(x, y - 3, len, 6, 3)
      g.fill()
    }
    g.globalAlpha = 1
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.fillRect(head - 1, 0, 2, h)
    // partition : défile au fil du morceau
    const sc = scroller.current
    if (sc && data.duration > 0) {
      const total = data.full ? data.duration : (data.full_duration || data.duration)
      sc.scrollTop = Math.max(0, (time / total) * (sc.scrollHeight - sc.clientHeight))
    }
  }, [time, data])

  const sounding = data ? data.notes.filter(n => n[5] && time >= n[0] && time < n[0] + Math.max(n[1], 0.15)) : []
  const top = sounding.length ? sounding.reduce((a, b) => (b[2] > a[2] ? b : a)) : null
  const label = top
    ? (data!.instrument === 'batterie' ? (top[6] || '') : `${t.noteNames[top[2] % 12]}${Math.floor(top[2] / 12) - 1}`)
    : ''
  const total = data ? (data.full ? data.duration : data.full_duration || data.duration) : 0
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const previewOver = ended && data && !data.full

  return (
    <section className="player" aria-label={t.listen}>
      <div className="player-top">
        <button type="button" className="play-btn" onClick={play} disabled={loading}
                aria-label={playing ? t.pause : t.play}>
          {loading ? <span className="spinner small" /> : playing
            ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
        </button>
        <div className="player-meta">
          <b>{data?.full ? t.fullPlayer : t.listen}</b>
          <small>{title} · {data ? `${fmt(time)} / ${fmt(data.duration)}` : ''}{data && !data.full ? ` (${fmt(total)})` : ''}</small>
        </div>
        <div className="big-note" aria-live="off">{label}</div>
      </div>
      {error && <div className="msg err">{t.errGeneric}</div>}
      {data && (
        <>
          <canvas ref={canvas} className="roll" aria-hidden="true" />
          <div className="progress"><span style={{ width: `${Math.min(100, (time / Math.max(1, total)) * 100)}%` }} />
            {!data.full && <i style={{ left: `${(data.duration / Math.max(1, total)) * 100}%` }} />}
          </div>
          <div className="score" ref={scroller}>
            {(data.full ? pages : pages.slice(0, 1)).map((src, i) => <img key={src} src={src} alt={t.pageOf(i + 1, pages.length)} />)}
          </div>
          {previewOver && <div className="msg ok">{t.previewEnd}</div>}
        </>
      )}
    </section>
  )
}
