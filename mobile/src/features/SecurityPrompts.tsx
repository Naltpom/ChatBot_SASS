// Après l'inscription (ou à l'ouverture tant qu'on n'a pas choisi) : une fenêtre à la fois pour les
// notifications, le déverrouillage par empreinte / visage, puis la double authentification.
// Le choix (« Activer » ou « Pas maintenant ») est gardé par utilisateur sur ce téléphone.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'
import { Modal, View } from 'react-native'
import { call } from '../lib/http'
import { useLock } from '../lib/lock'
import { enablePush, getPush, pushUnsupported } from '../lib/push'
import { TwoFASheet } from './TwoFASheet'
import { Button, Icon, Msg, Txt, type IconName } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

type Kind = 'push' | 'lock' | '2fa'
const ORDER: Kind[] = ['push', 'lock', '2fa']
const key = (uid: number, k: Kind) => `cm.ask.${uid}.${k}`

export function SecurityPrompts({ userId, active }: { userId: number; active: boolean }) {
  const { c } = useTheme()
  const lock = useLock()
  const [todo, setTodo] = useState<Kind[] | null>(null)
  const [twofaOpen, setTwofaOpen] = useState(false)
  const [twofaOn, setTwofaOn] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Ce qui reste à proposer : pas encore choisi, possible sur ce téléphone, pas déjà actif.
  useEffect(() => {
    if (!active || todo !== null) return
    let gone = false
    ;(async () => {
      const left: Kind[] = []
      for (const k of ORDER) {
        if ((await AsyncStorage.getItem(key(userId, k)).catch(() => null)) != null) continue
        try {
          if (k === 'push' && (pushUnsupported() || (await getPush()).enabled)) continue
          if (k === 'lock' && (!lock.supported || lock.enabled)) continue
          if (k === '2fa' && (await call<{ totp_enabled: boolean }>('/api/auth/2fa/status')).totp_enabled) continue
        } catch { continue }
        left.push(k)
      }
      if (!gone) setTodo(left)
    })()
    return () => { gone = true }
  }, [active, userId, lock.supported, lock.enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = active && todo?.length ? todo[0] : null
  const done = (k: Kind, v: 'yes' | 'no') => {
    AsyncStorage.setItem(key(userId, k), v).catch(() => {})
    setErr(null); setTodo(t => (t || []).filter(x => x !== k))
  }
  const accept = async () => {
    if (!cur) return
    setErr(null); setBusy(true)
    try {
      if (cur === 'push') {
        const r = await enablePush()
        if (typeof r === 'string') { setErr(r); return }
        done('push', 'yes')
      } else if (cur === 'lock') {
        const e = await lock.setEnabled(true)
        if (e) { setErr(e); return }
        done('lock', 'yes')
      } else setTwofaOpen(true)
    } finally { setBusy(false) }
  }

  const text: Record<Kind, { icon: IconName; title: string; body: string }> = {
    push: { icon: 'bell', title: 'Activer les notifications ?', body: 'Vidéo publiée, échec, nouveaux commentaires : vous êtes prévenu tout de suite.' },
    lock: { icon: 'shield', title: `Déverrouiller par ${lock.label.toLowerCase()} ?`, body: 'Personne d’autre n’ouvre l’app sur ce téléphone.' },
    '2fa': { icon: 'shield', title: 'Activer la double authentification ?', body: 'Un code de votre appli d’authentification en plus du mot de passe : votre compte reste protégé même si le mot de passe fuit.' },
  }

  return (
    <>
      <Modal visible={!!cur && !twofaOpen} transparent animationType="fade" onRequestClose={() => { if (cur) done(cur, 'no') }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.lg }}>
          {cur ? (
            <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={text[cur].icon} size={24} color={c.primary} />
              </View>
              <Txt bold size={19}>{text[cur].title}</Txt>
              <Txt muted>{text[cur].body}</Txt>
              {err ? <Msg kind="err">{err}</Msg> : null}
              <Button kind="primary" title="Activer" loading={busy} onPress={accept} />
              <Button kind="ghost" title="Pas maintenant" onPress={() => done(cur, 'no')} />
            </View>
          ) : null}
        </View>
      </Modal>
      <TwoFASheet visible={twofaOpen} enabled={false} onClose={() => { setTwofaOpen(false); done('2fa', twofaOn ? 'yes' : 'no') }}
        onChanged={setTwofaOn} />
    </>
  )
}
