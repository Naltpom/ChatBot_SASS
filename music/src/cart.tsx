// Panier (identifiants des partitions), gardé dans le navigateur par confort.
// La feuille d'achat sert aussi au « achat direct » depuis la page d'un morceau.
import { createContext, useContext, useState, type ReactNode } from 'react'

export interface CartLine { id: number; label: string }

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem('gh-cart')
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter(x => typeof x?.id === 'number' && typeof x?.label === 'string') : []
  } catch { return [] }
}

function save(lines: CartLine[]) {
  try { localStorage.setItem('gh-cart', JSON.stringify(lines)) } catch { /* rien */ }
}

interface CartCtx {
  lines: CartLine[]
  add: (l: CartLine[]) => void
  remove: (id: number) => void
  clear: () => void
  // feuille d'achat : `null` = fermée ; sinon les lignes à acheter
  sheet: CartLine[] | null
  openSheet: (lines?: CartLine[]) => void
  closeSheet: () => void
}

const Ctx = createContext<CartCtx | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load)
  const [sheet, setSheet] = useState<CartLine[] | null>(null)
  const update = (next: CartLine[]) => { setLines(next); save(next) }
  const value: CartCtx = {
    lines,
    add: ls => update([...lines, ...ls.filter(l => !lines.some(x => x.id === l.id))]),
    remove: id => {
      update(lines.filter(l => l.id !== id))
      if (sheet) setSheet(sheet.filter(l => l.id !== id))
    },
    clear: () => update([]),
    sheet,
    openSheet: ls => setSheet(ls ?? lines),
    closeSheet: () => setSheet(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCart(): CartCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('CartProvider manquant')
  return c
}
