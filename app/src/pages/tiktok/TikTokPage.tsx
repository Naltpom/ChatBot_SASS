// /app/tiktok — module « Publication TikTok » de l'Espace client : connexion
// des comptes TikTok du client (Login Kit), liste des comptes, historique des
// publications. La publication se fait dans le composer (/app/tiktok/publish).
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { useApiResource } from '../../hooks/useApiResource'
import { ErrorRetry } from '../../components/ErrorRetry'
import { Btn, Card, Chip, InfoBox, SectionTitle, Seg } from '../../ui'
import { errMsg } from '../../utils/errors'
import {
  FINAL_STATUSES, PRIVACY_LABELS, STATUS_LABELS, STATUS_TONES, TXT, TikTokAccount, TikTokConfig, TikTokPost,
  fmtDate, useTikTokSpace,
} from './common'

export default function TikTokPage() {
  const space = useTikTokSpace()
  const [params] = useSearchParams()
  const config = useApiResource<TikTokConfig>('/api/tiktok/config')
  const accounts = useApiResource<TikTokAccount[]>(`/api/tiktok/accounts${space.query}`)
  const posts = useApiResource<TikTokPost[]>(`/api/tiktok/posts${space.query}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    params.get('connected') ? `Compte TikTok « ${params.get('connected')} » connecté.` : null,
  )

  // Historique : rafraîchi tant qu'une publication est en cours.
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
      const { authorize_url } = await api<{ authorize_url: string }>('/api/tiktok/oauth/start', {
        method: 'POST', body: { org_id: space.orgId },
      })
      window.location.href = authorize_url
    } catch (e) {
      setError(errMsg(e)); setBusy(null)
    }
  }

  const disconnect = async (acc: TikTokAccount) => {
    const name = acc.display_name || 'ce compte'
    if (!window.confirm(`Déconnecter ${name} ? L'autorisation sera révoquée chez TikTok et les jetons supprimés de Chapote.`)) return
    setBusy(`acc-${acc.id}`); setError(null); setNotice(null)
    try {
      const r = await api<{ warning: string | null }>(`/api/tiktok/accounts/${acc.id}`, { method: 'DELETE' })
      setNotice(r.warning || `Compte « ${name} » déconnecté.`)
      accounts.reload()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const enabled = config.data?.enabled
  const composeHref = (acc: TikTokAccount) =>
    `/app/tiktok/publish?account=${acc.id}${space.spaceParam ? `&${space.spaceParam}` : ''}`

  return (
    <div className="col g18" style={{ maxWidth: 900 }}>
      <SectionTitle sub="Publiez vos vidéos sur vos comptes TikTok, directement ou en brouillon."
                    right={<Btn onClick={connect} disabled={!enabled || busy !== null}>
                      {busy === 'connect' ? 'Redirection…' : 'Se connecter avec TikTok'}
                    </Btn>}>
        TikTok
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
          La publication TikTok n'est pas disponible pour le moment.
        </InfoBox>
      )}
      {notice && <InfoBox tone="go">{notice}</InfoBox>}
      {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}

      {/* Comptes connectés */}
      <div>
        <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Comptes connectés</h3>
        {accounts.error ? (
          <ErrorRetry message={accounts.error} onRetry={accounts.reload} title="Impossible de charger les comptes" />
        ) : accounts.loading && !accounts.data ? (
          <div className="muted" style={{ fontSize: 13.5 }}>Chargement…</div>
        ) : !accounts.data?.length ? (
          <Card>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              Aucun compte TikTok connecté. Cliquez sur « Se connecter avec TikTok » pour autoriser Chapote à publier sur votre compte.
            </p>
          </Card>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {accounts.data.map(acc => (
              <Card key={acc.id}>
                <div data-testid="tiktok-account" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  {acc.avatar_url
                    ? <img src={acc.avatar_url} alt="" width={48} height={48} referrerPolicy="no-referrer"
                           style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--line, #e5e7eb)', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{acc.display_name || 'Compte TikTok'}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {acc.needs_reconnect
                        ? <Chip tone="warn">À reconnecter</Chip>
                        : <Chip tone="go">Connecté</Chip>}
                      {!acc.can_publish && !acc.can_upload && <Chip tone="danger">Autorisations de publication manquantes</Chip>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {acc.needs_reconnect ? (
                      <Btn kind="soft" onClick={connect} disabled={!enabled || busy !== null}>Reconnecter</Btn>
                    ) : (acc.can_publish || acc.can_upload) && enabled && (
                      <Link to={composeHref(acc)} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        Publier une vidéo
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
                    <InfoBox tone="warn">L'autorisation TikTok de ce compte a expiré ou a été révoquée : reconnectez-le pour publier.</InfoBox>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>{TXT.otherAccount}</p>
      </div>

      {/* Historique */}
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
                  <tr><th>Date</th><th>Compte</th><th>Vidéo</th><th>Mode</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {posts.data.map(p => (
                    <tr key={p.id} data-testid="tiktok-post">
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.created_at)}</td>
                      <td>{p.account_name || '—'}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.title || p.file_name || '—'}
                        </div>
                        {p.privacy_level && <div className="muted" style={{ fontSize: 12 }}>{PRIVACY_LABELS[p.privacy_level] || p.privacy_level}</div>}
                      </td>
                      <td>{p.mode === 'direct' ? 'Publication directe' : 'Brouillon'}</td>
                      <td>
                        <Chip tone={STATUS_TONES[p.status] || 'info'}>{STATUS_LABELS[p.status] || p.status}</Chip>
                        {p.error_message && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{p.error_message}</div>}
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
        <Link to="/legal/tiktok-cgu">Conditions d'utilisation du module TikTok</Link>
        {' · '}<Link to="/legal/tiktok-confidentialite">Politique de confidentialité du module TikTok</Link>
      </p>
    </div>
  )
}
