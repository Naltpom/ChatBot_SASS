// Lecture de la partition : joue les notes de la vidéo (synthèse Web Audio) et fait avancer un curseur SUR la feuille
// (place de chaque note dans le PDF : curseur.json de la production). Aperçu de 25 s ; complet pour l'acheteur.
import { useEffect, useRef, useState } from 'react'
import { getNotes, type CursorEvent, type NoteRow, type NotesData } from '../api'
import { useI18n } from '../i18n'
import { track } from '../track'




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

export type CursorPos = { page: number; x: number; y0: number; y1: number }
type Listener = (time: number, pos: CursorPos | null) => void

/** Position du curseur au temps t : glisse d'une note à la suivante sur la même ligne, saute à la ligne suivante. */
export function cursorAt(ev: CursorEvent[] | undefined, t: number): CursorPos | null {
  if (!ev || !ev.length) return null
  let lo = 0, hi = ev.length - 1
  if (t < ev[0][0]) return { page: ev[0][1], x: ev[0][2], y0: ev[0][3], y1: ev[0][4] }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ev[mid][0] <= t) lo = mid; else hi = mid - 1
  }
  const a = ev[lo], b = ev[lo + 1]
  let x = a[2]
  if (b && b[1] === a[1] && b[3] === a[3] && b[2] > a[2]) {
    x = a[2] + (b[2] - a[2]) * Math.min(1, (t - a[0]) / Math.max(0.001, b[0] - a[0]))
  }
  return { page: a[1], x, y0: a[3], y1: a[4] }
}

export function useScorePlayer(sheetId: number, auth?: { order?: string; k?: string }) {
  const [data, setData] = useState<NotesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const startRef = useRef(0)
  const fromRef = useRef(0)
  const timeRef = useRef(0)
  const nextIdx = useRef(0)
  const raf = useRef(0)
  const master = useRef<GainNode | null>(null)
  const listeners = useRef(new Set<Listener>())
  const dataRef = useRef<NotesData | null>(null)

  const emit = (time: number) => {
    const pos = cursorAt(dataRef.current?.cursor, time)
    listeners.current.forEach(l => l(time, pos))
  }
  const stop = (reset = false) => {
    cancelAnimationFrame(raf.current)
    setPlaying(false)
    if (master.current && ctxRef.current) {
      master.current.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.03)
      master.current = null
    }
    if (reset) { fromRef.current = 0; timeRef.current = 0; setEnded(false); emit(0) }
  }

  useEffect(() => () => { cancelAnimationFrame(raf.current); ctxRef.current?.close() }, [])
  useEffect(() => { stop(true); setData(null); dataRef.current = null }, [sheetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const tick = (d: NotesData) => {
    const ctx = ctxRef.current!
    const now = ctx.currentTime - startRef.current
    while (nextIdx.current < d.notes.length && d.notes[nextIdx.current][0] < now + 0.6) {
      const n = d.notes[nextIdx.current]
      if (n[0] >= fromRef.current - 0.01 && master.current) scheduleNote(ctx, master.current, n, startRef.current + n[0], d.instrument)
      nextIdx.current++
    }
    timeRef.current = Math.max(0, now)
    emit(timeRef.current)
    if (now >= d.duration) {
      stop()
      fromRef.current = 0
      setEnded(true)
      return
    }
    raf.current = requestAnimationFrame(() => tick(d))
  }

  const toggle = async () => {
    track(playing ? 'pause' : 'play', { sheet: sheetId, at: Math.round(timeRef.current) })
    if (playing) { fromRef.current = timeRef.current; stop(); return }
    let d = data
    if (!d) {
      setLoading(true); setError(false)
      try { d = await getNotes(sheetId, auth); setData(d); dataRef.current = d } catch { setError(true); setLoading(false); return }
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

  const subscribe = (l: Listener) => {
    listeners.current.add(l)
    l(timeRef.current, cursorAt(dataRef.current?.cursor, timeRef.current))
    return () => { listeners.current.delete(l) }
  }

  return { data, loading, error, playing, ended, toggle, subscribe, started: playing || timeRef.current > 0 }
}

export type ScorePlayer = ReturnType<typeof useScorePlayer>

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Barre de lecture : bouton, titre, temps et progression (mis à jour sans re-rendu). */
export function PlayBar({ player, title }: { player: ScorePlayer; title: string }) {
  const { t } = useI18n()
  const timeEl = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const { data } = player
  const total = data ? (data.full ? data.duration : data.full_duration || data.duration) : 0
  useEffect(() => player.subscribe(time => {
    if (!data) return
    if (timeEl.current) timeEl.current.textContent = `· ${fmt(time)} / ${fmt(data.duration)}`
    if (bar.current) bar.current.style.width = `${Math.min(100, (time / Math.max(1, total)) * 100)}%`
  }), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="playbar">
      <button type="button" className="play-btn" onClick={player.toggle} disabled={player.loading}
              aria-label={player.playing ? t.pause : t.play}>
        {player.loading ? <span className="spinner small" /> : player.playing
          ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
      </button>
      <div className="playbar-meta">
        <b>{data?.full ? t.fullPlayer : t.listen}</b>
        <small><span className="playbar-title">{title}</span>{data && <span ref={timeEl} className="tnum" />}</small>
        {data && (
          <span className="progress"><span ref={bar} />
            {!data.full && <i style={{ left: `${(data.duration / Math.max(1, total)) * 100}%` }} />}
          </span>
        )}
      </div>
      {player.error && <span className="playbar-err">{t.errGeneric}</span>}
      {player.ended && data && !data.full && <span className="playbar-end">{t.previewEnd}</span>}
    </div>
  )
}

/** Curseur posé sur une page de la partition (à placer dans un conteneur position: relative autour de la feuille). */
export function SheetCursor({ player, page }: { player: ScorePlayer; page: number }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => player.subscribe((time, pos) => {
    const c = el.current
    if (!c) return
    if (!pos || pos.page !== page || (time <= 0 && !player.playing)) { c.style.opacity = '0'; return }
    const pad = (pos.y1 - pos.y0) * 0.35
    c.style.opacity = '1'
    c.style.left = `${pos.x * 100}%`
    c.style.top = `${(pos.y0 - pad) * 100}%`
    c.style.height = `${(pos.y1 - pos.y0 + 2 * pad) * 100}%`
  }), [page, player.data, player.playing]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="sheet-cursor" aria-hidden="true" />
}

/** Lecteur complet (page de remerciement, compte) : pages empilées qui défilent sous le curseur. */
export default function Player({ sheetId, pages, auth, title }: {
  sheetId: number
  pages: string[]
  instrument: string
  title: string
  auth?: { order?: string; k?: string }
}) {
  const { t } = useI18n()
  const player = useScorePlayer(sheetId, auth)
  const box = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  const shownPages = player.data && !player.data.full ? pages.slice(0, 1) : pages
  useEffect(() => player.subscribe((_, pos) => {
    const b = box.current, p = pos && pageEls.current[pos.page]
    if (!b || !p || !player.playing) return
    // garde la ligne jouée au tiers haut de la fenêtre
    const y = p.offsetTop + pos.y0 * p.offsetHeight - b.clientHeight * 0.3
    if (Math.abs(b.scrollTop - y) > 4) b.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
  }), [player.playing, player.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="reader" aria-label={t.listen}>
      <PlayBar player={player} title={title} />
      <div className="reader-pages" ref={box}>
        {shownPages.map((src, i) => (
          <div key={src} className="reader-page" ref={e => { pageEls.current[i] = e }}>
            <img src={src} alt={t.pageOf(i + 1, pages.length)} loading="lazy" />
            <SheetCursor player={player} page={i} />
          </div>
        ))}
      </div>
    </section>
  )
}
