// Inscription — design Chapote (carte centrée sur fond dégradé, stepper).
import { Fragment, useState } from 'react'
import { Building2, Check, User as UserIcon, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { errMsg } from '../utils/errors'
import HatIcon from '../components/HatIcon'
import { PASSWORD_MIN_LENGTH } from '../components/AuthShell'

interface Invite { email: string; role: 'admin' | 'member' }
interface RegisterForm { prenom: string; nom: string; email: string; pwd: string; org: string }

// Validation e-mail raisonnable (un seul @, un domaine avec point, pas
// d'espaces). Volontairement permissive (pas de RFC complète) pour ne pas
// rejeter de vrais e-mails.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CLASH = "'Clash Display',sans-serif"
const NAVY = '#1C3F5C'
const MINT = '#2F9E79'

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46, border: '1px solid #D8DEE6', borderRadius: 12,
  padding: '0 14px', fontSize: 15, color: '#1E2A32', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: '#1E2A32' }
const btnPrimary: React.CSSProperties = {
  background: NAVY, color: '#fff', border: 'none', borderRadius: 12, padding: '13px 22px',
  fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none',
}
const btnGhost: React.CSSProperties = {
  background: '#fff', color: NAVY, border: '1px solid #D8DEE6', borderRadius: 12, padding: '13px 22px',
  fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
}

function StepDot({ on, n }: { on: boolean; n: number }) {
  return (
    <span style={{
      width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 13, flexShrink: 0,
      background: on ? NAVY : '#E2E8F0', color: on ? '#fff' : '#9AA7B4', transition: 'all .25s',
    }}>{n}</span>
  )
}

function Shell({ children, step, total, caption, maxWidth = 560 }: {
  children: React.ReactNode; step?: number; total?: number; caption?: string; maxWidth?: number
}) {
  const isMobile = useIsMobile(760)
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter',system-ui,sans-serif", color: '#1E2A32', padding: isMobile ? 14 : 32,
      background: 'radial-gradient(circle at 15% 18%, rgba(47,158,121,.08), transparent 45%),radial-gradient(circle at 85% 28%, rgba(140,109,255,.07), transparent 45%),#F0F2F5',
    }}>
      <div style={{
        width: '100%', maxWidth: isMobile ? '100%' : maxWidth, background: '#fff',
        borderRadius: isMobile ? 18 : 24, boxShadow: '0 44px 100px -44px rgba(28,63,92,.42)',
        padding: isMobile ? '26px 20px 24px' : '40px 40px 36px',
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={19} color="#fff" /></span>
          <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 20, color: '#1E2A32' }}>Chapote</span>
        </Link>
        {step != null && total != null && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '26px auto 6px', maxWidth: 280 }}>
              {Array.from({ length: total }).map((_, i) => (
                <Fragment key={i}>
                  {i > 0 && <span style={{ flex: 1, height: 2, background: i <= step ? MINT : '#E2E8F0', transition: 'background .25s' }} />}
                  <StepDot on={i <= step} n={i + 1} />
                </Fragment>
              ))}
            </div>
            {caption && (
              <div style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#9AA7B4', letterSpacing: '.03em', marginBottom: 24 }}>
                {caption}
              </div>
            )}
          </>
        )}
        {children}
      </div>
    </div>
  )
}

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const isMobile = useIsMobile(760)

  const [step, setStep] = useState(0)
  const [type, setType] = useState<'perso' | 'entreprise' | null>(null)
  const [form, setForm] = useState<RegisterForm>({ prenom: '', nom: '', email: '', pwd: '', org: '' })
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof RegisterForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Stepper : on compte le choix du type, les informations, [l'invitation
  // équipe] puis l'écran « C'est prêt ! ».
  const totalDots = type === 'entreprise' ? 4 : 3
  const stepCaption = (i: number) => `Étape ${i + 1} sur ${totalDots} — ${i + 1 === totalDots ? "C'est prêt !" : i === 0 ? 'Type de compte' : i === 1 ? 'Votre compte' : 'Votre équipe'}`
  const emailValid = EMAIL_RE.test(form.email.trim())
  const canSubmitInfo = !!(form.prenom.trim() && emailValid && form.pwd.length >= PASSWORD_MIN_LENGTH
    && (type === 'perso' || form.org.trim()))

  // Liste explicite de ce qui manque pour activer « Créer mon compte » : le
  // bouton désactivé seul n'indique pas POURQUOI. Affichée sous le
  // formulaire (aria-live) tant que la saisie est incomplète.
  const missingFields = (() => {
    const m: string[] = []
    if (type === 'entreprise' && !form.org.trim()) m.push("le nom de l'entreprise")
    if (!form.prenom.trim()) m.push('le prénom')
    if (!form.email.trim()) m.push("l'e-mail")
    else if (!emailValid) m.push('un e-mail valide')
    if (form.pwd.length < PASSWORD_MIN_LENGTH) m.push(`un mot de passe d'au moins ${PASSWORD_MIN_LENGTH} caractères`)
    return m
  })()

  function addInvite() {
    const e = inviteEmail.trim().toLowerCase()
    if (e.includes('@') && !invites.find(i => i.email === e)) {
      setInvites([...invites, { email: e, role: inviteRole }])
      setInviteEmail('')
    }
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await register({
        email: form.email.trim(),
        password: form.pwd,
        name: `${form.prenom.trim()} ${form.nom.trim()}`.trim(),
        account_type: type!,
        organization_name: type === 'entreprise' ? form.org.trim() : undefined,
        invites: type === 'entreprise' ? invites : [],
      })
      // Retour OAuth en attente (plugin WordPress) : Authorize mémorise
      // /authorize?… dans cbsaas_after_login avant de rediriger un visiteur NON
      // connecté vers l'inscription. Un nouvel inscrit doit reprendre CETTE boucle
      // (écran de consentement « Autoriser ce site ») au lieu de l'écran de succès
      // générique — sinon les paramètres OAuth sont perdus (« Lien incomplet »).
      // Même clé + consommation one-shot que Login (postLoginDest). Sans retour
      // mémorisé : comportement inchangé (écran de succès -> /app). Fonctionne aussi
      // en popup OAuth (la popup rejoue /authorize puis se referme après « Autoriser »).
      let afterAuth: string | null = null
      try { afterAuth = sessionStorage.getItem('cbsaas_after_login') } catch { /* storage off */ }
      if (afterAuth) {
        sessionStorage.removeItem('cbsaas_after_login')
        navigate(afterAuth)
        return
      }
      setStep(3)
    } catch (err: unknown) {
      setError(errMsg(err, 'Inscription impossible.'))
    } finally {
      setBusy(false)
    }
  }

  const errBox = error && (
    <div role="alert" style={{ marginTop: 14, background: 'rgba(232,106,95,.08)', color: '#C4524A', border: '1px solid rgba(232,106,95,.3)', borderRadius: 11, padding: '10px 13px', fontSize: 13 }}>{error}</div>
  )

  // ---------- Étape 0 : type de compte ----------
  if (step === 0) return (
    <Shell step={0} total={totalDots} caption={stepCaption(0)} maxWidth={680}>
      <h1 style={{ fontFamily: CLASH, fontSize: 26, fontWeight: 600, textAlign: 'center', margin: '6px 0 6px' }}>Créez votre compte</h1>
      <p style={{ textAlign: 'center', color: '#6B7B8D', fontSize: 14.5, margin: '0 0 24px' }}>
        Même produit dans les deux cas — vous pourrez créer une équipe plus tard.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        {[
          {
            v: 'perso' as const, icon: <UserIcon size={24} />, t: 'Personnel',
            d: 'Vous travaillez seul·e. Freelance, indépendant, side-project.',
            pts: ['Chatbots personnels', 'Aucune équipe à gérer', 'Créez une équipe quand vous voulez'],
          },
          {
            v: 'entreprise' as const, icon: <Building2 size={24} />, t: 'Entreprise',
            d: 'Vous travaillez en équipe. Agence, PME, collectivité.',
            pts: ['Invitez par e-mail', 'Rôles admin / membre', 'Permissions fines par bot'],
          },
        ].map(o => (
          <button key={o.v} onClick={() => { setType(o.v); setStep(1) }} style={{
            fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', background: '#fff',
            border: `2px solid ${type === o.v ? MINT : '#E2E8F0'}`, borderRadius: 18,
            padding: '24px 22px', transition: 'border-color .15s, transform .15s',
          }}>
            <span style={{ color: NAVY }}>{o.icon}</span>
            <div style={{ fontFamily: CLASH, fontSize: 20, fontWeight: 600, margin: '10px 0 6px' }}>{o.t}</div>
            <div style={{ fontSize: 13.5, color: '#6B7B8D', lineHeight: 1.55, marginBottom: 14 }}>{o.d}</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {o.pts.map(p => (
                <li key={p} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: '#1E2A32', alignItems: 'center' }}>
                  <Check size={13} style={{ color: MINT, flexShrink: 0 }} strokeWidth={3} />{p}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7B8D', margin: '22px 0 0' }}>
        Déjà un compte ? <Link to="/login" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none' }}>Se connecter</Link>
      </p>
    </Shell>
  )

  // ---------- Étape 1 : informations ----------
  if (step === 1) return (
    <Shell step={1} total={totalDots} caption={stepCaption(1)}>
      <h1 style={{ fontFamily: CLASH, fontSize: 25, fontWeight: 600, margin: '6px 0 6px', textAlign: 'center' }}>
        {type === 'entreprise' ? 'Votre entreprise' : 'Vos informations'}
      </h1>
      <p style={{ color: '#6B7B8D', fontSize: 14, margin: '0 0 22px', textAlign: 'center' }}>
        {type === 'entreprise'
          ? "Vous serez administrateur — vous inviterez l'équipe à l'étape suivante."
          : 'Vous pourrez créer des chatbots personnels tout de suite — une équipe n\'est pas nécessaire.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        {type === 'entreprise' && (
          <label><span style={lbl}>Nom de l'entreprise *</span>
            <input style={inputStyle} value={form.org} onChange={e => set('org', e.target.value)} placeholder="Agence Webly" />
          </label>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <label><span style={lbl}>Prénom *</span>
            <input style={inputStyle} value={form.prenom} onChange={e => set('prenom', e.target.value)} placeholder="Théo" />
          </label>
          <label><span style={lbl}>Nom</span>
            <input style={inputStyle} value={form.nom} onChange={e => set('nom', e.target.value)} placeholder="Rousseau" />
          </label>
        </div>
        <label><span style={lbl}>E-mail professionnel *</span>
          <input style={inputStyle} type="email" autoComplete="email" inputMode="email"
                 aria-invalid={form.email.trim() !== '' && !emailValid}
                 value={form.email} onChange={e => set('email', e.target.value)} placeholder="theo@exemple.fr" />
          {form.email.trim() !== '' && !emailValid && (
            <span style={{ display: 'block', marginTop: 6, fontSize: 12.5, color: '#C4524A' }}>
              Entrez une adresse e-mail valide (ex. nom@domaine.fr).
            </span>
          )}
        </label>
        <label><span style={lbl}>Mot de passe * <span style={{ fontWeight: 500, color: '#9AA7B4' }}>(8 caractères min.)</span></span>
          <input style={inputStyle} type="password" value={form.pwd} onChange={e => set('pwd', e.target.value)} placeholder="••••••••" />
        </label>
      </div>
      {errBox}
      {!canSubmitInfo && missingFields.length > 0 && (
        <p aria-live="polite" style={{ marginTop: 14, fontSize: 12.5, color: '#9AA7B4', lineHeight: 1.55 }}>
          Pour continuer, renseignez {missingFields.join(', ')}.
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button style={btnGhost} onClick={() => setStep(0)}>← Retour</button>
        <button style={{ ...btnPrimary, opacity: (!canSubmitInfo || busy) ? .5 : 1 }} disabled={!canSubmitInfo || busy}
                onClick={() => type === 'entreprise' ? setStep(2) : submit()}>
          {busy ? '…' : type === 'entreprise' ? 'Continuer →' : 'Créer mon compte →'}
        </button>
      </div>
    </Shell>
  )

  // ---------- Étape 2 (entreprise) : inviter l'équipe ----------
  if (step === 2) return (
    <Shell step={2} total={totalDots} caption={stepCaption(2)}>
      <h1 style={{ fontFamily: CLASH, fontSize: 25, fontWeight: 600, margin: '6px 0 6px', textAlign: 'center' }}>Invitez votre équipe</h1>
      <p style={{ color: '#6B7B8D', fontSize: 14, margin: '0 0 22px', textAlign: 'center' }}>
        Ils rejoindront <strong>{form.org || 'votre espace'}</strong> dès la création de leur compte.
      </p>
      <div style={{ display: 'flex', gap: 9, marginBottom: invites.length ? 16 : 0, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} type="email" value={inviteEmail}
               onChange={e => setInviteEmail(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && addInvite()}
               aria-label="E-mail du collègue à inviter"
               placeholder="collegue@entreprise.fr" />
        <select style={{ ...inputStyle, width: 130, cursor: 'pointer' }} value={inviteRole}
                aria-label="Rôle de l'invité"
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}>
          <option value="member">Membre</option>
          <option value="admin">Admin</option>
        </select>
        <button style={btnPrimary} onClick={addInvite}>Inviter</button>
      </div>
      {invites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {invites.map(i => (
            <div key={i.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 11, border: '1px solid #E8ECF0', background: '#FBFCFD' }}>
              <span style={{ width: 26, height: 26, borderRadius: 99, background: 'rgba(47,158,121,.12)', color: '#1C7A5C', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
                {i.email[0].toUpperCase()}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{i.email}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                background: i.role === 'admin' ? 'rgba(224,168,46,.16)' : 'rgba(47,158,121,.12)',
                color: i.role === 'admin' ? '#B5810F' : '#1C7A5C',
              }}>{i.role === 'admin' ? 'Admin' : 'Membre'}</span>
              <button onClick={() => setInvites(invites.filter(x => x.email !== i.email))}
                      style={{ border: 'none', background: 'none', color: '#9AA7B4', cursor: 'pointer', padding: 2 }}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 16, fontSize: 12, color: '#9AA7B4', lineHeight: 1.6 }}>
        <strong>Admin</strong> : tout gérer. <strong>Membre</strong> : permissions au choix, par bot.
      </div>
      {errBox}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button style={btnGhost} onClick={() => setStep(1)}>← Retour</button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ ...btnGhost, opacity: busy ? .5 : 1 }} disabled={busy} onClick={() => { setInvites([]); submit() }}>Passer</button>
          <button style={{ ...btnPrimary, opacity: busy ? .5 : 1 }} disabled={busy} onClick={submit}>
            {busy ? '…' : 'Créer mon compte →'}
          </button>
        </div>
      </div>
    </Shell>
  )

  // ---------- Étape 3 : succès → configurer le premier bot ----------
  return (
    <Shell step={totalDots - 1} total={totalDots} caption={stepCaption(totalDots - 1)}>
      <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
        <span style={{ width: 72, height: 72, borderRadius: 99, margin: '14px auto 0', background: 'rgba(47,158,121,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Check size={40} strokeWidth={2.6} style={{ color: MINT }} />
        </span>
        <h1 style={{ fontFamily: CLASH, fontSize: 26, fontWeight: 600, margin: '20px 0 0' }}>
          Compte créé 🎉
        </h1>
        <p style={{ color: '#6B7B8D', fontSize: 14.5, margin: '10px auto 0', maxWidth: 400, lineHeight: 1.55 }}>
          {type === 'entreprise'
            ? <span>L'espace <strong>{form.org || 'entreprise'}</strong> est prêt{invites.length > 0 ? ` — ${invites.length} invitation${invites.length > 1 ? 's' : ''} en attente` : ''}. Configurez votre premier bot, puis récupérez votre balise dans l'onglet Intégration.</span>
            : <span>Votre compte est prêt. Configurez votre premier bot personnel — arbre, IA, apparence — puis récupérez votre balise dans l'onglet Intégration.</span>}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 26 }}>
          <button style={{ ...btnPrimary, padding: '15px', fontSize: 15.5 }} onClick={() => navigate('/app/bots/new')}>
            Configurer mon premier bot →
          </button>
          <button style={{ background: 'transparent', border: 'none', color: '#6B7B8D', fontWeight: 600, fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit' }}
                  onClick={() => navigate('/app')}>
            Plus tard, aller au tableau de bord
          </button>
        </div>
      </div>
    </Shell>
  )
}
