// Inscription — portée de « Chapote - Inscription.html » (design) :
// type Personnel / Entreprise (même architecture, juste le type), infos,
// invitations d'équipe (entreprise), succès → application.
import { useState } from 'react'
import { Building2, Check, User as UserIcon, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

interface Invite { email: string; role: 'admin' | 'member' }

function Shell({ children, step, total }: { children: React.ReactNode; step?: number; total?: number }) {
  return (
    <div className="landing" style={{ minHeight: '100vh' }}>
      <div className="page-blobs"><div className="b b1" /><div className="b b2" /></div>
      <div className="l-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 20px' }}>
        <div style={{ width: '100%', maxWidth: 660, padding: '26px 0 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'var(--l-ink)' }}>
            <img src="/brand/icon.svg" alt="" style={{ width: 30, height: 30, borderRadius: 8 }} />
            <span className="font-display" style={{ fontWeight: 700, fontSize: 16 }}>Chapote</span>
          </Link>
          <Link to="/login" style={{ fontSize: 13, fontWeight: 600, color: 'var(--l-muted)', textDecoration: 'none' }}>
            Déjà un compte ? <span style={{ color: 'var(--l-teal-deep)' }}>Se connecter</span>
          </Link>
        </div>
        {step != null && total != null && (
          <div style={{ width: '100%', maxWidth: 660, display: 'flex', gap: 6, margin: '6px 0 22px' }}>
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i <= step ? 'var(--l-teal)' : '#d4e6e1' }} />
            ))}
          </div>
        )}
        <div style={{ width: '100%', maxWidth: 660, paddingBottom: 60 }}>{children}</div>
      </div>
    </div>
  )
}

function LCard({ children }: { children: React.ReactNode }) {
  return <div className="l-card shadow-md" style={{ padding: '30px 30px' }}>{children}</div>
}

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [type, setType] = useState<'perso' | 'entreprise' | null>(null)
  const [form, setForm] = useState({ prenom: '', nom: '', email: '', pwd: '', org: '' })
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const totalSteps = type === 'entreprise' ? 3 : 2
  const canSubmitInfo = !!(form.prenom.trim() && form.email.includes('@') && form.pwd.length >= 8
    && (type === 'perso' || form.org.trim()))

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
      setStep(3)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---------- Étape 0 : type de compte ----------
  if (step === 0) return (
    <Shell step={0} total={totalSteps || 2}>
      <h1 className="font-display" style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, lineHeight: 1.05, margin: '8px 0 8px' }}>
        Créez votre compte
      </h1>
      <p style={{ color: 'var(--l-ink2)', fontSize: 15, margin: '0 0 26px' }}>
        Même produit dans les deux cas — vous pourrez passer en entreprise plus tard.
      </p>
      <div className="l-grid2">
        {[
          {
            v: 'perso' as const, icon: <UserIcon size={26} />, t: 'Personnel',
            d: 'Vous travaillez seul·e sur vos chatbots. Freelance, indépendant, side-project.',
            pts: ['Tous les plans disponibles', 'Juste vous dans l\'espace', 'Convertible en entreprise'],
          },
          {
            v: 'entreprise' as const, icon: <Building2 size={26} />, t: 'Entreprise',
            d: 'Vous travaillez en équipe. Agence, PME, collectivité.',
            pts: ['Invitez par e-mail', 'Rôles admin / membre', 'Permissions fines par bot'],
          },
        ].map(o => (
          <button key={o.v} onClick={() => { setType(o.v); setStep(1) }} style={{
            fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', background: '#fff',
            border: `2px solid ${type === o.v ? 'var(--l-teal)' : 'var(--l-line)'}`, borderRadius: 18,
            padding: '26px 24px', transition: 'border-color .15s, transform .15s',
          }} className="shadow-md">
            <span style={{ color: 'var(--l-teal)' }}>{o.icon}</span>
            <div className="font-display" style={{ fontSize: 21, fontWeight: 700, margin: '10px 0 6px' }}>{o.t}</div>
            <div style={{ fontSize: 13.5, color: 'var(--l-ink2)', lineHeight: 1.55, marginBottom: 14 }}>{o.d}</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {o.pts.map(p => (
                <li key={p} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--l-ink2)', alignItems: 'center' }}>
                  <Check size={13} style={{ color: 'var(--l-teal)', flexShrink: 0 }} strokeWidth={3} />{p}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </Shell>
  )

  // ---------- Étape 1 : informations ----------
  if (step === 1) return (
    <Shell step={1} total={totalSteps}>
      <h1 className="font-display" style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 6px' }}>
        {type === 'entreprise' ? 'Votre entreprise' : 'Vos informations'}
      </h1>
      <p style={{ color: 'var(--l-ink2)', fontSize: 14.5, margin: '0 0 22px' }}>
        {type === 'entreprise'
          ? "Vous serez administrateur de l'espace — vous inviterez l'équipe à l'étape suivante."
          : 'Votre espace personnel sera créé avec vous comme administrateur.'}
      </p>
      <LCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {type === 'entreprise' && (
            <label><span className="l-lbl">Nom de l'entreprise *</span>
              <input className="l-input" value={form.org} onChange={e => set('org', e.target.value)} placeholder="Agence Webly" />
            </label>
          )}
          <div className="l-grid2" style={{ gap: 12 }}>
            <label><span className="l-lbl">Prénom *</span>
              <input className="l-input" value={form.prenom} onChange={e => set('prenom', e.target.value)} placeholder="Théo" />
            </label>
            <label><span className="l-lbl">Nom</span>
              <input className="l-input" value={form.nom} onChange={e => set('nom', e.target.value)} placeholder="Rousseau" />
            </label>
          </div>
          <label><span className="l-lbl">E-mail professionnel *</span>
            <input className="l-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="theo@exemple.fr" />
          </label>
          <label><span className="l-lbl">Mot de passe * <span style={{ fontWeight: 500, color: 'var(--l-muted)' }}>(8 caractères min.)</span></span>
            <input className="l-input" type="password" value={form.pwd} onChange={e => set('pwd', e.target.value)} placeholder="••••••••" />
          </label>
        </div>
      </LCard>
      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button className="l-btn l-btn-ghost" onClick={() => setStep(0)}>← Retour</button>
        <button className="l-btn l-btn-primary" disabled={!canSubmitInfo || busy}
                onClick={() => type === 'entreprise' ? setStep(2) : submit()}>
          {busy ? '…' : type === 'entreprise' ? 'Continuer →' : 'Créer mon compte →'}
        </button>
      </div>
    </Shell>
  )

  // ---------- Étape 2 (entreprise) : inviter l'équipe ----------
  if (step === 2) return (
    <Shell step={2} total={totalSteps}>
      <h1 className="font-display" style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 6px' }}>Invitez votre équipe</h1>
      <p style={{ color: 'var(--l-ink2)', fontSize: 14.5, margin: '0 0 22px' }}>
        Ils rejoindront <strong>{form.org || 'votre espace'}</strong> dès la création de leur compte.
        Vous pourrez ensuite affiner leurs permissions bot par bot.
      </p>
      <LCard>
        <div style={{ display: 'flex', gap: 9, marginBottom: invites.length ? 16 : 0, flexWrap: 'wrap' }}>
          <input className="l-input" style={{ flex: 1, minWidth: 200 }} type="email" value={inviteEmail}
                 onChange={e => setInviteEmail(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && addInvite()}
                 placeholder="collegue@entreprise.fr" />
          <select className="l-input" style={{ width: 130 }} value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}>
            <option value="member">Membre</option>
            <option value="admin">Admin</option>
          </select>
          <button className="l-btn l-btn-primary" onClick={addInvite} style={{ padding: '11px 18px' }}>Inviter</button>
        </div>
        {invites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {invites.map(i => (
              <div key={i.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--l-line)', background: '#f6fbf9' }}>
                <span style={{ width: 26, height: 26, borderRadius: 99, background: 'var(--l-teal-soft)', color: 'var(--l-teal-deep)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>
                  {i.email[0].toUpperCase()}
                </span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{i.email}</span>
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 99,
                  background: i.role === 'admin' ? '#f7eed9' : 'var(--l-teal-soft)',
                  color: i.role === 'admin' ? '#b06f0e' : 'var(--l-teal-deep)',
                }}>{i.role === 'admin' ? 'Admin' : 'Membre'}</span>
                <button onClick={() => setInvites(invites.filter(x => x.email !== i.email))}
                        style={{ border: 'none', background: 'none', color: 'var(--l-muted)', cursor: 'pointer', padding: 2 }}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--l-muted)', lineHeight: 1.6 }}>
          <strong>Admin</strong> : tout gérer (bots, équipe). <strong>Membre</strong> : permissions au choix,
          par bot — copier le script, tester, modifier l'apparence, modifier le contexte…
        </div>
      </LCard>
      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button className="l-btn l-btn-ghost" onClick={() => setStep(1)}>← Retour</button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="l-btn l-btn-ghost" disabled={busy} onClick={() => { setInvites([]); submit() }}>Passer</button>
          <button className="l-btn l-btn-primary" disabled={busy} onClick={submit}>
            {busy ? '…' : 'Créer mon compte →'}
          </button>
        </div>
      </div>
    </Shell>
  )

  // ---------- Étape 3 : succès ----------
  return (
    <Shell>
      <div style={{ textAlign: 'center', paddingTop: 30 }}>
        <div style={{
          width: 76, height: 76, borderRadius: 99, margin: '0 auto 20px',
          background: 'linear-gradient(135deg,#12a392,#0b7d72)', color: '#fff',
          display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px rgba(13,148,136,.35)',
        }}><Check size={34} strokeWidth={3} /></div>
        <h1 className="font-display" style={{ fontSize: 34, fontWeight: 800, margin: '0 0 10px' }}>
          Bienvenue{form.prenom ? `, ${form.prenom}` : ''} !
        </h1>
        <p style={{ color: 'var(--l-ink2)', fontSize: 15.5, margin: '0 0 8px' }}>
          {type === 'entreprise'
            ? <span>L'espace <strong>{form.org || 'entreprise'}</strong> est créé{invites.length > 0 ? ` — ${invites.length} invitation${invites.length > 1 ? 's' : ''} en attente` : ''}.</span>
            : <span>Votre espace personnel est prêt.</span>}
        </p>
        <p style={{ color: 'var(--l-muted)', fontSize: 13.5, margin: '0 0 28px' }}>
          Prochaine étape : créer votre premier chatbot (2 minutes, promis).
        </p>
        <button className="l-btn l-btn-primary" style={{ fontSize: 15.5, padding: '14px 28px' }}
                onClick={() => navigate('/app')}>
          Ouvrir l'application →
        </button>
      </div>
    </Shell>
  )
}
