// Détection de hauteur (YIN, de Cheveigné & Kawahara 2002) pour une note à la fois, en direct, sans IA.

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / buf.length)
}

/** Fréquence fondamentale (Hz) et clarté (0-1), ou null si pas de hauteur nette. */
export function yin(buf: Float32Array, sampleRate: number, minHz = 50, maxHz = 2000): { hz: number; clarity: number } | null {
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2))
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  const d = new Float32Array(maxTau + 1)
  const W = buf.length - maxTau
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x }
    d[tau] = s
  }
  // différence normalisée cumulée
  let run = 0
  d[0] = 1
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1 }
  const threshold = 0.12
  let tau = -1
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break }
  }
  if (tau < 0) return null
  // interpolation parabolique
  const x0 = tau > 1 ? d[tau - 1] : d[tau], x2 = tau < maxTau ? d[tau + 1] : d[tau]
  const den = x0 + x2 - 2 * d[tau]
  const better = den ? tau + (x0 - x2) / (2 * den) : tau
  return { hz: sampleRate / better, clarity: 1 - d[tau] }
}

export const hzToMidi = (hz: number, refA4 = 440) => 69 + 12 * Math.log2(hz / refA4)
