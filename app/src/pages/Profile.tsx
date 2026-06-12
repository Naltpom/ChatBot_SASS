// Page Profil — sobre et utile : nom éditable, infos compte en lecture seule,
// changement de mot de passe (comptes LOCAUX uniquement, les comptes intranet
// sont gérés par l'intranet Kertios).
import { useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle } from '../ui'

function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 12.5, textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  )
}

export default function Profile() {
  const { user, refreshUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState('')

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwDone, setPwDone] = useState(false)
  const [pwError, setPwError] = useState('')

  if (!user) return null
  const intranet = user.auth_source === 'intranet'
  const nameClean = name.trim()
  const nameDirty = nameClean !== '' && nameClean !== user.name

  async function saveName() {
    setNameError('')
    setSavingName(true)
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { name: nameClean } })
      await refreshUser()
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } catch (err: any) {
      setNameError(err.message)
    } finally {
      setSavingName(false)
    }
  }

  async function changePassword() {
    setPwError('')
    setPwDone(false)
    if (newPw.length < 8) { setPwError('8 caractères minimum'); return }
    if (confirmPw !== newPw) { setPwError('Les deux saisies ne correspondent pas'); return }
    setSavingPw(true)
    try {
      await api('/api/auth/password', { method: 'POST', body: { current_password: curPw, new_password: newPw } })
      setPwDone(true)
      setCurPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      setPwError(err.message)
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <div className="col g18">
      <SectionTitle sub={user.email}>Profil</SectionTitle>

      <div className="grid2">
        <Card>
          <div className="card-title">Informations du compte</div>
          <Field label="Nom">
            <div className="row g8">
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && nameDirty && !savingName && saveName()}
                     style={{ flex: 1 }} />
              <Btn small kind="soft" onClick={saveName} disabled={!nameDirty || savingName}>
                {nameSaved ? <><Check size={13} /> Enregistré</> : 'Mettre à jour'}
              </Btn>
            </div>
          </Field>
          {nameError && <div className="error" style={{ marginTop: 8 }}>{nameError}</div>}

          <div style={{ marginTop: 14 }}>
            <InfoRow label="Email"><span className="mono" style={{ fontSize: 11.5 }}>{user.email}</span></InfoRow>
            <InfoRow label="Authentification">
              {intranet ? <Chip tone="acc">Intranet Kertios</Chip> : <Chip tone="mut">Compte local</Chip>}
            </InfoRow>
            <InfoRow label="Rôle">
              {user.is_superadmin
                ? <Chip tone="acc"><ShieldCheck size={12} /> Staff Kertios</Chip>
                : <Chip tone="mut">Client</Chip>}
            </InfoRow>
            <InfoRow label="Membre depuis">{fmtDate(user.created_at)}</InfoRow>
            <InfoRow label="Dernière connexion">{fmtDate(user.last_login)}</InfoRow>
          </div>
        </Card>

        <Card>
          <div className="card-title">Mot de passe</div>
          {intranet ? (
            <InfoBox tone="info" title="Compte intranet">
              Votre mot de passe est géré par l'intranet Kertios. Modifiez-le là-bas — il sera
              pris en compte ici à votre prochaine connexion.
            </InfoBox>
          ) : (
            <div className="col" style={{ gap: 11 }}>
              <Field label="Mot de passe actuel">
                <input type="password" value={curPw} autoComplete="current-password"
                       onChange={e => setCurPw(e.target.value)} />
              </Field>
              <Field label="Nouveau mot de passe" hint="8 caractères minimum">
                <input type="password" value={newPw} autoComplete="new-password"
                       onChange={e => setNewPw(e.target.value)} />
              </Field>
              <Field label="Confirmation">
                <input type="password" value={confirmPw} autoComplete="new-password"
                       onChange={e => setConfirmPw(e.target.value)} />
              </Field>
              {pwError && <div className="error">{pwError}</div>}
              {pwDone && <InfoBox tone="go">Mot de passe modifié.</InfoBox>}
              <div>
                <Btn onClick={changePassword} disabled={savingPw || !curPw || !newPw || !confirmPw}>
                  {savingPw ? 'Modification…' : 'Modifier le mot de passe'}
                </Btn>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
