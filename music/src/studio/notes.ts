// Notes jouées -> notes calées sur le tempo -> partition ABC (abcjs) et fichier MIDI.

export interface PlayedNote { midi: number; t: number; d: number; vel?: number }
export type Instrument = 'piano' | 'guitar' | 'violin' | 'voice'

export const INSTRUMENTS: Record<Instrument, { low: number; high: number; ref: number; program: number }> = {
  piano: { low: 21, high: 108, ref: 69, program: 0 },
  guitar: { low: 40, high: 88, ref: 57, program: 24 },
  violin: { low: 55, high: 103, ref: 69, program: 40 },
  voice: { low: 40, high: 84, ref: 57, program: 52 },
}

const NAMES = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B']

/** Note MIDI -> nom ABC (C = do4 = 60). */
function abcPitch(m: number): string {
  const n = NAMES[((m % 12) + 12) % 12]
  const oct = Math.floor(m / 12) - 1
  const acc = n.startsWith('^') ? '^' : ''
  const letter = n.replace('^', '')
  if (oct >= 5) return acc + letter.toLowerCase() + "'".repeat(oct - 5)
  return acc + letter + ','.repeat(Math.max(0, 4 - oct))
}

const LEN = (n: number) => (n === 1 ? '' : String(n))  // durée en doubles croches (L:1/16)

interface Ev { start: number; len: number; pitches: number[] }

/** Cale sur une grille de doubles croches : départ et durée arrondis, accords = départs identiques. */
export function quantize(notes: PlayedNote[], bpm: number): Ev[] {
  const step = 60 / bpm / 4
  const byStart = new Map<number, Ev>()
  for (const n of notes) {
    const start = Math.max(0, Math.round(n.t / step))
    const len = Math.max(1, Math.round(n.d / step))
    const ev = byStart.get(start)
    if (ev) { if (!ev.pitches.includes(n.midi)) ev.pitches.push(n.midi); ev.len = Math.max(ev.len, len) }
    else byStart.set(start, { start, len, pitches: [n.midi] })
  }
  const evs = [...byStart.values()].sort((a, b) => a.start - b.start)
  // pas de chevauchement dans une même voix : une note s'arrête où la suivante commence
  for (let i = 0; i < evs.length - 1; i++) evs[i].len = Math.max(1, Math.min(evs[i].len, evs[i + 1].start - evs[i].start))
  return evs
}

function voiceAbc(evs: Ev[]): string {
  const BAR = 16
  let out = '', pos = 0
  const emit = (token: string, len: number, tie: boolean) => {
    let left = len
    while (left > 0) {
      const room = BAR - (pos % BAR)
      const take = Math.min(left, room)
      out += token + LEN(take) + (tie && left - take > 0 && !token.startsWith('z') ? '-' : '') + ' '
      pos += take; left -= take
      if (pos % BAR === 0) out += '| '
    }
  }
  for (const e of evs) {
    if (e.start > pos) emit('z', e.start - pos, false)
    const p = e.pitches.sort((a, b) => a - b).map(abcPitch)
    emit(p.length > 1 ? `[${p.join('')}]` : p[0], e.len, true)
  }
  if (pos % BAR) emit('z', BAR - (pos % BAR), false)
  return out.trim() + (out.trim().endsWith('|') ? ']' : ' |]')
}

/** Partition ABC : une portée (clé de sol ou de fa selon le registre), ou grand système au piano. */
export function toAbc(notes: PlayedNote[], bpm: number, instrument: Instrument, title: string): string {
  const head = `X:1\nT:${title}\nM:4/4\nL:1/16\nQ:1/4=${Math.round(bpm)}\nK:C\n`
  if (!notes.length) return head + 'z16 |]'
  if (instrument === 'piano') {
    const rh = quantize(notes.filter(n => n.midi >= 60), bpm)
    const lh = quantize(notes.filter(n => n.midi < 60), bpm)
    return head + '%%staves {RH LH}\nV:RH clef=treble\nV:LH clef=bass\n' + `[V:RH] ${voiceAbc(rh)}\n[V:LH] ${voiceAbc(lh)}\n`
  }
  const avg = notes.reduce((a, n) => a + n.midi, 0) / notes.length
  const clef = instrument === 'guitar' ? 'treble-8' : avg < 55 ? 'bass' : 'treble'
  const shifted = instrument === 'guitar' ? notes.map(n => ({ ...n, midi: n.midi + 12 })) : notes  // guitare : écrite une octave plus haut
  return head.replace('K:C\n', `K:C clef=${clef}\n`) + voiceAbc(quantize(shifted, bpm)) + '\n'
}

/** Fichier MIDI (format 0) des notes jouées, au tempo donné. */
export function toMidi(notes: PlayedNote[], bpm: number, program: number): Uint8Array {
  const tpq = 480
  const sec2tick = (s: number) => Math.max(0, Math.round((s * bpm / 60) * tpq))
  const evs: { tick: number; bytes: number[] }[] = []
  for (const n of notes) {
    const v = Math.max(1, Math.min(127, Math.round(n.vel ?? 90)))
    evs.push({ tick: sec2tick(n.t), bytes: [0x90, n.midi, v] })
    evs.push({ tick: sec2tick(n.t + Math.max(0.05, n.d)), bytes: [0x80, n.midi, 0] })
  }
  evs.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0])
  const vlq = (x: number) => { const out = [x & 0x7f]; while ((x >>= 7)) out.unshift((x & 0x7f) | 0x80); return out }
  const us = Math.round(60_000_000 / bpm)
  const track: number[] = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xc0, program]
  let last = 0
  for (const e of evs) { track.push(...vlq(e.tick - last), ...e.bytes); last = e.tick }
  track.push(0, 0xff, 0x2f, 0)
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 255, tpq & 255]
  const len = track.length
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...track])
}
