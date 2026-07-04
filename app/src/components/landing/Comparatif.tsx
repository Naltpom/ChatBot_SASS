// Section comparatif : tableau Chapote vs IA seule vs support classique.
import { CLASH, CMP_ROWS, eyebrow, sectionH2 } from './data'
import type { Cell } from './data'

const CmpOk = ({ strong }: { strong?: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill={strong ? 'rgba(47,158,121,.2)' : 'rgba(47,158,121,.14)'} /><path d="M7.5 12.4l3 3 6-6.6" stroke="#2F9E79" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
const CmpWarn = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="rgba(224,168,46,.16)" /><path d="M12 7v6" stroke="#C98A12" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.4" r="1.3" fill="#C98A12" /></svg>
const CmpNo = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="rgba(107,123,141,.14)" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#8A98A6" strokeWidth="2.2" strokeLinecap="round" /></svg>

export function Comparatif() {
  return (
    <section id="why" style={{ background: '#F0F2F5', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
          <span style={eyebrow('#2F9E79')}>COMPARATIF</span>
          <h2 className="ch-section-h2" style={sectionH2}>Ni Intercom, ni Chatbase.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px 0 0' }}>L'hybride qui prend le meilleur de chaque modèle, sans en payer les défauts.</p>
        </div>
        <div className="ch-reveal ch-cmp-scroll" style={{ overflowX: 'auto', padding: '4px 0 26px' }}>
        <div className="ch-cmp-table" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, overflow: 'hidden', boxShadow: '0 16px 44px -24px rgba(28,63,92,.24)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
            <div style={{ padding: '22px 24px' }} />
            <div style={{ padding: '20px 14px', textAlign: 'center', background: 'rgba(47,158,121,.07)', borderBottom: '3px solid #2F9E79' }}>
              <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 19, color: '#1C3F5C' }}>Chapote</div>
              <div style={{ fontSize: 11.5, color: '#1C7A5C', marginTop: 2, fontWeight: 600 }}>L'hybride frugal</div>
            </div>
            <div style={{ padding: '20px 14px', textAlign: 'center', borderBottom: '1px solid #EEF1F4' }}><div style={{ fontWeight: 600, fontSize: 15, color: '#6B7B8D' }}>Chatbot 100% IA</div></div>
            <div style={{ padding: '20px 14px', textAlign: 'center', borderBottom: '1px solid #EEF1F4' }}><div style={{ fontWeight: 600, fontSize: 15, color: '#6B7B8D' }}>Support classique</div></div>
          </div>
          {CMP_ROWS.map((row, idx) => {
            const lastRow = idx === CMP_ROWS.length - 1
            const cell = (c: Cell, chapoteCol: boolean) => (
              <div style={{ padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center', background: chapoteCol ? (lastRow ? 'rgba(47,158,121,.1)' : 'rgba(47,158,121,.05)') : undefined }}>
                {c.kind === 'ok' ? <CmpOk strong={c.strong} /> : c.kind === 'warn' ? <CmpWarn /> : <CmpNo />}
                <span style={{ fontSize: 11.5, color: c.strong ? '#1C7A5C' : c.kind === 'ok' && chapoteCol ? '#6B7B8D' : '#9AA7B4', fontWeight: c.strong ? 600 : 400 }}>{c.label}</span>
              </div>
            )
            return (
              <div key={row.label} className={lastRow ? undefined : 'ch-cmp-row'} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', borderTop: '1px solid #EEF1F4', background: lastRow ? 'rgba(47,158,121,.07)' : undefined }}>
                <div style={{ padding: '18px 24px', fontWeight: lastRow ? 700 : 600, fontSize: 15, color: '#1E2A32', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {row.label}
                  {row.badge && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, background: '#2F9E79', color: '#fff', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>{row.badge}</span>}
                </div>
                {cell(row.chapote, true)}
                {cell(row.ia, false)}
                {cell(row.classic, false)}
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </section>
  )
}
