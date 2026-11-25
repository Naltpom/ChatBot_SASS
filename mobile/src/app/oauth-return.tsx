// Retour d'une connexion TikTok / YouTube / Instagram / Drive ouvert directement dans l'app (lien
// Android sur cm.chapote.fr/<plateforme>/callback) : l'échange du code se fait avec la session de
// l'app, puis on revient à l'écran d'où la connexion a été lancée.
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { ApiError, claimAccount, exchangeDriveOAuth, exchangeOAuth, PLATFORM_LABEL, type Platform } from '../lib/api'
import { useSession } from '../lib/session'
import { Button, H1, Msg, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

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
      setErr(error === 'access_denied' ? 'Vous avez refusé l’accès : aucun compte n’a été connecté.'
        : `Connexion ${LABEL(p)} interrompue (${q.error_description || error || 'réponse incomplète'}).`)
      return
    }
    const c = stateClaims(state)
    // Connexion commencée sur le site chapote.fr ou par un autre compte : elle se termine sur le site.
    if ((c.app && c.app !== 'cm') || (c.sub && c.sub !== String(me.id))) { openOnWeb(); return }
    const run = p === 'drive' ? exchangeDriveOAuth(code, state) : exchangeOAuth(p, code, state)
    run.then(async r => { setOrg(r.org_id ?? null); await refresh(); setDone(true) })
      .catch(e => {
        const ae = e as ApiError & { data?: any }
        setErr(ae.message || 'Connexion impossible')
        if (ae.data?.code === 'account_taken' && ae.data.claim_token) setClaim(ae.data.claim_token)
      })
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  const takeOver = async () => {
    if (!claim) return
    try { await claimAccount(claim, org); await refresh(); setClaim(null); setErr(null); setDone(true) }
    catch (e) { setErr((e as Error).message); setClaim(null) }
  }

  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.lg }}>
        <H1>Connexion {LABEL(p)}</H1>
        {!err && !done ? <Row><ActivityIndicator /><Txt muted>Connexion du compte…</Txt></Row> : null}
      </View>
      {done ? <Msg kind="ok">{p === 'drive' ? 'Google Drive connecté.' : `Compte ${LABEL(p)} connecté.`}</Msg> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {claim ? (
        <View style={{ gap: space.sm }}>
          <Txt muted>Ce compte est déjà relié à un autre espace. Vous venez de vous y connecter : vous pouvez le reprendre ici (il quittera l’autre espace avec ses publications à venir).</Txt>
          <Button kind="primary" title="Reprendre ce compte" onPress={takeOver} />
        </View>
      ) : null}
      {done || err ? <Button kind={done ? 'primary' : 'ghost'} title="Continuer" onPress={back} /> : null}
    </Screen>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{children}</View>
}
