// /app/youtube — module « Publication YouTube » (Shorts) de l'Espace client :
// connexion des chaînes (Google), liste des chaînes, historique des
// publications. La publication se fait dans le composer (/app/youtube/publish).
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { useApiResource } from '../../hooks/useApiResource'
import { ErrorRetry } from '../../components/ErrorRetry'
import { Btn, Card, Chip, InfoBox, SectionTitle, Seg } from '../../ui'
import { errMsg } from '../../utils/errors'
import {
  FINAL_STATUSES, PRIVACY_LABELS, STATUS_LABELS, STATUS_TONES, TXT, YouTubeAccount, YouTubeConfig, YouTubePost,
  fmtDate, useYouTubeSpace,
} from './common'

export default function YouTubePage() {
  const space = useYouTubeSpace()
  const [params] = useSearchParams()
  const config = useApiResource<YouTubeConfig>('/api/youtube/config')
  const accounts = useApiResource<YouTubeAccount[]>(`/api/youtube/accounts${space.query}`)
  const posts = useApiResource<YouTubePost[]>(`/api/youtube/posts${space.query}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    params.get('connected') ? `Chaîne YouTube « ${params.get('connected')} » connectée.` : null,
  )

  const pending = posts.data?.some(p => !FINAL_STATUSES.has(p.status))
  useEffect(() => {
    if (!pending) return
    const t = setInterval(posts.reload, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, space.query])

  const connect = async () => {
    setBusy('connect'); setError(null)
    try {
      const { authorize_url } = await api<{ authorize_url: string }>('/api/youtube/oauth/start', {
        method: 'POST', body: { org_id: space.orgId },
      })
      window.location.href = authorize_url
    } catch (e) {
      setError(errMsg(e)); setBusy(null)
    }
  }

  const disconnect = async (acc: YouTubeAccount) => {
    const name = acc.title || 'cette chaîne'
    if (!window.confirm(`Déconnecter ${name} ? L'autorisation sera révoquée chez Google et les jetons supprimés de Chapote.`)) return
    setBusy(`acc-${acc.id}`); setError(null); setNotice(null)
    try {
      const r = await api<{ warning: string | null }>(`/api/youtube/accounts/${acc.id}`, { method: 'DELETE' })
      setNotice(r.warning || `Chaîne « ${name} » déconnectée.`)
      accounts.reload()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const enabled = config.data?.enabled
  const composeHref = (acc: YouTubeAccount) =>
    `/app/youtube/publish?account=${acc.id}${space.spaceParam ? `&${space.spaceParam}` : ''}`

  return (
    <div className="col g18" style={{ maxWidth: 900 }}>
      <SectionTitle sub="Publiez vos vidéos courtes (Shorts) sur vos chaînes YouTube."
                    right={<Btn onClick={connect} disabled={!enabled || busy !== null}>
                      {busy === 'connect' ? 'Redirection…' : 'Se connecter avec Google'}
                    </Btn>}>
        YouTube Shorts
      </SectionTitle>

      {space.hasOrg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 13 }}>Espace :</span>
          <Seg small value={space.perso ? 'perso' : 'org'} onChange={v => space.setPerso(v === 'perso')}
               options={[{ value: 'org', label: `Équipe ${space.orgName}` }, { value: 'perso', label: 'Espace perso' }]} />
        </div>
      )}

      {config.data && !enabled && (
        <InfoBox tone="warn" title="Module indisponible">
          La publication YouTube n'est pas disponible pour le moment.
        </InfoBox>
      )}
      {notice && <InfoBox tone="go">{notice}</InfoBox>}
      {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}

      <div>
        <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Chaînes connectées</h3>
        {accounts.error ? (
          <ErrorRetry message={accounts.error} onRetry={accounts.reload} title="Impossible de charger les chaînes" />
        ) : accounts.loading && !accounts.data ? (
          <div className="muted" style={{ fontSize: 13.5 }}>Chargement…</div>
        ) : !accounts.data?.length ? (
          <Card>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              Aucune chaîne connectée. Cliquez sur « Se connecter avec Google » pour autoriser Chapote à publier sur votre chaîne YouTube.
            </p>
          </Card>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {accounts.data.map(acc => (
              <Card key={acc.id}>
                <div data-testid="youtube-account" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  {acc.thumbnail_url
                    ? <img src={acc.thumbnail_url} alt="" width={48} height={48} referrerPolicy="no-referrer"
                           style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--line, #e5e7eb)', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{acc.title || 'Chaîne YouTube'}</div>
                    {acc.handle && <div className="muted" style={{ fontSize: 12.5 }}>{acc.handle}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {acc.needs_reconnect ? <Chip tone="warn">À reconnecter</Chip> : <Chip tone="go">Connectée</Chip>}
                      {!acc.can_upload && <Chip tone="danger">Autorisation d'envoi manquante</Chip>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {acc.needs_reconnect || !acc.can_upload ? (
                      <Btn kind="soft" onClick={connect} disabled={!enabled || busy !== null}>Reconnecter</Btn>
                    ) : enabled && (
                      <Link to={composeHref(acc)} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        Publier un Short
                      </Link>
                    )}
                    {acc.can_disconnect && (
                      <Btn kind="ghost" onClick={() => disconnect(acc)} disabled={busy !== null}>
                        {busy === `acc-${acc.id}` ? 'Déconnexion…' : 'Déconnecter'}
                      </Btn>
                    )}
                  </div>
                </div>
                {acc.needs_reconnect && (
                  <div style={{ marginTop: 10 }}>
                    <InfoBox tone="warn">L'autorisation Google de cette chaîne a expiré ou a été révoquée : reconnectez-la pour publier.</InfoBox>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>{TXT.otherAccount}</p>
      </div>

      <div>
        <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Historique des publications</h3>
        {posts.error ? (
          <ErrorRetry message={posts.error} onRetry={posts.reload} title="Impossible de charger l'historique" />
        ) : !posts.data?.length ? (
          <Card><p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Aucune publication pour l'instant.</p></Card>
        ) : (
          <Card nopad>
            <div className="table-scroll">
              <table className="kc">
                <thead>
                  <tr><th>Date</th><th>Chaîne</th><th>Vidéo</th><th>Visibilité</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {posts.data.map(p => (
                    <tr key={p.id} data-testid="youtube-post">
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.created_at)}</td>
                      <td>{p.account_name || '—'}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}
                        </div>
                      </td>
                      <td>
                        {p.publish_at ? `Programmée (${fmtDate(p.publish_at)})` : PRIVACY_LABELS[p.privacy_status]}
                        {p.final_privacy && p.final_privacy !== p.privacy_status && !p.publish_at && (
                          <div className="muted" style={{ fontSize: 12 }}>Sur YouTube : {PRIVACY_LABELS[p.final_privacy] || p.final_privacy}</div>
                        )}
                      </td>
                      <td>
                        <Chip tone={p.fail_reason === 'locked_private' ? 'warn' : (STATUS_TONES[p.status] || 'info')}>
                          {STATUS_LABELS[p.status] || p.status}
                        </Chip>
                        {p.error_message && (
                          <div style={{ fontSize: 12, color: p.status === 'FAILED' ? 'var(--danger)' : undefined, marginTop: 4 }}>
                            {p.error_message}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        <Link to="/legal/youtube-cgu">Conditions d'utilisation du module YouTube</Link>
        {' · '}<Link to="/legal/youtube-confidentialite">Politique de confidentialité du module YouTube</Link>
        {' · '}<a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">Conditions d'utilisation de YouTube</a>
      </p>
    </div>
  )
}
