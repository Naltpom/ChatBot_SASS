// Barre de sous-onglets en pilules — réutilisée (Apparence, IA, Actions…). Même
// look que la maquette : fond gris, pilule active blanche surélevée.
export default function SubTabs<T extends string>({ value, onChange, options, maxWidth = 600 }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  maxWidth?: number
}) {
  return (
    <div style={{
      display: 'flex', gap: 2, background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 11, padding: 3, maxWidth,
    }}>
      {options.map(t => {
        const active = t.value === value
        return (
          <button key={t.value} onClick={() => onChange(t.value)}
                  style={{
                    flex: 1, fontSize: 12.5, fontWeight: 700, padding: '8px 4px', borderRadius: 8,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--acc)' : 'var(--mut)',
                    boxShadow: active ? '0 1px 2px rgba(28,63,92,.08)' : 'none',
                  }}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
