// /tiktok — tableau de bord « Chapote Publisher » (outil privé du superadmin) :
// connexion OAuth TikTok, comptes connectés, accès au formulaire de publication.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { useApiResource } from '../../hooks/useApiResource'
import { ErrorRetry } from '../../components/ErrorRetry'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../../ui'
import { errMsg } from '../../utils/errors'
import { TikTokAccount, useNoIndex } from './common'

export default function TikTokDashboard() {
  useNoIndex()
  const [params] = useSearchParams()
  const config = useApiResource<{ enabled: boolean; redirect_uri: string }>('/api/admin/tiktok/config')
  const accounts = useApiResource<TikTokAccount[]>('/api/admin/tiktok/accounts')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    params.get('connected') ? `Compte « ${params.get('connected')} » connecté.` : null,
  )

  const connect = async () => {
    setBusy('connect'); setError(null)
    try {
      const { authorize_url } = await api<{ authorize_url: string }>('/api/admin/tiktok/oauth/start', { method: 'POST' })
      window.location.href = authorize_url
    } catch (e) {
      setError(errMsg(e)); setBusy(null)
    }
  }

  const disconnect = async (acc: TikTokAccount) => {
    if (!window.confirm(`Déconnecter ${acc.display_name || acc.open_id} ? L'autorisation sera révoquée chez TikTok.`)) return
    setBusy(acc.open_id); setError(null); setNotice(null)
    try {
      const r = await api<{ warning: string | null }>(`/api/admin/tiktok/accounts/${encodeURIComponent(acc.open_id)}`, { method: 'DELETE' })
      setNotice(r.warning || `Compte « ${acc.display_name || acc.open_id} » déconnecté.`)
      accounts.reload()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const enabled = config.data?.enabled

  return (
    <div className="col g18" style={{ maxWidth: 860 }}>
      <SectionTitle sub="Publication de vos vidéos sur vos comptes TikTok (Content Posting API)"
                    right={<Btn onClick={connect} disabled={!enabled || busy !== null}>
                      {busy === 'connect' ? 'Redirection…' : 'Se connecter avec TikTok'}
                    </Btn>}>
        Chapote Publisher
      </SectionTitle>

      {config.data && !enabled && (
        <InfoBox tone="warn" title="TikTok non configuré">
          Renseignez TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET dans l'environnement de l'API, puis redémarrez-la.
        </InfoBox>
      )}
      {notice && <InfoBox tone="go">{notice}</InfoBox>}
      {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}

      {accounts.error ? (
        <ErrorRetry message={accounts.error} onRetry={accounts.reload} title="Impossible de charger les comptes" />
      ) : accounts.loading || !accounts.data ? (
        <div className="center-page">Chargement…</div>
      ) : accounts.data.length === 0 ? (
        <Card>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            Aucun compte TikTok connecté. Cliquez sur « Se connecter avec TikTok » pour autoriser un compte.
          </p>
        </Card>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {accounts.data.map(acc => (
            <Card key={acc.open_id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                {acc.avatar_url
                  ? <img src={acc.avatar_url} alt="" width={48} height={48} referrerPolicy="no-referrer"
                         style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--line, #e5e7eb)', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{acc.display_name || 'Compte TikTok'}</div>
                  <div className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{acc.open_id}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {acc.needs_reconnect || acc.error
                      ? <Chip tone="warn">À reconnecter</Chip>
                      : <Chip tone="go">Connecté</Chip>}
                    {!acc.can_publish && <Chip tone="danger">Scopes de publication manquants</Chip>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {acc.can_publish && !acc.needs_reconnect && (
                    <Link to={`/tiktok/publish?account=${encodeURIComponent(acc.open_id)}`}
                          className="btn btn-primary" style={{ textDecoration: 'none' }}>
                      Publier une vidéo
                    </Link>
                  )}
                  <Btn kind="ghost" onClick={() => disconnect(acc)} disabled={busy !== null}>
                    {busy === acc.open_id ? 'Déconnexion…' : 'Déconnecter'}
                  </Btn>
                </div>
              </div>
              {acc.error && <div style={{ marginTop: 10 }}><InfoBox tone="warn">{acc.error}</InfoBox></div>}
            </Card>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Pour connecter un autre compte, connectez-vous d'abord à ce compte sur tiktok.com dans ce navigateur.
        {' '}<a href="/legal/tiktok-confidentialite">Politique de confidentialité</a>
        {' · '}<a href="/legal/tiktok-cgu">Conditions d'utilisation</a>
      </p>
    </div>
  )
}
