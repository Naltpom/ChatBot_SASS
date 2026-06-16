// Formulaire de contact simulé (nœud d'arbre type 'lead'). Pur présentationnel :
// reçoit les valeurs saisies + callbacks. La validation/soumission (submitLead)
// reste dans WidgetPreview.
import type { LeadSim, PreviewStyle, T } from './shared'

export default function PreviewLeadForm({ lead, vals, err, st, t, onChange, onSubmit }: {
  lead: LeadSim
  vals: Record<string, string>
  err: boolean
  st: PreviewStyle
  t: T
  onChange: (field: string, value: string) => void
  onSubmit: () => void
}) {
  const { brand, r14, square, botBg, botBorder, botText, inputBg, inputBorder, mutedText } = st
  return (
    <div style={{
      background: botBg, border: `1px solid ${botBorder}`, borderRadius: square ? 10 : r14, padding: 12,
      display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '86%',
      boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    }}>
      {lead.fields.map(f => (
        <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: mutedText }}>{t('lead_' + f)}</label>
          {f === 'message' ? (
            <textarea rows={3} value={vals[f] || ''}
                      onChange={e => onChange(f, e.target.value)}
                      style={{
                        fontFamily: 'inherit', fontSize: 13, padding: '8px 11px', borderRadius: 10,
                        border: `1px solid ${inputBorder}`, outline: 'none', background: inputBg, color: botText, resize: 'vertical',
                      }} />
          ) : (
            <input type={f === 'email' ? 'email' : 'text'} required={f === 'email'}
                   value={vals[f] || ''}
                   onChange={e => onChange(f, e.target.value)}
                   style={{
                     fontFamily: 'inherit', fontSize: 13, padding: '8px 11px', borderRadius: 10,
                     border: `1px solid ${inputBorder}`, outline: 'none', background: inputBg, color: botText,
                   }} />
          )}
        </div>
      ))}
      {err && <div style={{ fontSize: 11.5, color: '#c0392b' }}>{t('lead_invalid_email')}</div>}
      <button onClick={onSubmit} style={{
        fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 9, borderRadius: 99,
        border: 'none', cursor: 'pointer', background: brand, color: '#fff', marginTop: 4,
      }}>{t('send')}</button>
    </div>
  )
}
