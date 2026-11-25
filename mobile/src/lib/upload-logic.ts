// Découpage d'une vidéo en morceaux (même règle que le serveur : `part_size` octets, le dernier plus court).
export interface Part { index: number; start: number; length: number }

export function partPlan(size: number, partSize: number): Part[] {
  if (!(size > 0) || !(partSize > 0)) return []
  const out: Part[] = []
  for (let i = 0, start = 0; start < size; i++, start += partSize) out.push({ index: i, start, length: Math.min(partSize, size - start) })
  return out
}

/** Pourcentage arrondi vers le bas (jamais 100 % avant la fin). */
export const progressPct = (sent: number, total: number) => (total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0)
