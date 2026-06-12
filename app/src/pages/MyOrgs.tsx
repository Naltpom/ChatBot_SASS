// Page « Mes organisations » — liste des orgs de l'utilisateur (rôle, plan,
// type), bascule d'org active, renommage / conversion perso→entreprise
// (admins), quitter une org (garde-fou dernier admin côté API), création.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Org, useAuth } from '../AuthContext'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg, orgColor, orgInitials } from '../ui'
import { PLAN_LABELS } from '../botConstants'

export default function MyOrgs() {
  const { user, activeOrg, setActiveOrg, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('entreprise')
  const [creating, setCreating] = useState(false)

  if (!user) return null
  const orgs = user.organizations
  const empty = orgs.length === 0

  async function rename(o: Org) {
    const name = renameValue.trim()
    if (!name) return
    setError('')
    try {
      await api(`/api/orgs/${o.id}`, { method: 'PATCH', body: { name } })
      setRenamingId(null)
      await refreshUser()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function convert(o: Org) {
    if (!window.confirm('Conversion définitive — une entreprise ne peut pas redevenir un compte personnel.')) return
    setError('')
    try {
      await api(`/api/orgs/${o.id}`, { method: 'PATCH', body: { type: 'entreprise' } })
      await refreshUser()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function leave(o: Org) {
    if (!window.confirm(`Quitter « ${o.name} » ? Vous perdrez l'accès à ses chatbots.`)) return
    setError('')
    try {
      await api(`/api/orgs/${o.id}/leave`, { method: 'POST' })
      await refreshUser() // si l'org quittée était active, pickActiveOrg rebascule
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function create() {
    const name = newName.trim()
    if (!name) return
    setError('')
    setCreating(true)
    try {
      const res = await api<{ id: number }>('/api/orgs', { method: 'POST', body: { name, type: newType } })
      localStorage.setItem('cbsaas_org', String(res.id))
      await refreshUser() // pickActiveOrg lit la clé → la nouvelle org devient active
      navigate('/app')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const createCard = (
    <Card style={empty ? { maxWidth: 460 } : undefined}>
      <div className="card-title">Créer une organisation</div>
      {empty && (
        <p style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55, margin: '0 0 12px' }}>
          Vous n'appartenez à aucune organisation pour l'instant. Créez la vôtre ci-dessous —
          ou attendez qu'un collègue vous invite : l'invitation s'applique au compte portant
          votre email.
        </p>
      )}
      <div className="col" style={{ gap: 11 }}>
        <Field label="Nom" hint="Personnel = un seul membre, convertible en entreprise plus tard.">
          <input type="text" value={newName} placeholder="ex. Studio Horizon"
                 onChange={e => setNewName(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && !creating && create()} />
        </Field>
        <div className="row g10" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Seg value={newType} onChange={setNewType}
               options={[{ value: 'perso', label: 'Personnel' }, { value: 'entreprise', label: 'Entreprise' }]} />
          <Btn onClick={create} disabled={creating || !newName.trim()}>
            {creating ? 'Création…' : 'Créer l\'organisation'}
          </Btn>
        </div>
      </div>
    </Card>
  )

  return (
    <div className="col g18">
      <SectionTitle sub={`${orgs.length} organisation${orgs.length > 1 ? 's' : ''}`}>Mes organisations</SectionTitle>

      {user.is_superadmin && (
        <InfoBox tone="info">
          Vue staff : vous voyez toutes les organisations de la plateforme. La gestion des
          clients se fait dans le back-office.
        </InfoBox>
      )}
      {error && <div className="error">{error}</div>}

      {!empty && (
        <Card nopad>
          {orgs.map((o, i) => {
            const isActive = o.id === activeOrg?.id
            const isAdmin = o.role === 'admin'
            const renaming = renamingId === o.id
            return (
              <div key={o.id} className="member-row"
                   style={{ borderBottom: i < orgs.length - 1 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                <span className="org-avatar" style={{ width: 32, height: 32, fontSize: 11, background: orgColor(o.name) }}>
                  {orgInitials(o.name)}
                </span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  {renaming ? (
                    <div className="row g8">
                      <input type="text" value={renameValue} autoFocus
                             onChange={e => setRenameValue(e.target.value)}
                             onKeyDown={e => { if (e.key === 'Enter') rename(o); if (e.key === 'Escape') setRenamingId(null) }}
                             style={{ flex: 1, maxWidth: 260, padding: '6px 10px', fontSize: 12.5 }} />
                      <Btn small onClick={() => rename(o)} disabled={!renameValue.trim()}>Valider</Btn>
                      <Btn small kind="ghost" onClick={() => setRenamingId(null)}>Annuler</Btn>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{o.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                        {o.type === 'perso' ? 'Personnel' : 'Entreprise'} · Plan {PLAN_LABELS[o.plan] || o.plan}
                      </div>
                    </>
                  )}
                </div>
                <Chip tone={isAdmin ? 'warn' : 'mut'}>{isAdmin ? 'Admin' : 'Membre'}</Chip>
                {isActive
                  ? <Chip tone="acc">active</Chip>
                  : <Btn kind="soft" small onClick={() => { setActiveOrg(o); navigate('/app') }}>Utiliser</Btn>}
                {isAdmin && !renaming && (
                  <Btn kind="ghost" small onClick={() => { setRenamingId(o.id); setRenameValue(o.name) }}>Renommer</Btn>
                )}
                {isAdmin && o.type === 'perso' && !renaming && (
                  <Btn kind="ghost" small onClick={() => convert(o)}>Passer en entreprise</Btn>
                )}
                {!user.is_superadmin && (
                  <Btn kind="danger" small onClick={() => leave(o)}>Quitter</Btn>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {createCard}
    </div>
  )
}
