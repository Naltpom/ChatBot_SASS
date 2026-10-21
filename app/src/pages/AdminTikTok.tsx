// Back-office — module TikTok, LECTURE SEULE (GET /api/admin/tiktok/overview) :
// comptes connectés et publications (30 j) par tenant. Aucun jeton, aucune
// action : l'usage se fait dans l'Espace client de chaque client.
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Card, Chip, InfoBox, SectionTitle, Stat } from '../ui'

interface TenantRow {
  tenant: string
  kind: 'team' | 'personal'
  accounts: number
  needs_reconnect: number
  posts_30d: number
  published_30d: number
  failed_30d: number
}
interface Overview { enabled: boolean; total_accounts: number; total_posts_30d: number; tenants: TenantRow[] }

export default function AdminTikTok() {
  const { data, loading, error, reload } = useApiResource<Overview>('/api/admin/tiktok/overview')
  const title = <SectionTitle sub="Usage du module de publication TikTok par les clients (lecture seule).">TikTok</SectionTitle>

  if (error) return <div className="col g18">{title}<ErrorRetry message={error} onRetry={reload} title="Impossible de charger les données" /></div>
  if (loading || !data) return <div className="center-page">Chargement…</div>

  return (
    <div className="col g18">
      {title}
      {!data.enabled && <InfoBox tone="warn">Module désactivé : TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET absents de l'environnement de l'API.</InfoBox>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Stat label="Comptes TikTok connectés" value={data.total_accounts} />
        <Stat label="Publications (30 j)" value={data.total_posts_30d} />
        <Stat label="Clients utilisateurs" value={data.tenants.filter(t => t.accounts > 0).length} />
      </div>
      <Card nopad>
        {data.tenants.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13.5 }}>Aucun client n'a encore connecté de compte TikTok.</p>
        ) : (
          <div className="table-scroll">
            <table className="kc">
              <thead>
                <tr><th>Client</th><th>Comptes</th><th>À reconnecter</th><th>Publications 30 j</th><th>Réussies</th><th>Échecs</th></tr>
              </thead>
              <tbody>
                {data.tenants.map(t => (
                  <tr key={`${t.kind}-${t.tenant}`}>
                    <td>{t.tenant} <Chip tone="mut">{t.kind === 'team' ? 'Équipe' : 'Perso'}</Chip></td>
                    <td>{t.accounts}</td>
                    <td>{t.needs_reconnect || '—'}</td>
                    <td>{t.posts_30d}</td>
                    <td>{t.published_30d}</td>
                    <td>{t.failed_30d || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
