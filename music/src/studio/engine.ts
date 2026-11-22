// Moteur du studio : micro, calibrage (bruit, accordage), métronome, suivi des notes en direct (une voix, YIN),
// enregistrement complet pour l'analyse IA à la fin (toutes les notes, Basic Pitch).
import { hzToMidi, rms, yin } from './pitch'
import type { Instrument, PlayedNote } from './notes'
import { INSTRUMENTS } from './notes'

export interface LiveState { notes: PlayedNote[]; current: { midi: number; t: number } | null; time: number; level: number }

export class StudioEngine {
  ctx: AudioContext | null = null
  stream: MediaStream | null = null
  analyser: AnalyserNode | null = null
  node: AudioWorkletNode | null = null
  chunks: Float32Array[] = []
  buf = new Float32Array(2048)
  noise = 0.004
  refA4 = 440
  instrument: Instrument = 'piano'
  raf = 0
  startAt = 0
  notes: PlayedNote[] = []
  cur: { midi: number; t: number; votes: number; cand: number; candN: number; lastLevel: number } | null = null
  onUpdate: (s: LiveState) => void = () => {}
  recording = false

  async open() {
    if (this.ctx) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    src.connect(this.analyser)
    try {
      await this.ctx.audioWorklet.addModule('/studio-recorder.js')
      this.node = new AudioWorkletNode(this.ctx, 'studio-recorder')
      this.node.port.onmessage = e => { if (this.recording) this.chunks.push(e.data as Float32Array) }
      src.connect(this.node)
    } catch { this.node = null }  // sans worklet : pas d'analyse IA, le direct marche quand même
  }

  close() {
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close()
    this.ctx = null
  }

  frame(): { level: number; midi: number | null } {
    this.analyser!.getFloatTimeDomainData(this.buf)
    const level = rms(this.buf)
    if (level < this.noise * 2.5) return { level, midi: null }
    const r = yin(this.buf, this.ctx!.sampleRate)
    if (!r || r.clarity < 0.82) return { level, midi: null }
    const m = hzToMidi(r.hz, this.refA4)
    const { low, high } = INSTRUMENTS[this.instrument]
    if (m < low - 1 || m > high + 1) return { level, midi: null }
    return { level, midi: m }
  }

  /** Bruit de la pièce : niveau moyen pendant `ms` de silence. */
  async measureNoise(ms = 1800): Promise<number> {
    const vals: number[] = []
    const end = performance.now() + ms
    while (performance.now() < end) { this.analyser!.getFloatTimeDomainData(this.buf); vals.push(rms(this.buf)); await new Promise(r => setTimeout(r, 30)) }
    vals.sort((a, b) => a - b)
    this.noise = Math.max(0.001, vals[Math.floor(vals.length * 0.9)] || 0.004)
    return this.noise
  }

  /** Accordage : on joue la note de référence de l'instrument ; écart en cents (±50 au plus), appliqué au la 440. */
  async measureTuning(ms = 2500): Promise<number | null> {
    const ref = INSTRUMENTS[this.instrument].ref
    const devs: number[] = []
    const end = performance.now() + ms
    this.refA4 = 440
    while (performance.now() < end) {
      const f = this.frame()
      if (f.midi != null) {
        const off = f.midi - ref
        const near = off - Math.round(off / 12) * 12  // la jouée à une autre octave : accepté
        if (Math.abs(near) < 0.6) devs.push(near * 100)
      }
      await new Promise(r => setTimeout(r, 25))
    }
    if (devs.length < 8) return null
    devs.sort((a, b) => a - b)
    const cents = Math.max(-50, Math.min(50, devs[Math.floor(devs.length / 2)]))
    this.refA4 = 440 * Math.pow(2, cents / 1200)
    return Math.round(cents)
  }

  /** Clics du métronome (temps fort plus aigu) à partir de `at` (temps de l'AudioContext). */
  click(at: number, strong: boolean) {
    const ctx = this.ctx!
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = strong ? 1500 : 1000
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
    o.connect(g); g.connect(ctx.destination)
    o.start(at); o.stop(at + 0.08)
  }

  metronomeTimer = 0
  startMetronome(bpm: number, from: number) {
    const beat = 60 / bpm
    let n = 0
    const plan = () => {
      const now = this.ctx!.currentTime
      while (from + n * beat < now + 0.2) { this.click(from + n * beat, n % 4 === 0); n++ }
    }
    plan()
    this.metronomeTimer = window.setInterval(plan, 50)
  }
  stopMetronome() { clearInterval(this.metronomeTimer) }

  /** Démarre l'enregistrement après une mesure de décompte. Renvoie l'heure (performance.now) du début. */
  async record(bpm: number, metronome: boolean): Promise<void> {
    const ctx = this.ctx!
    await ctx.resume()
    const beat = 60 / bpm
    const t0 = ctx.currentTime + 0.1 + 4 * beat  // décompte d'une mesure
    this.startMetronome(bpm, ctx.currentTime + 0.1)
    if (!metronome) setTimeout(() => this.stopMetronome(), (4 * beat + 0.1) * 1000)
    this.notes = []; this.cur = null; this.chunks = []
    await new Promise(r => setTimeout(r, (t0 - ctx.currentTime) * 1000))
    this.recording = true
    this.startAt = ctx.currentTime
    const loop = () => {
      const t = ctx.currentTime - this.startAt
      const f = this.frame()
      this.track(f.midi, f.level, t)
      this.onUpdate({ notes: this.notes, current: this.cur ? { midi: this.cur.midi, t: this.cur.t } : null, time: t, level: f.level })
      if (this.recording) this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** Suivi d'une voix : une note commence quand une hauteur tient 2 images, finit au silence ou à un changement net. */
  track(m: number | null, level: number, t: number) {
    const close = (end: number) => {
      if (this.cur && end - this.cur.t > 0.06) this.notes.push({ midi: this.cur.midi, t: this.cur.t, d: end - this.cur.t, vel: 90 })
      this.cur = null
    }
    if (m == null) { if (this.cur) close(t); return }
    const r = Math.round(m)
    if (!this.cur) { this.cur = { midi: r, t, votes: 1, cand: r, candN: 0, lastLevel: level }; return }
    const reattack = level > this.cur.lastLevel * 2.2 && level > this.noise * 6  // même note rejouée
    if (r !== this.cur.midi || reattack) {
      if (r === this.cur.cand) this.cur.candN++
      else { this.cur.cand = r; this.cur.candN = 1 }
      if (this.cur.candN >= 2 || reattack) { close(t); this.cur = { midi: r, t, votes: 1, cand: r, candN: 0, lastLevel: level } }
    } else this.cur.candN = 0
    this.cur && (this.cur.lastLevel = level)
  }

  stop(): number {
    this.recording = false
    cancelAnimationFrame(this.raf)
    this.stopMetronome()
    const t = this.ctx ? this.ctx.currentTime - this.startAt : 0
    if (this.cur) { this.notes.push({ midi: this.cur.midi, t: this.cur.t, d: Math.max(0.1, t - this.cur.t), vel: 90 }); this.cur = null }
    return t
  }

  /** Enregistrement complet, rééchantillonné à 22 050 Hz mono (entrée de Basic Pitch). */
  async recordedAt22k(): Promise<Float32Array | null> {
    if (!this.chunks.length || !this.ctx) return null
    const total = this.chunks.reduce((a, c) => a + c.length, 0)
    const all = new Float32Array(total)
    let o = 0
    for (const c of this.chunks) { all.set(c, o); o += c.length }
    const off = new OfflineAudioContext(1, Math.ceil((total * 22050) / this.ctx.sampleRate), 22050)
    const b = off.createBuffer(1, total, this.ctx.sampleRate)
    b.copyToChannel(all, 0)
    const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start()
    const out = await off.startRendering()
    return out.getChannelData(0)
  }
}

/** Analyse IA (BETA) de tout l'enregistrement : Basic Pitch (Spotify, Apache 2.0), sur la carte graphique du navigateur. */
export async function transcribeAll(audio22k: Float32Array, onProgress: (p: number) => void): Promise<PlayedNote[]> {
  const bp = await import('@spotify/basic-pitch')
  const model = new bp.BasicPitch('/basic-pitch/model.json')
  const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = []
  await model.evaluateModel(audio22k, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) }, onProgress)
  const notes = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)))
  return notes.map(n => ({ midi: n.pitchMidi, t: n.startTimeSeconds, d: n.durationSeconds, vel: Math.round((n.amplitude || 0.7) * 127) }))
    .sort((a, b) => a.t - b.t)
}
