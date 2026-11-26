import { useState } from 'react'
import { Icon } from '../../components/ui'
import { t } from '../../i18n'

export function PasswordInput({ value, onChange, autoComplete, id, minLength }:
  { value: string; onChange: (v: string) => void; autoComplete: string; id: string; minLength?: number }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-wrap">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
             required autoComplete={autoComplete} minLength={minLength} spellCheck={false} />
      <button type="button" className="reveal" onClick={() => setShow(s => !s)} aria-label={show ? t('Masquer le mot de passe') : t('Afficher le mot de passe')}
              aria-pressed={show}><Icon name={show ? 'eye-off' : 'eye'} /></button>
    </div>
  )
}
