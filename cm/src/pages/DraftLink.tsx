// Liens donnés par l'Assistant Chapote CM dans la conversation (construits par le serveur, jamais par l'IA) :
// /brouillon/:id            → ouvre le brouillon dans « Nouvelle publication », pré-rempli, pour le vérifier ;
// /brouillon/:id/lancer?s=… → programme le brouillon tel quel (lien signé, lié au brouillon et à la personne).
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { launchProposal } from '../api'
import { Icon, Msg } from '../components/ui'
import { t } from '../i18n'

export function OpenDraft() {
  const { id } = useParams()
  return <Navigate to={`/nouvelle?brouillon=${Number(id) || 0}`} replace />
}

export function LaunchDraft() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [state, setState] = useState<'busy' | 'ok' | { error: string }>('busy')
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    launchProposal(Number(id), params.get('s') || '')
      .then(() => setState('ok'))
      .catch(e => setState({ error: (e as Error).message }))
  }, [id, params])
  return (
    <div className="col" style={{ gap: 16, maxWidth: 560, margin: '24px auto' }}>
      <h1 style={{ margin: 0 }}>{t('Programmation')}</h1>
      {state === 'busy' && <p className="muted">{t('Programmation du brouillon…')}</p>}
      {state === 'ok' && (
        <>
          <Msg kind="ok">{t('C’est programmé. Vous pouvez la vérifier ou la modifier dans le planning jusqu’à l’heure de publication.')}</Msg>
          <Link className="btn btn-primary btn-lg" to="/planning"><Icon name="calendar" />{t('Voir le planning')}</Link>
        </>
      )}
      {typeof state === 'object' && (
        <>
          <Msg kind="err">{state.error}</Msg>
          <Link className="btn btn-primary btn-lg" to={`/nouvelle?brouillon=${Number(id) || 0}`}><Icon name="edit" />{t('Ouvrir le brouillon')}</Link>
        </>
      )}
    </div>
  )
}
