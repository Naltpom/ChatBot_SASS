// Mon compte, directement dans cm (comme l'écran de l'app) : nom, mot de passe, double authentification
// (application d'authentification, codes de secours, clés d'accès), confidentialité et suppression du compte.
// Même compte que chapote.fr : les changements valent partout.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  changePassword, forgotPasswordFor, get2fa, getPasskeys, regenerateCodes, removePasskey, saveName, totpDisable,
  totpEnable, totpSetup, type Passkey, type TwoFAStatus,
} from '../api'
import { Icon, Msg } from '../components/ui'
import { fmtAgo } from '../format'
import { useSession } from '../session'
import { t } from '../i18n'

const PRIVACY_EMAIL = 'nathan.provost78990@gmail.com'
type Note = { kind: 'ok' | 'err'; text: string } | null

function Codes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="card col" style={{ gap: 8, background: 'var(--info-bg)' }} role="status">
      <strong>{t('Codes de secours : notez-les maintenant')}</strong>
      <p className="small" style={{ margin: 0 }}>{t('Chaque code sert une fois, si vous n’avez plus votre application d’authentification. Ils ne seront plus affichés.')}</p>
      <div className="codes">{codes.map(c => <code key={c}>{c}</code>)}</div>
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}
              onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true)).catch(() => {})}>
        <Icon name="check" size={16} />{copied ? t('Copiés') : t('Copier les codes')}
      </button>
    </div>
  )
}

export default function Account() {
  const { me, refresh } = useSession()
  const { hash } = useLocation()
  const [note, setNote] = useState<Note>(null)
  const [name, setName] = useState(me?.name || '')
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwSent, setPwSent] = useState(false)
  const [tf, setTf] = useState<TwoFAStatus | null>(null)
  const [keys, setKeys] = useState<Passkey[]>([])
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => { get2fa().then(setTf).catch(() => setTf(null)); getPasskeys().then(setKeys).catch(() => setKeys([])) }
  useEffect(load, [])
  useEffect(() => { if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 50) }, [hash])

  const run = async (fn: () => Promise<string | void>) => {
    setNote(null); setBusy(true)
    try { const msg = await fn(); if (msg) setNote({ kind: 'ok', text: msg }) }
    catch (e) { setNote({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }
  const onName = (e: FormEvent) => { e.preventDefault(); run(async () => { await saveName(name.trim()); await refresh(); return t('Nom enregistré.') }) }
  const onPw = (e: FormEvent) => {
    e.preventDefault()
    run(async () => { await changePassword(pw.current, pw.next); setPw({ current: '', next: '' }); return t('Mot de passe changé.') })
  }
  const sendLink = () => run(async () => { await forgotPasswordFor(me!.email); setPwSent(true); return t('Un e-mail a été envoyé à {email} : ouvrez le lien pour choisir votre mot de passe.', { email: me!.email }) })
  const startTotp = () => run(async () => { setSetup(await totpSetup()); setCode('') })
  const enable = (e: FormEvent) => { e.preventDefault(); run(async () => { const r = await totpEnable(code.trim()); setCodes(r.recovery_codes); setSetup(null); setCode(''); load(); return t('Double authentification activée.') }) }
  const disable = () => run(async () => { await totpDisable(code.trim()); setCode(''); load(); return t('Double authentification désactivée.') })
  const regen = () => run(async () => { const r = await regenerateCodes(code.trim()); setCodes(r.recovery_codes); setCode(''); load() })
  const dropKey = (k: Passkey) => { if (window.confirm(t('Retirer la clé « {name} » ?', { name: k.name || t('Clé d’accès') }))) run(async () => { await removePasskey(k.id); load(); return t('Clé retirée.') }) }
  const askDelete = () => {
    if (!window.confirm(t('Toutes vos données Chapote seront supprimées sous 7 jours (comptes connectés, planning, bibliothèque, commentaires). Un e-mail de demande va s’ouvrir. Continuer ?'))) return
    const subject = encodeURIComponent('Suppression de mon compte Chapote')
    const body = encodeURIComponent(`Bonjour,\n\nJe demande la suppression de mon compte Chapote et de toutes mes données.\nCompte : ${me?.email}\n\nMerci.`)
    window.location.href = `mailto:${PRIVACY_EMAIL}?subject=${subject}&body=${body}`
  }
  const google = me?.auth_source === 'google'

  return (
    <div className="settings">
      <div className="row-nw" style={{ gap: 8 }}>
        <Link to="/reglages" className="btn btn-ghost icon-btn" aria-label={t('Retour aux réglages')}><Icon name="left" /></Link>
        <h1 style={{ margin: 0 }}>{t('Mon compte')}</h1>
      </div>
      {note && <Msg kind={note.kind}>{note.text}</Msg>}
      {codes && <Codes codes={codes} />}

      <div className="set-grid">
        <form className="card col set-card" onSubmit={onName} aria-labelledby="t-prof">
          <h2 id="t-prof">{t('Profil')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{me?.email}</p>
          <label className="field">{t('Nom')}<input className="input" value={name} maxLength={120} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
          <button className="btn" disabled={busy || !name.trim() || name.trim() === me?.name}>{t('Enregistrer le nom')}</button>
        </form>

        <section id="mot-de-passe" className="card col set-card" aria-labelledby="t-pw">
          <h2 id="t-pw">{t('Mot de passe')}</h2>
          {google ? (
            pwSent ? <p className="small muted" style={{ margin: 0 }}>{t('Lien envoyé : regardez vos e-mails.')}</p> : <>
              <p className="small muted" style={{ margin: 0 }}>{t('Votre compte a été créé avec Google : il n’a pas de mot de passe. Créez-en un pour pouvoir aussi vous connecter avec votre e-mail.')}</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={sendLink}>{t('Créer un mot de passe')}</button>
            </>
          ) : (
            <form className="col" style={{ gap: 10 }} onSubmit={onPw}>
              <label className="field">{t('Mot de passe actuel')}<input className="input" type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></label>
              <label className="field">{t('Nouveau mot de passe')}<input className="input" type="password" value={pw.next} minLength={8} onChange={e => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
                <span className="field-hint">{t('8 caractères au moins.')}</span></label>
              <button className="btn btn-primary" disabled={busy || !pw.current || pw.next.length < 8}>{t('Changer le mot de passe')}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={sendLink}>{t('Mot de passe oublié ? Recevoir un lien')}</button>
            </form>
          )}
        </section>

        <section id="2fa" className="card col set-card" aria-labelledby="t-2fa">
          <h2 id="t-2fa">{t('Double authentification')}</h2>
          {!tf ? <p className="small muted" style={{ margin: 0 }}>—</p> : tf.totp_enabled ? (
            <>
              <p className="small" style={{ margin: 0 }}><span className="status-ok strong">{t('Activée')}</span> · {tf.recovery_remaining > 1 ? t('{n} codes de secours restants.', { n: tf.recovery_remaining }) : t('{n} code de secours restant.', { n: tf.recovery_remaining })}</p>
              <label className="field">{t('Code de l’application d’authentification')}
                <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={8} onChange={e => setCode(e.target.value)} placeholder="123456" /></label>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" disabled={busy || !code.trim()} onClick={regen}>{t('Nouveaux codes de secours')}</button>
                {!tf.required && <button type="button" className="btn btn-danger" disabled={busy || !code.trim()} onClick={disable}>{t('Désactiver')}</button>}
              </div>
            </>
          ) : setup ? (
            <form className="col" style={{ gap: 10 }} onSubmit={enable}>
              <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>{t('Dans votre application d’authentification (Google Authenticator, 1Password…), ajoutez un compte avec cette clé :')}</li>
              </ol>
              <code className="secret">{setup.secret}</code>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(setup.secret)}>{t('Copier la clé')}</button>
                <a className="btn btn-sm" href={setup.otpauth_uri}><Icon name="external" size={16} />{t('Ouvrir l’application')}</a>
              </div>
              <label className="field">{t('2. Code affiché par l’application')}
                <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={8} onChange={e => setCode(e.target.value)} placeholder="123456" autoFocus /></label>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={busy || code.trim().length < 6}>{t('Activer')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>{t('Annuler')}</button>
              </div>
            </form>
          ) : (
            <>
              <p className="small muted" style={{ margin: 0 }}>{t('Un code de votre téléphone en plus du mot de passe, à chaque connexion.')}</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={startTotp}>{t('Activer la double authentification')}</button>
            </>
          )}
          {keys.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <span className="small strong">{t('Clés d’accès')}</span>
              <ul className="list">{keys.map(k => (
                <li key={k.id}>
                  <span className="grow col" style={{ gap: 0 }}><span>{k.name || t('Clé d’accès')}</span>
                    <span className="tiny muted">{k.last_used_at ? t('Utilisée {ago}', { ago: fmtAgo(k.last_used_at) }) : t('Jamais utilisée')}</span></span>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => dropKey(k)}>{t('Retirer')}</button>
                </li>
              ))}</ul>
            </div>
          )}
        </section>

        <section id="supprimer" className="card col set-card set-danger" aria-labelledby="t-data">
          <h2 id="t-data">{t('Mes données')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Link to="/privacy" className="btn btn-sm"><Icon name="shield" size={16} />{t('Politique de confidentialité')}</Link>
            <Link to="/terms" className="btn btn-sm"><Icon name="external" size={16} />{t('Conditions d’utilisation')}</Link>
          </div>
          <button type="button" className="btn btn-danger" onClick={askDelete}><Icon name="trash" />{t('Supprimer mon compte')}</button>
        </section>
      </div>
    </div>
  )
}
