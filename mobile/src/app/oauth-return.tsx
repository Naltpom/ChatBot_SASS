// Retour d'une connexion TikTok / YouTube / Instagram / Drive ouvert directement dans l'app (lien
// Android sur cm.chapote.fr/<plateforme>/callback) : l'échange du code se fait avec la session de
// l'app, puis on revient à l'écran d'où la connexion a été lancée.
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { ApiError, requestAccount, exchangeDriveOAuth, exchangeOAuth, PLATFORM_LABEL, type Platform } from '../lib/api'
import { useSession } from '../lib/session'
import { Button, H1, Msg, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'
import { t } from '../lib/i18n'

type P = Platform | 'drive'
const LABEL = (p: P) => (p === 'drive' ? 'Google Drive' : PLATFORM_LABEL[p])

/** Contenu du state (JWT signé par le serveur : lu ici seulement pour savoir à qui il appartient). */
function stateClaims(state: string): { sub?: string; app?: string } {
  try {
    const b64 = state.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(globalThis.atob(b64 + '==='.slice((b64.length + 3) % 4)))
  } catch { return {} }
}

export default function OAuthReturn() {
  const q = useLocalSearchParams<Record<string, string>>()
  const p = (q.platform || 'youtube') as P
  const router = useRouter()
  const { me, refresh, setOrg, org } = useSession()
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [claim, setClaim] = useState<string | null>(null)
  const once = useRef(false)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'))
  const openOnWeb = async () => {
    const qs = new URLSearchParams(q as Record<string, string>)
    qs.delete('platform'); qs.delete('url')
    await WebBrowser.openBrowserAsync(`${q.url || `https://cm.chapote.fr/${p}/callback`}?${qs.toString()}`).catch(() => {})
    back()
  }

  useEffect(() => {
    if (once.current || !me) return
    once.current = true
    try { Promise.resolve(WebBrowser.dismissBrowser() as unknown).catch(() => {}) } catch { /* pas de navigateur ouvert */ }
    const { code, state, error } = q
    if (error || !code || !state) {
      setErr(error === 'access_denied' ? t('Vous avez refusé l’accès : aucun compte n’a été connecté.')
        : t('Connexion {plateforme} interrompue ({raison}).', { plateforme: LABEL(p), raison: q.error_description || error || t('réponse incomplète') }))
      return
    }
    const c = stateClaims(state)
    // Connexion commencée sur le site chapote.fr ou par un autre compte : elle se termine sur le site.
    if ((c.app && c.app !== 'cm') || (c.sub && c.sub !== String(me.id))) { openOnWeb(); return }
    const run = p === 'drive' ? exchangeDriveOAuth(code, state) : exchangeOAuth(p, code, state)
    run.then(async r => { setOrg(r.org_id ?? null); await refresh(); setDone(true) })
      .catch(e => {
        const ae = e as ApiError & { data?: any }
        setErr(ae.message || t('Connexion impossible'))
        if (ae.data?.code === 'account_taken' && ae.data.claim_token) setClaim(ae.data.claim_token)
      })
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compte relié à l'espace de quelqu'un d'autre : une demande, pas une reprise immédiate.
  const [asked, setAsked] = useState<string | null>(null)
  const askOwner = async () => {
    if (!claim) return
    try { const r = await requestAccount(claim, org); setClaim(null); setErr(null); setAsked(r.message) }
    catch (e) { setErr((e as Error).message); setClaim(null) }
  }

  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.lg }}>
        <H1>{t('Connexion {plateforme}', { plateforme: LABEL(p) })}</H1>
        {!err && !done ? <Row><ActivityIndicator /><Txt muted>{t('Connexion du compte…')}</Txt></Row> : null}
      </View>
      {done ? <Msg kind="ok">{p === 'drive' ? t('Google Drive connecté.') : t('Compte {plateforme} connecté.', { plateforme: LABEL(p) })}</Msg> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {asked ? <Msg kind="ok">{asked}</Msg> : null}
      {claim ? (
        <View style={{ gap: space.sm }}>
          <Txt muted>{t('Ce compte est déjà relié à l’espace de quelqu’un d’autre. Vous venez de vous y connecter : nous pouvons lui demander de vous le céder. Il accepte ou refuse ; en cas de litige, le support de Chapote tranche.')}</Txt>
          <Button kind="primary" title={t('Demander ce compte')} onPress={askOwner} />
        </View>
      ) : null}
      {done || err || asked ? <Button kind={done ? 'primary' : 'ghost'} title={t('Continuer')} onPress={back} /> : null}
    </Screen>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{children}</View>
}
