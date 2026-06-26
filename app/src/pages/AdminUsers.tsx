// Utilisateurs (back-office) — GET /api/admin/users, page LECTURE SEULE
// (aucun endpoint de mutation utilisateur n'existe). Recherche client-side.
import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Card, Chip, SectionTitle } from '../ui'
import { formatFr } from '../utils/time'

interface AdminUser {
  id: number
  name: string
  email: string
  auth_source: string
  is_superadmin: boolean
  is_active: boolean
  last_login: string | null
}

function lastLogin(iso: string | null) {
  if (!iso) return <span style={{ color: 'var(--faint)' }}>jamais</span>
  // L'API renvoie un datetime UTC naïf : formatFr l'interprète comme UTC
  // (corrige le décalage de fuseau du new Date(iso) historique).
  return <>{formatFr(iso)}</>
}

export default function AdminUsers() {
  const { data: users, loading, error, reload } = useApiResource<AdminUser[]>('/api/admin/users')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!users) return []
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, query])

  if (error) {
    return (
      <div className="col g18">
        <SectionTitle>Utilisateurs</SectionTitle>
        <ErrorRetry message={error} onRetry={reload} title="Impossible de charger les utilisateurs" />
      </div>
    )
  }
  if (loading || !users) return <div className="center-page">Chargement…</div>

  return (
    <div className="col g18">
      <SectionTitle sub={`${users.length} compte${users.length > 1 ? 's' : ''}`}
                    right={
                      <input type="text" value={query} placeholder="Rechercher par nom ou email…"
                             onChange={e => setQuery(e.target.value)} style={{ width: 250 }} />
                    }>
        Utilisateurs
      </SectionTitle>

      <Card nopad>
        <div className="table-scroll">
<table className="kc">
          <thead>
            <tr>
              <th>Utilisateur</th><th>Authentification</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <span style={{ display: 'block', fontWeight: 700 }}>{u.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>{u.email}</span>
                </td>
                <td>{u.auth_source === 'intranet' ? <Chip tone="acc">Intranet</Chip> : <Chip tone="mut">Local</Chip>}</td>
                <td>
                  {u.is_superadmin
                    ? <Chip tone="acc"><ShieldCheck size={13} /> Staff</Chip>
                    : <Chip tone="mut">Client</Chip>}
                </td>
                <td>{u.is_active ? <Chip tone="go">Actif</Chip> : <Chip tone="danger">Désactivé</Chip>}</td>
                <td style={{ color: 'var(--mut)', whiteSpace: 'nowrap' }}>{lastLogin(u.last_login)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--faint)', padding: 18, textAlign: 'center' }}>
                Aucun compte ne correspond à « {query} ».
              </td></tr>
            )}
          </tbody>
        </table>
</div>
      </Card>
    </div>
  )
}
