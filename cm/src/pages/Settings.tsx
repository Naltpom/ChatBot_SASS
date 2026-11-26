// Réglages, comme dans l'app mobile, rangés par portée : moi (profil, sécurité, apparence), mon espace
// (comptes, partage, stockage, brouillons, nom de l'espace), les appareils où l'app est ouverte, puis la zone
// sensible. L'apparence (couleur, clair / sombre) est enregistrée sur le compte : le site et l'app la partagent.
import { LANGS, t, type LangPref } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { get2fa, getAiPublic, getDevices, getProfile, getProposalCount, removeDevice, saveProfile, ALL, type Device, type TwoFAStatus } from '../api'
import FeedbackSheet from '../components/FeedbackSheet'
import { Avatar, Icon, Msg, Seg, type IconName } from '../components/ui'
import { fmtAgo } from '../format'
import { getAppearance, PALETTES, setAppearance, THEMES, type Palette, type ThemePref } from '../palette'
import { useSession } from '../session'

function NavRow({ to, icon, label, value, badge }: { to: string; icon: IconName; label: string; value?: ReactNode; badge?: number }) {
  return (
    <Link to={to} className="set-row">
      <Icon name={icon} />
      <span className="grow">{label}</span>
      {!!badge && <span className="nav-badge" aria-label={`${badge} à voir`}>{badge}</span>}
      {value != null && <span className="small muted">{value}</span>}
      <Icon name="right" size={16} />
    </Link>
  )
}

export default function Settings() {
  const { me, accounts, invitations, spaces, refresh, signOut } = useSession()
  const nav = useNavigate()
  const { search, pathname } = useLocation()
  const [look, setLook] = useState(getAppearance)
  const [saved, setSaved] = useState(0)
  const [persoName, setPersoName] = useState('')
  const [tf, setTf] = useState<TwoFAStatus | null>(null)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [drafts, setDrafts] = useState(0)
  const [ai, setAi] = useState(false)
  const [feedback, setFeedback] = useState(() => new URLSearchParams(search).get('avis') === '1')
  const [err, setErr] = useState('')

  useEffect(() => {
    getProfile().then(p => setPersoName(p.perso_name === 'Espace perso' ? '' : p.perso_name)).catch(() => {})
    get2fa().then(setTf).catch(() => setTf(null))
    getDevices().then(setDevices).catch(() => setDevices(null))
    getProposalCount(ALL).then(r => setDrafts(r.open)).catch(() => {})
    getAiPublic().then(r => setAi(r.enabled)).catch(() => setAi(false))
    const sync = () => setLook(getAppearance())
    window.addEventListener('cm-appearance', sync)
    return () => window.removeEventListener('cm-appearance', sync)
  }, [])
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(0), 1800); return () => clearTimeout(t) }, [saved])
  const ok = () => setSaved(Date.now())
  const pick = (change: { palette?: Palette; theme?: ThemePref; language?: LangPref }) => { setLook(l => ({ ...l, ...change })); setAppearance(change).then(ok) }
  const savePerso = () => saveProfile(persoName.trim()).then(() => { refresh(); ok() }).catch(e => setErr((e as Error).message))
  const disconnect = async (d: Device) => {
    if (!window.confirm(`Déconnecter « ${d.name || 'Appareil'} » ? L’app y demandera de se reconnecter.`)) return
    try { await removeDevice(d.id); setDevices(x => (x || []).filter(y => y.id !== d.id)); ok() } catch (e) { setErr((e as Error).message) }
  }
  const closeFeedback = () => { setFeedback(false); if (search) nav(pathname, { replace: true }) }

  const perso = spaces.find(x => x.org_id == null)
  const storage = !perso?.storage || perso.storage.state === 'missing' ? 'À relier'
    : `${(perso.storage.used_bytes / 1e9).toFixed(1).replace('.', ',')} Go utilisés`
  const mine = accounts.filter(a => a.mine !== false).length

  return (
    <div className="settings">
      <div className="page-head"><div><h1>Réglages</h1><p>Les mêmes que dans l’app : un changement ici vaut aussi sur le téléphone.</p></div></div>
      {err && <Msg kind="err">{err}</Msg>}

      <Link to="/reglages/compte" className="card set-me">
        <Avatar src={me?.avatar_url} name={me?.name || me?.email} />
        <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong ellipsis">{me?.name}</span>
          <span className="small muted ellipsis">{me?.email}</span>
          <span className="small" style={{ color: 'var(--accent)' }}>Mot de passe, double authentification, mes données</span>
        </span>
        <Icon name="right" />
      </Link>

      <div className="set-grid">
        <section className="card col set-card" aria-labelledby="t-space">
          <h2 id="t-space">Mon espace</h2>
          <NavRow to="/comptes" icon="users" label="Comptes connectés" value={mine} />
          <NavRow to="/partage" icon="share" label="Personnes et partage" badge={invitations} />
          <NavRow to="/bibliotheque" icon="folder" label="Stockage Google Drive" value={storage} />
          <NavRow to="/a-valider" icon="layers" label="Brouillons à valider" badge={drafts} />
          <label className="field" style={{ marginTop: 8 }}>Nom de mon espace
            <input className="input" value={persoName} maxLength={80} onChange={e => setPersoName(e.target.value)} onBlur={savePerso}
                   onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="Espace perso" />
            <span className="field-hint">Visible par les personnes avec qui vous partagez un groupe.</span>
          </label>
        </section>

        <section className="card col set-card" aria-labelledby="t-look">
          <h2 id="t-look">Apparence</h2>
          <Seg<ThemePref> label="Thème" value={look.theme} onChange={v => pick({ theme: v })} options={THEMES.map(th => [th.id, th.label])} />
          <div className="small strong muted">{t('Langue')}</div>
          <Seg<LangPref> label={t('Langue')} value={look.language} onChange={v => pick({ language: v })} options={LANGS.map(l => [l.id, t(l.label)])} />
          <div className="small strong muted">Couleur de l’app</div>
          <div className="look-pick" role="radiogroup" aria-label="Couleur de l’app">
            {PALETTES.map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={look.palette === p.id} onClick={() => pick({ palette: p.id })}>
                <span className="sw" style={{ background: p.color }} aria-hidden="true" />
                <span className="strong">{p.label}</span>
                <span className="tiny muted">{p.id === 'warm' ? 'Par défaut' : p.id === 'ocean' ? 'Comme avant' : 'Nature'}</span>
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Enregistrée sur votre compte : l’app la reprend à l’ouverture et propose l’icône assortie.</p>
        </section>

        <section className="card col set-card" aria-labelledby="t-sec">
          <h2 id="t-sec">Sécurité</h2>
          <NavRow to="/reglages/compte#2fa" icon="shield" label="Double authentification" value={tf ? (tf.enabled ? 'Activée' : 'Désactivée') : undefined} />
          <NavRow to="/reglages/compte#mot-de-passe" icon="edit" label="Mot de passe" value={me?.auth_source === 'google' ? 'Compte Google' : undefined} />
          {ai && <NavRow to="/reglages/assistant-ia" icon="bolt" label="Assistant IA sur mes données" />}
        </section>

        <section className="card col set-card" aria-labelledby="t-dev">
          <h2 id="t-dev">Appareils connectés · {devices?.length ?? '—'}</h2>
          {devices == null ? <p className="small muted" style={{ margin: 0 }}>—</p>
            : devices.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Aucun téléphone : l’app Chapote CM est sur le Play Store.</p>
            : <ul className="list">{devices.map(d => (
              <li key={d.id}>
                <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                  <span className="ellipsis">{d.name || 'Appareil'}{d.push ? ' · notifications' : ''}</span>
                  <span className="tiny muted">{d.last_used_at ? `Utilisé ${fmtAgo(d.last_used_at)}` : ''}</span>
                </span>
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => disconnect(d)}>Déconnecter</button>
              </li>
            ))}</ul>}
        </section>

        <section className="card col set-card" aria-labelledby="t-help">
          <h2 id="t-help">Aide</h2>
          <button type="button" className="set-row" onClick={() => setFeedback(true)}><Icon name="comment" /><span className="grow">Donner mon avis</span><Icon name="right" size={16} /></button>
          <NavRow to="/privacy" icon="shield" label="Politique de confidentialité" />
          <NavRow to="/terms" icon="external" label="Conditions d’utilisation" />
        </section>

        <section className="card col set-card set-danger" aria-labelledby="t-danger">
          <h2 id="t-danger">Zone sensible</h2>
          <button type="button" className="btn btn-danger" onClick={() => { if (window.confirm('Se déconnecter ?')) signOut() }}><Icon name="logout" />Se déconnecter</button>
          <Link to="/reglages/compte#supprimer" className="btn btn-ghost btn-danger"><Icon name="trash" />Supprimer mon compte…</Link>
        </section>
      </div>
      <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>Chapote CM · cm.chapote.fr · même compte que chapote.fr</p>
      {saved > 0 && <div className="toast" role="status"><Icon name="check" size={16} />Enregistré</div>}
      {feedback && <FeedbackSheet onClose={closeFeedback} />}
    </div>
  )
}
