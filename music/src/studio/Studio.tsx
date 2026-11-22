// Studio (BETA) : je joue, la partition s'écrit. Calibrage (instrument, bruit de la pièce, accordage, tempo), enregistrement
// avec décompte et métronome, deux vues en direct (partition qui s'écrit, notes qui montent depuis le clavier),
// analyse IA de tout l'enregistrement à la fin (toutes les notes, accords compris), exports MIDI / ABC / impression.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, type Lang } from '../i18n'
import { track } from '../track'
import { StudioEngine, transcribeAll } from './engine'
import { INSTRUMENTS, toAbc, toMidi, type Instrument, type PlayedNote } from './notes'

const TXT: Record<Lang, Record<string, string>> = {
  en: { title: 'Studio', lead: 'Play: the sheet music writes itself.', instrument: 'Instrument', piano: 'Piano', guitar: 'Guitar', violin: 'Violin', voice: 'Voice / flute',
    tempo: 'Tempo', tap: 'Tap', metronome: 'Metronome while recording', mic: 'Allow the microphone', micErr: 'The microphone is not available (permission refused or no microphone).',
    calib: 'Calibration', silence: '1. Stay silent for 2 seconds', silenceGo: 'Measure the silence', silenceOk: 'Room noise measured', tune: '2. Play the reference note and hold it', tuneGo: 'Listen',
    tuneOk: (c: string) => `Tuning: ${c} cents`, tuneKo: 'Nothing clear heard: try again, louder', record: 'Record', stop: 'Stop', countIn: 'Count-in…', recording: 'Recording',
    viewScore: 'Sheet music', viewNotes: 'Rising notes', ai: 'Analyse every note with AI (BETA)', aiRun: 'Analysing…', aiDone: 'AI analysis done: every note, chords included.',
    aiErr: 'The AI analysis failed on this device.', export: 'Export', midi: 'MIDI file', abc: 'ABC file', print: 'Print / PDF', again: 'New recording', noNotes: 'No notes yet.',
    hint: 'Live, one note at a time is followed. For chords (piano, guitar), run the AI analysis at the end.', ref: 'Reference note' },
  fr: { title: 'Studio', lead: 'Joue : la partition s’écrit toute seule.', instrument: 'Instrument', piano: 'Piano', guitar: 'Guitare', violin: 'Violon', voice: 'Voix / flûte',
    tempo: 'Tempo', tap: 'Taper', metronome: 'Métronome pendant l’enregistrement', mic: 'Autoriser le micro', micErr: 'Le micro n’est pas disponible (autorisation refusée ou pas de micro).',
    calib: 'Calibrage', silence: '1. Fais silence 2 secondes', silenceGo: 'Mesurer le silence', silenceOk: 'Bruit de la pièce mesuré', tune: '2. Joue la note de référence et tiens-la', tuneGo: 'Écouter',
    tuneOk: (c: string) => `Accordage : ${c} cents`, tuneKo: 'Rien de net entendu : recommence, plus fort', record: 'Enregistrer', stop: 'Arrêter', countIn: 'Décompte…', recording: 'Enregistrement',
    viewScore: 'Partition', viewNotes: 'Notes qui montent', ai: 'Analyser toutes les notes avec l’IA (BETA)', aiRun: 'Analyse…', aiDone: 'Analyse IA faite : toutes les notes, accords compris.',
    aiErr: 'L’analyse IA a échoué sur cet appareil.', export: 'Exporter', midi: 'Fichier MIDI', abc: 'Fichier ABC', print: 'Imprimer / PDF', again: 'Nouvel enregistrement', noNotes: 'Pas encore de notes.',
    hint: 'En direct, une note à la fois est suivie. Pour les accords (piano, guitare), lance l’analyse IA à la fin.', ref: 'Note de référence' },
  es: { title: 'Estudio', lead: 'Toca: la partitura se escribe sola.', instrument: 'Instrumento', piano: 'Piano', guitar: 'Guitarra', violin: 'Violín', voice: 'Voz / flauta',
    tempo: 'Tempo', tap: 'Marcar', metronome: 'Metrónomo durante la grabación', mic: 'Permitir el micrófono', micErr: 'El micrófono no está disponible (permiso denegado o sin micrófono).',
    calib: 'Calibración', silence: '1. Silencio durante 2 segundos', silenceGo: 'Medir el silencio', silenceOk: 'Ruido de la sala medido', tune: '2. Toca la nota de referencia y mantenla', tuneGo: 'Escuchar',
    tuneOk: (c: string) => `Afinación: ${c} cents`, tuneKo: 'No se oyó nada claro: repite, más fuerte', record: 'Grabar', stop: 'Parar', countIn: 'Cuenta…', recording: 'Grabando',
    viewScore: 'Partitura', viewNotes: 'Notas que suben', ai: 'Analizar todas las notas con IA (BETA)', aiRun: 'Analizando…', aiDone: 'Análisis IA hecho: todas las notas, acordes incluidos.',
    aiErr: 'El análisis IA falló en este dispositivo.', export: 'Exportar', midi: 'Archivo MIDI', abc: 'Archivo ABC', print: 'Imprimir / PDF', again: 'Nueva grabación', noNotes: 'Aún no hay notas.',
    hint: 'En directo se sigue una nota a la vez. Para acordes (piano, guitarra), usa el análisis IA al final.', ref: 'Nota de referencia' },
  ru: { title: 'Студия', lead: 'Играйте — ноты пишутся сами.', instrument: 'Инструмент', piano: 'Фортепиано', guitar: 'Гитара', violin: 'Скрипка', voice: 'Голос / флейта',
    tempo: 'Темп', tap: 'Отстучать', metronome: 'Метроном во время записи', mic: 'Разрешить микрофон', micErr: 'Микрофон недоступен (нет разрешения или микрофона).',
    calib: 'Калибровка', silence: '1. Тишина 2 секунды', silenceGo: 'Измерить тишину', silenceOk: 'Шум комнаты измерен', tune: '2. Сыграйте опорную ноту и держите её', tuneGo: 'Слушать',
    tuneOk: (c: string) => `Строй: ${c} центов`, tuneKo: 'Ничего чёткого не слышно: повторите громче', record: 'Записать', stop: 'Стоп', countIn: 'Отсчёт…', recording: 'Запись',
    viewScore: 'Ноты', viewNotes: 'Ноты вверх', ai: 'Распознать все ноты с ИИ (BETA)', aiRun: 'Анализ…', aiDone: 'Анализ ИИ готов: все ноты, включая аккорды.',
    aiErr: 'Анализ ИИ не удался на этом устройстве.', export: 'Экспорт', midi: 'Файл MIDI', abc: 'Файл ABC', print: 'Печать / PDF', again: 'Новая запись', noNotes: 'Нот пока нет.',
    hint: 'Вживую отслеживается одна нота за раз. Для аккордов (фортепиано, гитара) запустите анализ ИИ в конце.', ref: 'Опорная нота' },
} as unknown as Record<Lang, Record<string, string>>

const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const noteName = (m: number) => `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
const download = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export default function StudioPage() {
  const { lang } = useI18n()
  const T = TXT[lang] as any
  const engine = useMemo(() => new StudioEngine(), [])
  const [instrument, setInstrument] = useState<Instrument>('piano')
  const [bpm, setBpm] = useState(90)
  const [metro, setMetro] = useState(true)
  const [view, setView] = useState<'score' | 'notes'>('score')
  const [phase, setPhase] = useState<'setup' | 'count' | 'rec' | 'done'>('setup')
  const [micOk, setMicOk] = useState<boolean | null>(null)
  const [noiseOk, setNoiseOk] = useState(false)
  const [tuning, setTuning] = useState<string>('')
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState<PlayedNote[]>([])
  const [current, setCurrent] = useState<{ midi: number; t: number } | null>(null)
  const [time, setTime] = useState(0)
  const [ai, setAi] = useState<'' | 'run' | 'done' | 'err'>('')
  const [aiPct, setAiPct] = useState(0)
  const taps = useRef<number[]>([])

  useEffect(() => { document.title = 'Studio (BETA) — Ghost Hands'; return () => engine.close() }, [engine])
  useEffect(() => { engine.instrument = instrument }, [engine, instrument])

  const allow = async () => {
    try { await engine.open(); setMicOk(true); track('studio_mic', { ok: true }) } catch { setMicOk(false); track('studio_mic', { ok: false }) }
  }
  const measureSilence = async () => { setBusy('silence'); await engine.measureNoise(); setNoiseOk(true); setBusy('') }
  const measureTune = async () => {
    setBusy('tune'); const c = await engine.measureTuning(); setBusy('')
    setTuning(c == null ? 'ko' : `${c > 0 ? '+' : ''}${c}`)
  }
  const tap = () => {
    const now = performance.now()
    taps.current = [...taps.current.filter(x => now - x < 3000), now]
    if (taps.current.length >= 3) {
      const iv = taps.current.slice(1).map((x, i) => x - taps.current[i])
      setBpm(Math.round(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length)))
    }
  }
  const start = async () => {
    setAi(''); setNotes([]); setCurrent(null); setTime(0)
    engine.onUpdate = s => { setNotes([...s.notes]); setCurrent(s.current); setTime(s.time) }
    setPhase('count')
    track('studio_record', { instrument, bpm })
    await engine.record(bpm, metro)
    setPhase('rec')
  }
  const stop = () => { engine.stop(); setNotes([...engine.notes]); setCurrent(null); setPhase('done') }
  const runAi = async () => {
    setAi('run'); setAiPct(0)
    try {
      const audio = await engine.recordedAt22k()
      if (!audio) throw new Error('no audio')
      const n = await transcribeAll(audio, p => setAiPct(Math.round(p * 100)))
      const { low, high } = INSTRUMENTS[instrument]
      setNotes(n.filter(x => x.midi >= low && x.midi <= high)); setAi('done'); track('studio_ai', { notes: n.length })
    } catch { setAi('err') }
  }

  const abc = useMemo(() => toAbc(notes, bpm, instrument, 'Studio — Ghost Hands'), [notes, bpm, instrument])
  const refNote = noteName(INSTRUMENTS[instrument].ref)

  return (
    <main className="wrap studio">
      <h1>{T.title} <span className="beta">BETA</span></h1>
      <p className="studio-lead">{T.lead}</p>

      {phase === 'setup' && (
        <section className="studio-card">
          <div className="studio-row">
            <span className="studio-label">{T.instrument}</span>
            <div className="chips">
              {(Object.keys(INSTRUMENTS) as Instrument[]).map(k => (
                <button key={k} type="button" className="chip" aria-pressed={instrument === k} onClick={() => { setInstrument(k); setTuning('') }}>{T[k]}</button>
              ))}
            </div>
          </div>
          <div className="studio-row">
            <span className="studio-label">{T.tempo}</span>
            <input className="field studio-bpm" type="number" min={30} max={240} value={bpm} onChange={e => setBpm(Math.max(30, Math.min(240, +e.target.value || 90)))} /> BPM
            <button type="button" className="btn ghost small" onClick={tap}>{T.tap}</button>
          </div>
          <label className="consent"><input type="checkbox" checked={metro} onChange={e => setMetro(e.target.checked)} /><span>{T.metronome}</span></label>
          {micOk !== true ? (
            <>
              <button type="button" className="btn block" onClick={allow}>🎤 {T.mic}</button>
              {micOk === false && <div className="msg err">{T.micErr}</div>}
            </>
          ) : (
            <>
              <h3>{T.calib}</h3>
              <div className="studio-row">
                <span>{T.silence}</span>
                <button type="button" className="btn ghost small" disabled={!!busy} onClick={measureSilence}>{busy === 'silence' ? '…' : T.silenceGo}</button>
                {noiseOk && <span className="ok-text">✓ {T.silenceOk}</span>}
              </div>
              <div className="studio-row">
                <span>{T.tune} ({T.ref} : <b>{refNote}</b>)</span>
                <button type="button" className="btn ghost small" disabled={!!busy} onClick={measureTune}>{busy === 'tune' ? '…' : T.tuneGo}</button>
                {tuning && <span className={tuning === 'ko' ? 'err-text' : 'ok-text'}>{tuning === 'ko' ? T.tuneKo : `✓ ${T.tuneOk(tuning)}`}</span>}
              </div>
              <p className="hint">{T.hint}</p>
              <button type="button" className="btn block studio-rec" onClick={start}>● {T.record}</button>
            </>
          )}
        </section>
      )}

      {phase !== 'setup' && (
        <section className="studio-card">
          <div className="studio-row studio-bar">
            {phase === 'count' && <span className="rec-dot">{T.countIn}</span>}
            {phase === 'rec' && <span className="rec-dot on">● {T.recording} · {Math.floor(time / 60)}:{String(Math.floor(time % 60)).padStart(2, '0')}</span>}
            {phase === 'rec' && current && <span className="studio-now">{noteName(current.midi)}</span>}
            <div className="seg">
              <button type="button" className={view === 'score' ? 'on' : ''} onClick={() => setView('score')}>{T.viewScore}</button>
              <button type="button" className={view === 'notes' ? 'on' : ''} onClick={() => setView('notes')}>{T.viewNotes}</button>
            </div>
            {(phase === 'rec' || phase === 'count') && <button type="button" className="btn small" onClick={stop}>■ {T.stop}</button>}
          </div>
          {view === 'score' ? <ScoreView abc={abc} empty={T.noNotes} /> : <RiseView notes={notes} current={current} time={time} instrument={instrument} live={phase === 'rec'} />}
          {phase === 'done' && (
            <div className="studio-actions">
              {(instrument === 'piano' || instrument === 'guitar') && ai !== 'done' && (
                <button type="button" className="btn block" disabled={ai === 'run'} onClick={runAi}>{ai === 'run' ? `${T.aiRun} ${aiPct} %` : `✨ ${T.ai}`}</button>
              )}
              {ai === 'done' && <div className="msg ok">{T.aiDone}</div>}
              {ai === 'err' && <div className="msg err">{T.aiErr}</div>}
              <div className="studio-row">
                <span className="studio-label">{T.export}</span>
                <button type="button" className="btn ghost small" disabled={!notes.length} onClick={() => download(toMidi(notes, bpm, INSTRUMENTS[instrument].program) as unknown as BlobPart, 'studio.mid', 'audio/midi')}>{T.midi}</button>
                <button type="button" className="btn ghost small" disabled={!notes.length} onClick={() => download(abc, 'studio.abc', 'text/plain')}>{T.abc}</button>
                <button type="button" className="btn ghost small" disabled={!notes.length} onClick={() => window.print()}>{T.print}</button>
              </div>
              <button type="button" className="linkish" onClick={() => { setPhase('setup'); setNotes([]) }}>↺ {T.again}</button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

/** Partition qui s'écrit (abcjs, chargé seulement ici), redessinée au plus toutes les 300 ms. */
function ScoreView({ abc, empty }: { abc: string; empty: string }) {
  const el = useRef<HTMLDivElement>(null)
  const last = useRef(0)
  const timer = useRef(0)
  useEffect(() => {
    const draw = async () => {
      last.current = performance.now()
      const abcjs = await import('abcjs')
      if (el.current) abcjs.renderAbc(el.current, abc, { responsive: 'resize', add_classes: true, staffwidth: 740 })
    }
    clearTimeout(timer.current)
    const wait = Math.max(0, 300 - (performance.now() - last.current))
    timer.current = window.setTimeout(draw, wait)
    return () => clearTimeout(timer.current)
  }, [abc])
  return <div className="studio-score paper-white" ref={el} aria-label={empty} />
}

/** Notes qui montent depuis le clavier : l'inverse des Reels (la note naît sur la touche et s'élève). */
function RiseView({ notes, current, time, instrument, live }: { notes: PlayedNote[]; current: { midi: number; t: number } | null; time: number; instrument: Instrument; live: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const { low, high } = INSTRUMENTS[instrument]
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const lo = Math.max(low, 21), hi = Math.min(high, 108)
    const whites: number[] = []
    for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m)
    const kw = w / whites.length, kh = Math.min(90, h * 0.22), top = h - kh
    const xOf = (m: number) => {
      const black = [1, 3, 6, 8, 10].includes(m % 12)
      const i = whites.indexOf(black ? m - 1 : m)
      return black ? { x: (i + 1) * kw - kw * 0.3, w: kw * 0.6 } : { x: i * kw, w: kw }
    }
    const now = live ? time : (notes.length ? Math.max(...notes.map(n => n.t + n.d)) : 0)
    const speed = (top - 10) / 4  // 4 s visibles au-dessus du clavier
    const all = current ? [...notes, { midi: current.midi, t: current.t, d: Math.max(0.05, now - current.t) }] : notes
    for (const n of all) {
      if (n.midi < lo || n.midi > hi) continue
      const yBottom = top - (now - (n.t + n.d)) * speed
      const yTop = top - (now - n.t) * speed
      if (yBottom < 0) continue
      const k = xOf(n.midi)
      g.fillStyle = n.midi >= 60 ? '#F2B544' : '#5FD4D0'
      g.beginPath(); g.roundRect(k.x + 1, Math.max(0, yTop), k.w - 2, Math.max(4, yBottom - Math.max(0, yTop)), 4); g.fill()
    }
    const lit = new Set(current ? [current.midi] : [])
    for (const m of whites) { const k = xOf(m); g.fillStyle = lit.has(m) ? '#F2B544' : '#f5f5f7'; g.fillRect(k.x + 0.5, top, k.w - 1, kh); }
    for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(m % 12)) { const k = xOf(m); g.fillStyle = lit.has(m) ? '#F2B544' : '#1d1d1f'; g.fillRect(k.x, top, k.w, kh * 0.62) }
  }, [notes, current, time, low, high, live])
  return <canvas ref={cv} className="studio-rise" aria-hidden="true" />
}
